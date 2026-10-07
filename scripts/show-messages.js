import 'dotenv/config';
import mongoose from 'mongoose';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const messages = await Message.find().sort({ createdAt: 1 });
  for (const m of messages) {
    console.log(m.role.padEnd(9), '|', 'in:', m.tokensIn, 'out:', m.tokensOut, '|', m.content.slice(0, 70));
  }
} catch (err) {
  console.error('Failed:', err.message);
} finally {
  await mongoose.disconnect();
}