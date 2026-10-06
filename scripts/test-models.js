import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log('Connected to MongoDB');

  // 1. Pick any existing user (you registered one earlier)
  const user = await User.findOne();
  if (!user) throw new Error('No user found. Register one in the browser first.');
  console.log('Using user:', user.email);

  // 2. Create a conversation (the folder)
  const convo = await Conversation.create({ userId: user._id, title: 'Test chat' });
  console.log('Created conversation:', String(convo._id));

  // 3. Add two messages (the pages)
  await Message.create({
    conversationId: convo._id,
    userId: user._id,
    role: 'user',
    content: 'What is an index?',
  });
  await Message.create({
    conversationId: convo._id,
    userId: user._id,
    role: 'assistant',
    content: 'An index is a sorted lookup structure.',
    tokensIn: 12,
    tokensOut: 8,
  });

  // 4. Read them back, oldest first
  const messages = await Message.find({ conversationId: convo._id }).sort({ createdAt: 1 });
  console.log('Messages in this conversation:');
  for (const m of messages) console.log(' -', m.role + ':', m.content);
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  await mongoose.disconnect();
}