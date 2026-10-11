import { EmbeddingLog } from '../models/EmbeddingLog.js';
import { RAG } from '../config/rag.js';
import { startOfPacificDay } from '../utils/pacificTime.js';

export class BudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BudgetError';
    this.code = code;
    this.status = 429;
  }
}

async function sumBetween(from, to) {
  const rows = await EmbeddingLog.aggregate([
    { $match: { createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: null, total: { $sum: '$count' } } },
  ]);
  return rows[0]?.total ?? 0;
}

export async function getEmbeddingUsage(now = new Date()) {
  const minute = await sumBetween(new Date(now.getTime() - 60 * 1000), now);
  const day = await sumBetween(startOfPacificDay(now), now);
  return { minute, day };
}

/**
 * Call this BEFORE sending `count` texts to be embedded.
 * Records the usage, or throws a BudgetError if it would pass our caps.
 */
export async function reserveEmbeddings(count, kind = 'document', now = new Date()) {
  const usage = await getEmbeddingUsage(now);

  if (usage.minute + count > RAG.EMBED_PER_MINUTE) {
    throw new BudgetError(
      'EMBED_BUSY',
      'The AI is busy processing other documents. Please try again in a minute.'
    );
  }
  if (usage.day + count > RAG.EMBED_PER_DAY) {
    throw new BudgetError(
      'EMBED_DAILY',
      'The shared document-processing budget for today is used up. Please try again tomorrow.'
    );
  }

  await EmbeddingLog.create({ count, kind, createdAt: now });
}