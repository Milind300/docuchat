import 'dotenv/config';
import mongoose from 'mongoose';
import { EmbeddingLog } from '../src/models/EmbeddingLog.js';
import { getEmbeddingUsage } from '../src/services/embeddingBudget.js';
import { RAG } from '../src/config/rag.js';

const command = process.argv[2];

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  if (command === 'fill-day') {
    await EmbeddingLog.create({
      count: RAG.EMBED_PER_DAY,
      kind: 'test',
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
    });
    console.log('Pretending the whole daily budget is used.');
  } else if (command === 'clear') {
    const r = await EmbeddingLog.deleteMany({ kind: 'test' });
    console.log('Removed test rows:', r.deletedCount);
  } else if (command !== 'show') {
    console.log('Usage: node scripts\\budget-tool.js fill-day | clear | show');
  }

  console.log('Usage now:', JSON.stringify(await getEmbeddingUsage()));
  const recent = await EmbeddingLog.find().sort({ createdAt: -1 }).limit(5);
  for (const r of recent) console.log(' -', r.kind, r.count, r.createdAt.toISOString());
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}