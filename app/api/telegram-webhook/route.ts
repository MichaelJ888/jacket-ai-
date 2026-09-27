import { NextResponse } from 'next/server';
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
  linkStaffTelegramChat,
  removeTelegramInlineKeyboard,
  setEmbroideryPickupCommitment,
  sendTelegramDirectMessage,
} from '../_lib/integrations';

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
      } else if (callbackId) {
        await answerTelegramCallbackQuery(String(callbackId), 'This approval is no longer available.');
      }
      return NextResponse.json({ ok: true });
    }

    const message = update?.message;
    const chatId = message?.chat?.id;
    const chatType = message?.chat?.type;
    const text = typeof message?.text === 'string' ? message.text.trim() : '';

    if (!chatId || !text) return NextResponse.json({ ok: true });

    if (!allowedChatId(chatId)) {
      if (chatType === 'private') await handlePrivateStaffMessage(String(chatId), text);
      return NextResponse.json({ ok: true });
    }

    const [command, nameValue, ...restWords] = text.split(/\s+/);
    const staffName = nameValue ? normalizeStaffName(nameValue) : null;
    const freeText = restWords.join(' ').trim();
    let reply = 'Commands: IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>, URGENT Jonathan <bilin>, EMERGENCY Jonathan <bilin>, PICKUP <job-id> YYYY-MM-DD HH:mm.';

    if (/^pickup$/i.test(command)) {
      reply = await handlePickupCommand(nameValue || '', freeText);
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
    } else if (/^start$/i.test(command)) {
      reply = 'MJIC Ops Bot ready. Use IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>, or PICKUP <job-id> YYYY-MM-DD HH:mm.';
    }

    await sendTelegramDirectMessage(String(chatId), reply);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram ops webhook error:', error);
    return NextResponse.json({ ok: true });
  }
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
