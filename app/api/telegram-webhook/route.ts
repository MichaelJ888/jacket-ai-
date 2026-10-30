import { NextResponse, after } from 'next/server';
import { runCeoAgent } from '../_lib/ceo-agent';
import { devQueueCommand, queueDevTask } from '../_lib/dev-queue';
import { routeCeoMessage, type DevRoute } from '../_lib/dev-queue-logic';
import { compactConversationIfNeeded } from '../_lib/ceo-memory';
import { pickTelegramMedia } from '../_lib/telegram-logic';
import { claimTelegramUpdate, downloadTelegramMedia, startTyping } from '../_lib/telegram-media';
import { rateLimitResponse } from '../_lib/rate-limit';
import { resolveApproval } from '../_lib/ceo-control';
import { approveDispatch } from '../_lib/dispatch';
import { advanceOrder, confirmDeposit, createOrder } from '../_lib/order-lifecycle';
import { buildClientPulseMessage, findOrdersByRef, listOpenOrders, parseMoveInput, parseOrderInput } from '../_lib/client-pulse';
import { DEPOSIT_RECEIVED } from '../_lib/order-stages';
import { applyClientUpdates, parseClientScreenshot } from '../_lib/vision-parse';
import { addSubconJob, completeSubconJob, handleAttendanceMessage, isAttendanceChat, logSewerOutput, markPayrollPaid } from '../_lib/payroll';
import {
  clockInStaff,
  clockOutStaff,
  completeLatestTaskForStaff,
  composeBossStyleMessage,
  createStaffTask,
  answerTelegramCallbackQuery,
  decideMediaAdApproval,
  generateStaffLinkCode,
  getPayrollSummary,
  getStaffByChatId,
  getStaffProfile,
  getSupabaseAdmin,
  linkStaffTelegramChat,
  logSystemEvent,
  removeTelegramInlineKeyboard,
  reportCriticalError,
  setEmbroideryPickupCommitment,
  sendTelegramDirectMessage,
} from '../_lib/integrations';

export const maxDuration = 60;

const STAFF = ['Jonathan', 'Linda'] as const;
type StaffName = (typeof STAFF)[number];

function normalizeStaffName(value: string): StaffName | null {
  return STAFF.find((name) => name.toLowerCase() === value.trim().toLowerCase()) || null;
}

function allowedChatId(chatId: unknown) {
  return Boolean(process.env.TELEGRAM_CHAT_ID && String(chatId) === process.env.TELEGRAM_CHAT_ID);
}

function formatMinutes(totalMinutes: number) {
  return `${Math.floor(totalMinutes / 60)} hrs ${totalMinutes % 60} mins`;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret || req.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = await rateLimitResponse(req, 'telegram-webhook', 120, 60);
  if (limited) return limited;
  try {
    const update = await req.json();
    const callback = update?.callback_query;
    if (callback) {
      const callbackChatId = callback.message?.chat?.id;
      const callbackId = callback.id;
      const actorId = callback.from?.id;
      const ceoUserId = process.env.TELEGRAM_CEO_USER_ID;
      const callbackChatType = callback.message?.chat?.type;
      const callbackData = typeof callback.data === 'string' ? callback.data : '';
      const authorizedActor = ceoUserId
        ? String(actorId) === ceoUserId
        : callbackChatType === 'private' && String(actorId) === String(callbackChatId);

      if (!allowedChatId(callbackChatId) || !authorizedActor) {
        if (callbackId) await answerTelegramCallbackQuery(String(callbackId), 'Not authorized.');
        return NextResponse.json({ ok: true });
      }

      const approvalMatch = callbackData.match(/^appr:(yes|no):([\da-f-]{36})$/i);
      if (callbackId && approvalMatch) {
        const outcome = await resolveApproval(approvalMatch[2], approvalMatch[1].toLowerCase() === 'yes');
        await answerTelegramCallbackQuery(String(callbackId), outcome.slice(0, 180));
        if (callback.message?.message_id) await removeTelegramInlineKeyboard(String(callbackChatId), Number(callback.message.message_id));
        await sendTelegramDirectMessage(String(callbackChatId), outcome);
        return NextResponse.json({ ok: true });
      }

      const decisionMatch = callbackData.match(/^boost_ad:(yes|no):([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i);
      if (callbackId && decisionMatch) {
        const [, answer, approvalId] = decisionMatch;
        const decision = answer.toLowerCase() === 'yes' ? 'APPROVED' : 'DECLINED';
        const result = await decideMediaAdApproval(approvalId, decision, String(actorId || ''));
        if (result.error) {
          await answerTelegramCallbackQuery(String(callbackId), 'Could not save this decision. Please try again.');
          return NextResponse.json({ ok: true });
        }

        if (!result.data) {
          await answerTelegramCallbackQuery(String(callbackId), 'This approval was already handled or is unavailable.');
          if (callback.message?.message_id) {
            await removeTelegramInlineKeyboard(String(callbackChatId), Number(callback.message.message_id));
          }
          return NextResponse.json({ ok: true });
        }

        const campaignName = result.data.campaign_name;
        const response = decision === 'APPROVED'
          ? `Approved: ${campaignName}. Ready for manual launch; ads were not published automatically because ad-account publishing is not configured.`
          : `Declined: ${campaignName}. The ad will not be boosted.`;
        await answerTelegramCallbackQuery(String(callbackId), decision === 'APPROVED' ? 'Boost approved.' : 'Boost declined.');
        if (callback.message?.message_id) {
          await removeTelegramInlineKeyboard(String(callbackChatId), Number(callback.message.message_id));
        }
        await sendTelegramDirectMessage(String(callbackChatId), response);
        return NextResponse.json({ ok: true });
      }

      const dispMatch = callbackData.match(/^disp:(approve|reject):([\da-f-]{36})$/i);
      if (callbackId && dispMatch) {
        const [, action, dispatchId] = dispMatch;
        let response = '';
        if (action.toLowerCase() === 'approve') {
          const outcome = await approveDispatch(dispatchId);
          response = outcome.ok ? `Dispatch approved: ${outcome.message}` : `Dispatch booking failed: ${outcome.message}`;
        } else {
          const supabase = getSupabaseAdmin();
          await supabase?.from('dispatch_requests').update({ status: 'CANCELLED' }).eq('id', dispatchId);
          response = 'Dispatch cancelled by CEO.';
        }
        await answerTelegramCallbackQuery(String(callbackId), response.slice(0, 180));
        if (callback.message?.message_id) {
          await removeTelegramInlineKeyboard(String(callbackChatId), Number(callback.message.message_id));
        }
        await sendTelegramDirectMessage(String(callbackChatId), response);
        return NextResponse.json({ ok: true });
      } else if (callbackId) {
        await answerTelegramCallbackQuery(String(callbackId), 'This approval is no longer available.');
      }
      return NextResponse.json({ ok: true });
    }

    const message = update?.message;
    const chatId = message?.chat?.id;
    const chatType = message?.chat?.type;
    const caption = typeof message?.caption === 'string' ? message.caption.trim() : '';
    const text = (typeof message?.text === 'string' ? message.text.trim() : '') || caption;
    const picked = message ? pickTelegramMedia(message) : { media: null };

    // Diagnostic: log every incoming message with media to trace photo processing
    if (picked.media || picked.rejected) {
      await logSystemEvent('telegram-webhook-entry', 'info', 'Message with media received', {
        chatId: String(chatId),
        chatType,
        fromId: String(message?.from?.id),
        hasText: !!text,
        hasMedia: !!picked.media,
        mediaKind: picked.media?.kind || null,
        rejected: picked.rejected || null,
        allowedChat: allowedChatId(chatId),
        ceoUserId: process.env.TELEGRAM_CEO_USER_ID ? 'set' : 'NOT SET',
      });
    }

    if (!chatId || (!text && !picked.media && !picked.rejected)) return NextResponse.json({ ok: true });
    if (update?.update_id !== undefined && !(await claimTelegramUpdate(update.update_id))) return NextResponse.json({ ok: true });

    if (picked.media || picked.rejected) {
      // Voice notes and photos are CEO-only; everyone else's media is ignored.
      const ceoOnly = allowedChatId(chatId) && !isAttendanceChat(chatId) && (!!process.env.TELEGRAM_CEO_USER_ID && String(message.from?.id) === process.env.TELEGRAM_CEO_USER_ID);
      if (!ceoOnly) {
        await logSystemEvent('telegram-media-ignored', 'warning', 'Media received but not from CEO chat', {
          chatId: String(chatId),
          fromId: String(message.from?.id),
          expectedCeoId: process.env.TELEGRAM_CEO_USER_ID ? 'set' : 'NOT SET',
          chatType,
          hasMedia: !!picked.media,
          rejected: picked.rejected || null,
        });
        return NextResponse.json({ ok: true });
      }
      if (picked.rejected) {
        await sendTelegramDirectMessage(String(chatId), picked.rejected);
        return NextResponse.json({ ok: true });
      }
      const media = picked.media!;
      // Instant ack so the CEO never sees silence while the download/vision parse runs (failures ignored).
      const ackText = media.kind === 'photo' || media.kind === 'image-file' ? 'Na-receive ko ang larawan, pinoproseso na...' : 'Na-receive ko ang voice note, pinoproseso na...';
      await sendTelegramDirectMessage(String(chatId), ackText).catch(() => undefined);
      after(async () => {
        const stopTyping = startTyping(String(chatId));
        let answer: string;
        try {
          await logSystemEvent('telegram-media-received', 'info', 'Media processing started', { kind: media.kind, mediaType: media.mediaType, size: media.size });
          const file = await downloadTelegramMedia(media);
          if ('error' in file) {
            await reportCriticalError('telegram-media-download-failed', new Error(`downloadTelegramMedia failed: ${file.error}`), { kind: media.kind, size: media.size, mediaType: media.mediaType });
            answer = 'Hindi ko ma-download yung file, Boss. Subukan ulit o mas maliit na photo.';
          } else if (media.kind === 'photo' || media.kind === 'image-file') {
            // Fast path: lightweight vision parse for client-list / chat screenshots (cheap model, token-efficient).
            const parsed = await parseClientScreenshot(file, text);
            if (parsed.clients.length) {
              const applied = await applyClientUpdates(parsed.clients);
              answer = `📸 Nabasa ko ang screenshot — ${applied.created} new, ${applied.updated} updated, ${applied.failed} failed:\n${applied.lines.join('\n')}`;
            } else if (parsed.error) {
              await logSystemEvent('telegram-vision-parse', 'warning', parsed.error, { kind: media.kind });
              answer = await runCeoAgent(text, file); // fall back to the full CEO agent
            } else {
              answer = await runCeoAgent(text, file); // no clients found — let the CEO agent describe/act
            }
          } else {
            answer = await runCeoAgent(text, file);
          }
        } catch (error) {
          console.error('CEO media failed:', error);
          await reportCriticalError('telegram-ceo-media', error);
          answer = 'Sorry Boss, hindi ko naproseso yung voice/photo. Paki-type na lang muna o subukan ulit.';
        } finally {
          stopTyping();
        }
        await sendTelegramDirectMessage(String(chatId), answer.slice(0, 4000));
        await compactConversationIfNeeded().catch(() => undefined);
      });
      return NextResponse.json({ ok: true });
    }

    if (isAttendanceChat(chatId)) {
      const attendanceReply = await handleAttendanceMessage(text, message.from);
      if (attendanceReply) await sendTelegramDirectMessage(String(chatId), attendanceReply);
      return NextResponse.json({ ok: true });
    }

    if (!allowedChatId(chatId)) {
      if (chatType === 'private') await handlePrivateStaffMessage(String(chatId), text);
      return NextResponse.json({ ok: true });
    }

    const [command, nameValue, ...restWords] = text.split(/\s+/);
    const staffName = nameValue ? normalizeStaffName(nameValue) : null;
    const freeText = restWords.join(' ').trim();
    let reply = '';

    if (/^pickup$/i.test(command)) {
      reply = await handlePickupCommand(nameValue || '', freeText);
    } else if (/^(piece|subcon)$/i.test(command) || (/^payroll$/i.test(command) && /^paid$/i.test(nameValue || ''))) {
      reply = await handlePayrollCommand(command.toLowerCase(), [nameValue, ...restWords].filter(Boolean));
    } else if (/^in$/i.test(command)) {
      reply = staffName ? formatClockResult('IN', staffName, await clockInStaff(staffName)) : 'Use: IN Jonathan or IN Linda';
    } else if (/^out$/i.test(command)) {
      reply = staffName ? formatClockResult('OUT', staffName, await clockOutStaff(staffName)) : 'Use: OUT Jonathan or OUT Linda';
    } else if (/^payroll$/i.test(command)) {
      reply = staffName ? formatPayrollResult(staffName, await getPayrollSummary(staffName)) : 'Use: PAYROLL Jonathan or PAYROLL Linda';
    } else if (/^link$/i.test(command)) {
      reply = staffName ? await handleLinkCommand(staffName) : 'Use: LINK Jonathan or LINK Linda';
    } else if (/^(task|urgent|emergency)$/i.test(command)) {
      const priority = command.toLowerCase() as 'task' | 'urgent' | 'emergency';
      reply = staffName && freeText ? await handleTaskCommand(staffName, freeText, priority === 'task' ? 'normal' : priority) : `Use: ${command.toUpperCase()} Jonathan <bilin text>`;
    } else if (/^clients$/i.test(command)) {
      reply = buildClientPulseMessage(await listOpenOrders());
    } else if (/^order$/i.test(command)) {
      reply = await handleOrderCreateCommand(text.slice(text.indexOf(command) + command.length).trim());
    } else if (/^move$/i.test(command)) {
      reply = await handleOrderMoveCommand(text.slice(text.indexOf(command) + command.length).trim());
    } else if (/^start$/i.test(command)) {
      reply = 'MJIC Ops Bot ready. Use IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>, PICKUP <job-id> YYYY-MM-DD HH:mm, ORDER <client> | <project> | <total>, MOVE <client> <stage>, or CLIENTS.';
    }

    if (!reply) {
      const ceoUserId = process.env.TELEGRAM_CEO_USER_ID;
      if (!ceoUserId || String(message.from?.id) !== ceoUserId) {
        await sendTelegramDirectMessage(String(chatId), 'Commands: IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>, URGENT Jonathan <bilin>, EMERGENCY Jonathan <bilin>, PICKUP <job-id> YYYY-MM-DD HH:mm, ORDER <client> | <project> | <total>, MOVE <client> <stage>, CLIENTS.');
        return NextResponse.json({ ok: true });
      }
      const ceoText = text.replace(/@\w*bot\b/gi, '').trim() || text;
      const route: DevRoute = message.forward_date || message.forward_origin ? { kind: 'ceo' } : routeCeoMessage(ceoText);
      if (route.kind === 'command' || route.kind === 'dev') {
        const reply = route.kind === 'dev' ? await queueDevTask(route.task, route.explicit, update?.update_id) : await devQueueCommand(route.name, route.id);
        await sendTelegramDirectMessage(String(chatId), reply.slice(0, 4000));
        return NextResponse.json({ ok: true });
      }
      after(async () => {
        const stopTyping = startTyping(String(chatId));
        let answer: string;
        try {
          answer = await runCeoAgent(ceoText);
        } catch (error) {
          console.error('CEO agent failed:', error);
          await reportCriticalError('telegram-ceo-agent', error);
          answer = 'Sorry Boss, busy ang AI models ngayon. Subukan ulit in a minute. (Commands: IN/OUT/PAYROLL/TASK/PICKUP still work.)';
        } finally {
          stopTyping();
        }
        await sendTelegramDirectMessage(String(chatId), answer.slice(0, 4000));
        await compactConversationIfNeeded().catch(() => undefined);
      });
      return NextResponse.json({ ok: true });
    }

    await sendTelegramDirectMessage(String(chatId), reply);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram ops webhook error:', error);
    await reportCriticalError('telegram-webhook', error);
    return NextResponse.json({ ok: true });
  }
}

async function handlePayrollCommand(command: string, args: string[]) {
  if (command === 'payroll') return (await markPayrollPaid(args[1] || '')).message;
  if (command === 'piece') {
    // PIECE <worker> <qty> <rate> [item]
    const [worker, qty, rate, ...item] = args;
    if (!worker || !(Number(qty) > 0) || !(Number(rate) >= 0)) return 'Use: PIECE <sewer> <qty> <rate-per-piece> [item]';
    const result = await logSewerOutput({ workerName: worker, quantity: Number(qty), rate: Number(rate), item: item.join(' ') });
    return result.error ? `Piece error: ${result.error}` : `Logged ${qty} pcs x P${rate} for ${worker}.`;
  }
  // SUBCON ADD <name> <amount> [job-ref] | SUBCON DONE <job-ref-or-id>
  if (/^add$/i.test(args[0])) {
    const [, name, amount, ...ref] = args;
    if (!name || !(Number(amount) > 0)) return 'Use: SUBCON ADD <name> <amount> [job-ref]';
    const result = await addSubconJob({ subconName: name, amount: Number(amount), jobRef: ref.join(' ') || undefined });
    return result.error ? `Subcon error: ${result.error}` : `Subcon job added for ${name}: P${amount}. Send SUBCON DONE ${ref.join(' ') || String(result.data?.id).slice(0, 8)} when finished to generate their payroll.`;
  }
  if (/^done$/i.test(args[0]) && args[1]) {
    const outcome = await completeSubconJob(args.slice(1).join(' '));
    if (outcome.error) return `Subcon error: ${outcome.error}`;
    return outcome.result?.created ? 'Subcon payroll generated - see the payroll message above.' : 'That job was already completed.';
  }
  return 'Use: SUBCON ADD <name> <amount> [job-ref] or SUBCON DONE <job-ref>';
}

async function handleOrderCreateCommand(raw: string) {
  const parsed = parseOrderInput(raw);
  if ('error' in parsed) return parsed.error;
  const result = await createOrder(parsed);
  if (!result.order) return `Order error: ${result.error}`;
  return `✅ Na-save na si ${result.order.client_name} (${result.order.order_number}). Deposit na kailangan: ₱${Number(result.order.deposit_amount).toLocaleString('en-PH')}. Kapag bayad na: MOVE ${result.order.order_number} paid`;
}

async function handleOrderMoveCommand(raw: string) {
  const parsed = parseMoveInput(raw);
  if ('error' in parsed) return parsed.error;
  const matches = await findOrdersByRef(parsed.ref);
  if (!matches.length) return `Walang open order na match sa "${parsed.ref}". I-type ang CLIENTS para makita lahat.`;
  if (matches.length > 1) {
    return `Maraming match sa "${parsed.ref}":\n${matches.map((order) => `- ${order.order_number} · ${order.client_name || order.project_name} (${order.stage})`).join('\n')}\nGamitin ang ORD-number, hal: MOVE ${matches[0].order_number} ${parsed.stage}`;
  }
  const order = matches[0];
  const result = parsed.stage === DEPOSIT_RECEIVED
    ? await confirmDeposit(order.id, null)
    : await advanceOrder(order.id, parsed.stage, 'via Telegram');
  if (!result.ok) return `❌ ${order.order_number}: ${result.error}`;
  const newStage = parsed.stage === DEPOSIT_RECEIVED ? 'S06_SIZING' : parsed.stage;
  return `✅ ${order.order_number} · ${order.client_name || order.project_name}: ${order.stage} → ${newStage}`;
}

async function handleLinkCommand(staffName: StaffName) {
  const result = await generateStaffLinkCode(staffName);
  if (result.error) return `Link error: ${result.error}`;
  return `Ipadala mo kay ${staffName}, sabihin i-type niya sa akin (private message dito sa bot) ang code na ito: ${result.code} (valid lang for 15 minutes).`;
}

async function handleTaskCommand(staffName: StaffName, taskText: string, priority: 'normal' | 'urgent' | 'emergency') {
  const result = await createStaffTask({ staffName, taskText, priority });
  if (result.error) return `Task error: ${result.error}`;

  const profile = await getStaffProfile(staffName);
  const chatId = profile.data?.telegram_chat_id;
  if (!chatId) return `Naka-log na ang bilin para kay ${staffName} (${priority}), pero hindi pa naka-link ang Telegram niya — gamitin muna ang LINK ${staffName}.`;

  if (priority !== 'normal') {
    const styled = await composeBossStyleMessage(`${priority === 'emergency' ? 'Emergency lang po sandali,' : 'Paalala lang po,'} ${taskText}`);
    await sendTelegramDirectMessage(chatId, styled);
  }
  return `Naka-log na ang bilin para kay ${staffName} (${priority}). Ipapaalala ko sa kanya.`;
}

async function handlePickupCommand(jobId: string, commitment: string) {
  const match = commitment.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(jobId)) {
    return 'Use: PICKUP <job-id> YYYY-MM-DD HH:mm (Asia/Manila).';
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) {
    return 'Invalid date or time. Use YYYY-MM-DD HH:mm in Asia/Manila.';
  }

  const commitmentAt = new Date(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:00+08:00`);
  if (commitmentAt.getTime() <= Date.now()) return 'Pickup commitment must be in the future.';

  const result = await setEmbroideryPickupCommitment(jobId, commitmentAt.toISOString());
  if (result.error) return `Pickup schedule error: ${result.error}`;
  if (!result.data) return 'Embroidery job not found. Check the job ID and try again.';

  const pickupTime = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(new Date(result.data.pickup_commitment_at));
  return `Pickup commitment saved for ${result.data.project_name || result.data.client_name || 'embroidery job'} at ${pickupTime}. Ipapadala ko ang alert 30 minutes before pickup.`;
}

async function handlePrivateStaffMessage(chatId: string, text: string) {
  if (/^[A-F0-9]{8}$/i.test(text)) {
    const result = await linkStaffTelegramChat(text.toUpperCase(), chatId);
    if (result.staffName) {
      const welcome = await composeBossStyleMessage(`Hi ${result.staffName}! Naka-connect na tayo dito sa Telegram, dito na kita pwede i-message kapag may bilin o importante.`);
      await sendTelegramDirectMessage(chatId, welcome);
    }
    return;
  }

  if (/^done$/i.test(text)) {
    const staff = await getStaffByChatId(chatId);
    if (!staff) return;
    const result = await completeLatestTaskForStaff(staff.staff_name);
    if (result.data) {
      const ack = await composeBossStyleMessage('Salamat! Ang galing, nakumpleto mo na yun.');
      await sendTelegramDirectMessage(chatId, ack);
    }
  }
}

function formatClockResult(action: string, staffName: StaffName, result: { data: { time_in?: string; time_out?: string; total_minutes?: number; total_earned?: number } | null; error: string | null }) {
  if (result.error) return `Payroll error for ${staffName}: ${result.error}`;
  if (action === 'IN') return `✅ ${staffName} time-in recorded at ${new Date(result.data?.time_in || Date.now()).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`;
  return `✅ ${staffName} time-out recorded. Worked ${formatMinutes(Number(result.data?.total_minutes || 0))}. Earned ₱${Number(result.data?.total_earned || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`;
}

function formatPayrollResult(staffName: StaffName, result: { profile: { role: string; monthly_salary: number; per_minute_rate: number } | null; totalMinutes: number; totalEarned: number; period: { label: string }; error: string | null }) {
  if (result.error || !result.profile) return `Payroll error for ${staffName}: ${result.error || 'Profile not found.'}`;
  return [
    `📊 Payroll Summary: ${staffName}`,
    `Period: ${result.period.label} (Asia/Manila)`,
    `Role: ${result.profile.role}`,
    `Monthly Base: ₱${Number(result.profile.monthly_salary).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
    `Total Hours Worked: ${formatMinutes(result.totalMinutes)} (${result.totalMinutes.toLocaleString()} mins)`,
    `Minute Rate: ₱${Number(result.profile.per_minute_rate).toFixed(4)} / min`,
    `Total Payout: ₱${result.totalEarned.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
  ].join('\n');
}
