/**
 * Splits text into overlapping pieces for embedding.
 * Prefers to cut at a paragraph break, then a sentence end, then a space.
 */
export function chunkText(text, { size = 800, overlap = 100 } = {}) {
  const clean = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    // If we are not at the end, look for a nicer place to cut in the last 40% of the window
    if (end < clean.length) {
      const windowStart = start + Math.floor(size * 0.6);
      const slice = clean.slice(windowStart, end);

      for (const separator of ['\n\n', '. ', '\n', ' ']) {
        const index = slice.lastIndexOf(separator);
        if (index !== -1) {
          end = windowStart + index + separator.length;
          break;
        }
      }
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= clean.length) break;
    let next = Math.max(end - overlap, start + 1); // always move forward
    // don't begin the next chunk in the middle of a word
    while (next < end && !/\s/.test(clean[next - 1])) next++;
    start = next;
  }

  return chunks;
}