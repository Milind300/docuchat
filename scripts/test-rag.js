import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { searchChunks } from '../src/services/search.js';
import { generateGroundedReply } from '../src/services/gemini.js';

const QUESTIONS = [
  "What is Ronaldo's date of birth and place of birth?", // answerable
  'What is the capital of France?',                       // off topic
  'What is his favourite food?',                          // related, probably absent
];

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne({ email: 'test@example.com' });
  if (!user) throw new Error('test@example.com not found');

  for (const q of QUESTIONS) {
    console.log('\nQ:', q);
    const excerpts = await searchChunks(user._id, q, 4);
    console.log('  scores:', excerpts.map((e) => e.score.toFixed(3)).join('  '));

    const reply = await generateGroundedReply([{ role: 'user', content: q }], excerpts);
    console.log('A:', reply.text.trim());
    console.log('  tokens in/out:', reply.tokensIn, '/', reply.tokensOut);
  }
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  await mongoose.disconnect();
}