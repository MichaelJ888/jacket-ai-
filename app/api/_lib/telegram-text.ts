// Cp1252 code points for bytes 0x80-0x9F. Everything else in Latin-1 maps 1:1 to its byte value.
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const CP1252_REVERSE = new Map<string, number>([...CP1252_HIGH].map((char, index) => [char, 0x80 + index]));
const MOJIBAKE_MARKER = /[ÃÂâðÅ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Reverses the common "UTF-8 bytes read as cp1252" corruption (e.g. ðŸšš -> 🚚). Returns the input unchanged
// when it is not clearly mojibake or the reversed bytes are not valid UTF-8.
function reverseMojibake(text: string) {
  if (!MOJIBAKE_MARKER.test(text)) return text;
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const mapped = CP1252_REVERSE.get(char);
    if (mapped === undefined) return text;
    bytes.push(mapped);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

// Normalizes outbound Telegram text: canonical UTF-8 (NFC), repaired mojibake, and no stray control characters.
// Newlines and tabs are kept so message layout survives.
export function sanitizeTelegramText(text: string) {
  return reverseMojibake(String(text ?? '')).normalize('NFC').replace(CONTROL_CHARS, '');
}
