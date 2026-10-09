import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Gets plain text out of an uploaded file.
 * buffer: the file's bytes. Returns { text, pages }.
 */
export async function extractTextFromFile({ buffer, filename = '', mimeType = '' }) {
  const name = filename.toLowerCase();
  const isPdf = mimeType === 'application/pdf' || name.endsWith('.pdf');
  const isTxt = mimeType === 'text/plain' || name.endsWith('.txt');

  if (isPdf) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: String(text ?? '').trim(), pages: totalPages };
  }

  if (isTxt) {
    return { text: buffer.toString('utf8').trim(), pages: null };
  }

  throw new Error('Only PDF and TXT files are supported.');
}