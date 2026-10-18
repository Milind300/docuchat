import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';

const BASE = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads Server-Sent Events from a response
async function* events(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith('data: ')) yield JSON.parse(block.slice(6));
    }
  }
}

function openStream(token, body, signal) {
  return fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
}

async function saved(convoId) {
  const msgs = await Message.find({ conversationId: convoId }).sort({ createdAt: 1 });
  return msgs.map((m) => `${m.role}(${m.content.length})`).join(' -> ') || '(nothing)';
}

const findConvo = (userId, label) =>
  Conversation.findOne({ userId, title: { $regex: `^\\[cancel test\\] ${label}:` } });

const A = '[cancel test] A: say hello in one short sentence.';
const A2 = '[cancel test] A2: now say goodbye in one short sentence.';
const B = '[cancel test] B: write a detailed 500 word explanation of how the internet works.';

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error('The server is not running on localhost:4000. Start it with npm run dev.');
  console.log('Server: running');

  const user = await User.findOne({ email: 'test@example.com' });
  if (!user) throw new Error('test@example.com not found');
  // A short-lived token made from the secret in .env, so no password is needed here
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // ---------- Test A: cancel before any text arrives ----------
  console.log('\n--- Test A: cancel before any text arrives ---');
  const ctrlA = new AbortController();
  const resA = await openStream(token, { message: A }, ctrlA.signal);
  if (!resA.ok) throw new Error(`Test A was refused: HTTP ${resA.status} ${await resA.text()}`);
  console.log('Connected (HTTP ' + resA.status + '), cancelling now');
  ctrlA.abort();
  await sleep(6000); // let the server notice and finish

  const convoA = await findConvo(user._id, 'A');
  if (!convoA) throw new Error('No conversation was created for Test A');
  console.log('Saved in that chat:', await saved(convoA._id));

  // ---------- Follow-up: the AI now sees two question turns in a row ----------
  console.log('\n--- Follow-up in the same chat (two user turns in a row) ---');
  const res2 = await openStream(token, { message: A2, conversationId: String(convoA._id) });
  console.log('HTTP status:', res2.status);
  if (!res2.ok) {
    console.log('Refused:', await res2.text());
  } else {
    let text = '';
    let ending = '(the stream just stopped)';
    for await (const ev of events(res2)) {
      if (ev.type === 'text') text += ev.text;
      else ending = ev.type + (ev.message ? ': ' + ev.message : '');
    }
    console.log('Answer:', JSON.stringify(text.slice(0, 120)));
    console.log('Stream ended with:', ending);
  }
  await sleep(1000);
  console.log('Saved in that chat:', await saved(convoA._id));

  // ---------- Test B: cancel after the first piece of a long answer ----------
  console.log('\n--- Test B: cancel after the first piece of a long answer ---');
  const ctrlB = new AbortController();
  const resB = await openStream(token, { message: B }, ctrlB.signal);
  if (!resB.ok) throw new Error(`Test B was refused: HTTP ${resB.status} ${await resB.text()}`);
  let seen = 0;
  try {
    for await (const ev of events(resB)) {
      if (ev.type === 'text') {
        seen += ev.text.length;
        ctrlB.abort(); // leave after the first piece
        break;
      }
    }
  } catch {
    /* the abort ends the read with an error, which is expected */
  }
  console.log('The client saw', seen, 'characters before cancelling');
  await sleep(8000); // let the server finish

  const convoB = await findConvo(user._id, 'B');
  console.log('Saved in that chat:', convoB ? await saved(convoB._id) : '(no conversation)');
} catch (err) {
  console.error('\nTest failed:', err.message);
} finally {
  // Remove only the test chats
  const convos = await Conversation.find({ title: { $regex: '^\\[cancel test\\]' } }).select('_id');
  const ids = convos.map((c) => c._id);
  const m = await Message.deleteMany({ conversationId: { $in: ids } });
  const c = await Conversation.deleteMany({ _id: { $in: ids } });
  console.log('\nCleaned up: messages', m.deletedCount, '| conversations', c.deletedCount);
  await mongoose.disconnect();
}