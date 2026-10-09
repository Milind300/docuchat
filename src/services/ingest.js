import { Document } from '../models/Document.js';
import { Chunk } from '../models/Chunk.js';
import { chunkText } from './chunker.js';
import { embedDocuments } from './embeddings.js';
import { RAG } from '../config/rag.js';

/**
 * Splits text, embeds the pieces and saves everything.
 * Returns the finished Document. On failure the Document is marked FAILED.
 */
export async function ingestText({ userId, filename, mimeType, text }) {
  const doc = await Document.create({
    userId,
    filename,
    mimeType,
    status: 'PROCESSING',
    charCount: String(text ?? '').length,
  });

  try {
    const pieces = chunkText(text, { size: RAG.CHUNK_SIZE, overlap: RAG.CHUNK_OVERLAP });

    if (pieces.length === 0) {
      throw new Error('No readable text found in this file.');
    }
    if (pieces.length > RAG.MAX_CHUNKS_PER_DOCUMENT) {
      throw new Error(
        `This document is too large (${pieces.length} pieces). The limit is ${RAG.MAX_CHUNKS_PER_DOCUMENT}.`
      );
    }

    const vectors = await embedDocuments(pieces);

    await Chunk.insertMany(
      pieces.map((piece, i) => ({
        userId,
        documentId: doc._id,
        index: i,
        text: piece,
        embedding: vectors[i],
      }))
    );

    doc.status = 'READY';
    doc.chunkCount = pieces.length;
    await doc.save();
    return doc;
  } catch (err) {
    // Leave no half-saved document behind
    await Chunk.deleteMany({ documentId: doc._id });
    doc.status = 'FAILED';
    doc.error = String(err.message).slice(0, 300);
    await doc.save();
    throw err;
  }
}