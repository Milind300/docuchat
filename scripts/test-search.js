import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { searchChunks } from '../src/services/search.js';

async function ask(user, question) {
  console.log(`\n[${user.email}] ${question}`);
  const results = await searchChunks(user._id, question, 3);
  if (results.length === 0) console.log('  (no results)');
  for (const r of results) {
    console.log(`  score ${r.score.toFixed(3)} | chunk #${r.index} | ${JSON.stringify(r.text.slice(0, 60))}`);
  }
}

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const owner = await User.findOne({ email: 'me@example.com' });
  const other = await User.findOne({ email: 'test@example.com' });
  if (!owner || !other) throw new Error('Both test accounts are needed (me@ and test@example.com).');

  await ask(owner, 'How many days a week can I work from home?');
  await ask(owner, 'What happens if I am sick?');
  await ask(owner, 'What is the capital of France?');
  await ask(other, 'How many days a week can I work from home?');
} catch (err) {
  console.error('Search failed:', err.message);
} finally {
  await mongoose.disconnect();
}