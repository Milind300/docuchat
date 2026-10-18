import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { startOfPacificDay } from '../src/utils/pacificTime.js';

const BASE = 'http://localhost:4000';
const tokenFor = (u) => jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function del(id, token) {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return `HTTP ${res.status} ${(await res.text()).slice(0, 60)}`;
}

let convoId = null;

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error('The server is not running on localhost:4000.');

  const owner = await User.findOne({ email: 'test@example.com' });
  const other = await User.findOne({ email: 'me@example.com' });
  if (!owner || !other) throw new Error('Both test accounts are needed.');

  // A chat with one question and one answer that has a source
  const convo = await Conversation.create({ userId: owner._id, title: '[delete test] chat' });
  convoId = convo._id;
  await Message.create({ conversationId: convo._id, userId: owner._id, role: 'user', content: 'secret question', tokensIn: 5 });
  await Message.create({
    conversationId: convo._id, userId: owner._id, role: 'assistant', content: 'secret answer', tokensOut: 7,
    sources: [{ documentId: new mongoose.Types.ObjectId(), filename: 'x.pdf', chunkIndex: 0, score: 0.9, snippet: 'secret snippet' }],
  });

  const dayStart = startOfPacificDay();
  const countQuestions = () => Message.countDocuments({ userId: owner._id, role: 'user', createdAt: { $gte: dayStart } });
  const before = await countQuestions();

  console.log('1. no token                 ->', await del(convoId));
  console.log('2. bad id                   ->', await del('abc', tokenFor(owner)));
  console.log("3. another user's token     ->", await del(convoId, tokenFor(other)));
  console.log('   chat still exists?       ->', Boolean(await Conversation.exists({ _id: convoId })));
  console.log('4. the owner deletes it     ->', await del(convoId, tokenFor(owner)));
  console.log('5. deleting it again        ->', await del(convoId, tokenFor(owner)));

  const left = await Message.find({ conversationId: convoId });
  console.log('\nAfter the delete:');
  console.log('   conversation exists      ->', Boolean(await Conversation.exists({ _id: convoId })));
  console.log('   answers left             ->', left.filter((m) => m.role === 'assistant').length);
  console.log('   question rows left       ->', left.filter((m) => m.role === 'user').length,
    '| text:', JSON.stringify(left.find((m) => m.role === 'user')?.content));
  console.log('   questions counted today  -> before', before, '| after', await countQuestions());
} catch (err) {
  console.error('\nTest failed:', err.message);
} finally {
  if (convoId) {
    const m = await Message.deleteMany({ conversationId: convoId });
    const c = await Conversation.deleteMany({ _id: convoId });
    console.log('\nCleaned up: messages', m.deletedCount, '| conversations', c.deletedCount);
  }
  await mongoose.disconnect();
}