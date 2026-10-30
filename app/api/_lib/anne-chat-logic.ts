// Recognises Ms. Anne Manalo's first private message to the bot so her chat ID can be saved automatically.
// Only a "Manalo" match auto-binds: an unrelated private chat must never receive sample alerts that carry client details.
export type TelegramSender = { first_name?: string; last_name?: string; username?: string } | null | undefined;

export function isMsAnneSender(sender: TelegramSender) {
  const haystack = [sender?.first_name, sender?.last_name, sender?.username].filter(Boolean).join(' ');
  return /manalo/i.test(haystack);
}
