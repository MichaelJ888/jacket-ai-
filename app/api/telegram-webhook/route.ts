import { NextResponse } from 'next/server';
import {
  clockInStaff,
  clockOutStaff,
  completeLatestTaskForStaff,
  composeBossStyleMessage,
  createStaffTask,
  generateStaffLinkCode,
  getPayrollSummary,
  getStaffByChatId,
  getStaffProfile,
  linkStaffTelegramChat,
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
    let reply = 'Commands: IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>, URGENT Jonathan <bilin>, EMERGENCY Jonathan <bilin>.';

    if (/^in$/i.test(command)) {
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
      reply = 'MJIC Ops Bot ready. Use IN Jonathan, OUT Jonathan, PAYROLL Jonathan, LINK Jonathan, TASK Jonathan <bilin>.';
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
