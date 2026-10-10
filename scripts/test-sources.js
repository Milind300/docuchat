import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

let convoId = null;

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const user = await User.findOne();
  if (!user) throw new Error('No user found.');

  const convo = await Conversation.create({ userId: user._id, title: 'SOURCES-TEST' });
  convoId = convo._id;

  await Message.create({
    conversationId: convo._id,
    userId: user._id,
    role: 'assistant',
    content: 'test answer',
    sources: [
      {
        documentId: new mongoose.Types.ObjectId(),
        filename: 'a.pdf',
        chunkIndex: 2,
        score: 0.85,
        snippet: 'some text',
      },
    ],
  });

  const saved = await Message.findOne({ conversationId: convo._id });
  console.log('Sources saved:', saved.sources.length, '| first:', saved.sources[0].filename, 'chunk', saved.sources[0].chunkIndex);

  const older = await Message.findOne({ conversationId: { $ne: convo._id } });
  console.log('An older message has an empty sources list:', Array.isArray(older?.sources) && older.sources.length === 0);
} catch (err) {
  console.error('Test failed:', err.message);
} finally {
  if (convoId) {
    const m = await Message.deleteMany({ conversationId: convoId });
    const c = await Conversation.deleteMany({ _id: convoId });
    console.log('Cleaned up: messages', m.deletedCount, '| conversations', c.deletedCount);
  }
  await mongoose.disconnect();
}