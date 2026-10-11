import 'dotenv/config';
import mongoose from 'mongoose';
import { EmbeddingLog } from '../src/models/EmbeddingLog.js';
import { reserveEmbeddings, getEmbeddingUsage, BudgetError } from '../src/services/embeddingBudget.js';
import { RAG } from '../src/config/rag.js';

async function attempt(label, count) {
  try {
    await reserveEmbeddings(count, 'test');
    console.log(label, '-> allowed');
  } catch (err) {
    if (err instanceof BudgetError) console.log(label, '-> refused:', err.code);
    else throw err;
  }
}

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await EmbeddingLog.deleteMany({ kind: 'test' });

  console.log('Limits:', RAG.EMBED_PER_MINUTE, 'per minute |', RAG.EMBED_PER_DAY, 'per day');
  console.log('Usage before:', JSON.stringify(await getEmbeddingUsage()));

  await attempt('1. reserve 50 (limit 80 a minute)       ', 50);
  await attempt('2. reserve 40 more (90 is over 80)      ', 40);

  // Pretend 850 requests happened 2 minutes ago: outside the minute window, inside today
  await EmbeddingLog.create({ count: 850, kind: 'test', createdAt: new Date(Date.now() - 120 * 1000) });
  await attempt('3. reserve 20 (day total would be 920)  ', 20);

  console.log('Usage after: ', JSON.stringify(await getEmbeddingUsage()));
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  const gone = await EmbeddingLog.deleteMany({ kind: 'test' });
  console.log('Cleaned up test rows:', gone.deletedCount);
  await mongoose.disconnect();
}