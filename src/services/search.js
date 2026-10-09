import mongoose from 'mongoose';
import { Chunk } from '../models/Chunk.js';
import { embedQuery } from './embeddings.js';

/**
 * Finds the chunks closest in meaning to a question.
 * Only searches the given user's own chunks.
 * Returns [{ text, index, documentId, score }]
 */
export async function searchChunks(userId, question, limit = 4) {
  const queryVector = await embedQuery(question);

  // Aggregation pipelines don't convert ids automatically, so we do it
  const owner = new mongoose.Types.ObjectId(String(userId));

  return Chunk.aggregate([
    {
      $vectorSearch: {
        index: 'chunks_vector',
        path: 'embedding',
        queryVector,
        numCandidates: 50,
        limit,
        filter: { userId: owner },
      },
    },
    {
      $project: {
        _id: 0,
        text: 1,
        index: 1,
        documentId: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);
}