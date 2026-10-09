import fs from 'node:fs/promises';
import path from 'node:path';
import { extractTextFromFile } from '../src/services/extract.js';
import { chunkText } from '../src/services/chunker.js';
import { RAG } from '../src/config/rag.js';

const file = process.argv[2];
if (!file) {
  console.log('Usage: node scripts\\test-extract.js "C:\\path\\to\\file.pdf"');
  process.exit(1);
}

try {
  const buffer = await fs.readFile(file);
  const filename = path.basename(file);
  console.log('File:', filename, '|', buffer.length, 'bytes');

  const { text, pages } = await extractTextFromFile({ buffer, filename });
  console.log('Pages:', pages ?? 'n/a');
  console.log('Characters extracted:', text.length);

  const chunks = chunkText(text, { size: RAG.CHUNK_SIZE, overlap: RAG.CHUNK_OVERLAP });
  console.log('Chunks it would make:', chunks.length, '| limit:', RAG.MAX_CHUNKS_PER_DOCUMENT);
  console.log(chunks.length > RAG.MAX_CHUNKS_PER_DOCUMENT ? 'Too large for our limit.' : 'Within our limit.');
  console.log('Preview:', JSON.stringify(text.slice(0, 300)));
} catch (err) {
  console.error('Extraction failed:', err.message);
}