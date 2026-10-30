// Recognises Ms. Anne Manalo's first private message to the bot so her chat ID can be saved automatically.
// Only the exact full name "Anne Manalo" (case-insensitive) auto-binds: an unrelated private chat must never receive sample alerts that carry client details.
export type TelegramSender = { first_name?: string; last_name?: string; username?: string } | null | undefined;

const ANNE_FULL_NAME = 'anne manalo';

export function isMsAnneSender(sender: TelegramSender) {
  const fullName = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ');
  return fullName.trim().replace(/\s+/g, ' ').toLowerCase() === ANNE_FULL_NAME;
}
