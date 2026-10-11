import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { searchChunks } from '../src/services/search.js';
import { generateCitedReply } from '../src/services/gemini.js';

const QUESTIONS = [
  "Where was Ronaldo born?",
  "How many Ballon d'Or awards has Ronaldo won?",
  "What is his favourite food?",
];

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne({ email: 'test@example.com' });
  if (!user) throw new Error('test@example.com not found');

  for (const q of QUESTIONS) {
    console.log('\nQ:', q);
    const excerpts = await searchChunks(user._id, q, 4);
    console.log('  excerpts sent:', excerpts.map((e, i) => `[${i + 1}] part ${e.index + 1} (${e.score.toFixed(3)})`).join('  '));

    const r = await generateCitedReply([{ role: 'user', content: q }], excerpts);
    console.log('A:', r.text);
    console.log('  used:', r.used === null ? 'COULD NOT READ the USED line' : JSON.stringify(r.used));
  }
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  await mongoose.disconnect();
}