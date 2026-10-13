import mammoth from 'mammoth';

export const MAX_DOC_BYTES = 8 * 1024 * 1024;

// Converts an uploaded document into plain text/markdown-ish text for the AI. Pure Node, runs on Vercel.
export async function documentToText(name: string, buffer: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) return (await mammoth.extractRawText({ buffer })).value;
  if (lower.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (lower.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/node');
    const sheets = await readXlsxFile(buffer);
    return sheets
      .map(({ sheet, data }) => `## ${sheet}\n${data.map((row) => row.map((cell) => String(cell ?? '')).join(' | ')).join('\n')}`)
      .join('\n\n');
  }
  return buffer.toString('utf8');
}
