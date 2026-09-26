import { NextResponse } from 'next/server';
import {
  composeBossStyleMessage,
  getStaffProfile,
  isManilaDaytime,
  listDueWatchTasks,
  listMorningTasks,
  markTaskReminded,
  sendTelegramDirectMessage,
  sendTelegramMessage,
} from '../../_lib/integrations';

const STAFF_NAMES = ['Jonathan', 'Linda'];

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow while CRON_SECRET is not yet configured, for initial setup/testing
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const type = new URL(req.url).searchParams.get('type') === 'morning' ? 'morning' : 'watch';
  let sentCount = 0;

  if (type === 'morning') {
    for (const staffName of STAFF_NAMES) {
      const profile = await getStaffProfile(staffName);
      const chatId = profile.data?.telegram_chat_id;
      if (!chatId) continue;

      const tasks = await listMorningTasks(staffName);
      const rawText = tasks.length
        ? `Good morning! Eto yung mga dapat nating tapusin ngayong araw: ${tasks.map((task: { task_text: string }) => task.task_text).join('; ')}. Sige tayo, kaya natin 'to!`
        : 'Good morning! Wala munang bagong bilin ngayon, sige lang sa regular gawain natin ngayong araw. Ingat lagi!';
      const styled = await composeBossStyleMessage(rawText);
      await sendTelegramDirectMessage(chatId, styled);
      for (const task of tasks) await markTaskReminded(task.id, task.reminder_count || 0);
      sentCount += 1;
    }
    if (sentCount) void sendTelegramMessage(`✅ Sent morning task reminders to ${sentCount} staff member(s).`);
    return NextResponse.json({ success: true, type, sent: sentCount });
  }

  const dueTasks = await listDueWatchTasks();
  for (const task of dueTasks) {
    if (task.priority === 'urgent' && !isManilaDaytime()) continue; // only emergencies interrupt outside working hours
    const profile = await getStaffProfile(task.staff_name);
    const chatId = profile.data?.telegram_chat_id;
    if (!chatId) continue;

    const lead = task.priority === 'emergency' ? 'Emergency lang po sandali,' : 'Paalala lang po,';
    const styled = await composeBossStyleMessage(`${lead} ${task.task_text}`);
    await sendTelegramDirectMessage(chatId, styled);
    await markTaskReminded(task.id, task.reminder_count || 0);
    sentCount += 1;
  }
  if (sentCount) void sendTelegramMessage(`🔔 Sent ${sentCount} urgent/emergency staff reminder(s).`);
  return NextResponse.json({ success: true, type, sent: sentCount });
}
