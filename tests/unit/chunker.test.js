import { describe, it, expect } from 'vitest';
import { chunkText } from '../../src/services/chunker.js';

// 120 numbered sentences, with a paragraph break after every tenth
function sampleDocument() {
  let text = '';
  for (let i = 0; i < 120; i++) {
    text += `This is sentence number ${i + 1} of the sample document.` + (i % 10 === 9 ? '\n\n' : ' ');
  }
  return text;
}

describe('chunkText', () => {
  it('returns nothing for empty or missing text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
    expect(chunkText(undefined)).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    expect(chunkText('Just one short sentence.')).toEqual(['Just one short sentence.']);
  });

  it('normalizes line endings, spaces and blank lines', () => {
    expect(chunkText('a\r\nb')).toEqual(['a\nb']);
    expect(chunkText('a   b')).toEqual(['a b']);
    expect(chunkText('a\n\n\n\nb')).toEqual(['a\n\nb']);
  });

  it('splits a long document into several chunks', () => {
    const chunks = chunkText(sampleDocument());
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    expect(chunks.length).toBeLessThanOrEqual(14);
  });

  it('never makes a chunk longer than the size limit', () => {
    for (const chunk of chunkText(sampleDocument())) {
      expect(chunk.length).toBeLessThanOrEqual(800);
    }
    for (const chunk of chunkText(sampleDocument(), { size: 200, overlap: 20 })) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('prefers to end chunks at the end of a sentence', () => {
    for (const chunk of chunkText(sampleDocument())) {
      expect(chunk.endsWith('document.')).toBe(true);
    }
  });

  it('overlaps each chunk with the one before it', () => {
    const chunks = chunkText(sampleDocument());
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].slice(-150)).toContain(chunks[i].slice(0, 30));
    }
  });

  it('never starts a later chunk in the middle of a word', () => {
    const text = sampleDocument().trim();
    let from = 0;
    chunkText(text).forEach((chunk, i) => {
      const at = text.indexOf(chunk, from);
      expect(at).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(at === 0 || /\s/.test(text[at - 1])).toBe(true);
      from = at + 1;
    });
  });

  it('does not lose the first or the last sentence', () => {
    const chunks = chunkText(sampleDocument());
    expect(chunks[0].startsWith('This is sentence number 1 of')).toBe(true);
    expect(chunks[chunks.length - 1].endsWith('sentence number 120 of the sample document.')).toBe(true);
  });

  it('still finishes on text with no spaces to cut at', () => {
    const chunks = chunkText('a'.repeat(2000));
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800);
    expect(chunks.join('').length).toBeGreaterThanOrEqual(2000); // nothing was dropped
  });
});