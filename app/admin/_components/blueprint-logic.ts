const EMAIL_ADDRESS =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function isValidResendFrom(value: string): boolean {
  const sender = value.trim();
  if (!sender || sender.length > 320 || /[\r\n,]/.test(sender)) return false;

  const displayNameMatch = /^([^<>]{1,100})<([^<>]+)>$/.exec(sender);
  if (displayNameMatch) {
    if (!displayNameMatch[1].trim()) return false;
    return EMAIL_ADDRESS.test(displayNameMatch[2].trim());
  }

  if (/[<>]/.test(sender)) return false;
  return EMAIL_ADDRESS.test(sender);
}
