import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Document } from '../src/models/Document.js';
import { Message } from '../src/models/Message.js';

const BASE = 'http://localhost:4000';
const EMAIL = 'analytics-docs-test@example.invalid';
const convo = new mongoose.Types.ObjectId();

async function get(path, token) {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

const check = (name, ok, detail = '') => console.log(ok ? 'PASS' : 'FAIL', '-', name, detail);

const src = (doc, chunkIndex) => ({
  documentId: doc._id, filename: doc.filename, chunkIndex, score: 0.9, snippet: 'x',
});

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error('The server is not running on localhost:4000.');

  await User.deleteMany({ email: EMAIL });
  const user = await User.create({ email: EMAIL, passwordHash: 'not-a-real-hash' });
  const other = new mongoose.Types.ObjectId();
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const mkDoc = (filename, status, chunkCount) =>
    Document.create({ userId: user._id, filename, status, chunkCount, mimeType: 'text/plain' });
  const A = await mkDoc('A-popular.txt', 'READY', 10);
  const B = await mkDoc('B-some.txt', 'READY', 5);
  const D = await mkDoc('D-unused.txt', 'READY', 3);
  const C = await mkDoc('C-deleted.txt', 'DELETED', 0);

  const answer = (sources) => Message.create({
    conversationId: convo, userId: user._id, role: 'assistant', content: 'analytics test', sources,
  });
  await answer([src(A, 0), src(A, 2), src(B, 1)]);   // one answer: A twice, B once
  const last = await answer([src(A, 1)]);            // another answer: A once
  await answer([]);                                  // an answer with no sources
  await Message.create({                             // someone else's answer citing A's id
    conversationId: convo, userId: other, role: 'assistant', content: 'analytics test', sources: [src(A, 0)],
  });

  check('no token -> 401', (await get('/api/analytics/documents')).status === 401);

  const r = await get('/api/analytics/documents', token);
  const docs = r.body?.documents ?? [];
  const byName = Object.fromEntries(docs.map((d) => [d.filename, d]));

  check('200 with three live documents', r.status === 200 && docs.length === 3, `(${docs.length} returned)`);
  check('the deleted document is hidden', !byName['C-deleted.txt']);
  check('sorted by answers, most used first',
    JSON.stringify(docs.map((d) => d.filename)) === JSON.stringify(['A-popular.txt', 'B-some.txt', 'D-unused.txt']),
    JSON.stringify(docs.map((d) => d.filename)));
  check('A: 2 answers, 3 passages', byName['A-popular.txt']?.answers === 2 && byName['A-popular.txt']?.passages === 3,
    JSON.stringify(byName['A-popular.txt']));
  check('B: 1 answer, 1 passage', byName['B-some.txt']?.answers === 1 && byName['B-some.txt']?.passages === 1);
  check('D: never cited', byName['D-unused.txt']?.answers === 0 && byName['D-unused.txt']?.lastCitedAt === null);
  check('A lastCitedAt is its newest citation',
    new Date(byName['A-popular.txt']?.lastCitedAt).getTime() === last.createdAt.getTime());
  check('another user\'s citation is not counted', byName['A-popular.txt']?.answers === 2);
  check('totals: 3 documents, 18 chunks, 2 answers with sources',
    r.body?.totals?.documents === 3 && r.body?.totals?.chunks === 18 && r.body?.totals?.answersWithSources === 2,
    JSON.stringify(r.body?.totals));
} catch (err) {
  console.error('\nTest failed:', err.message);
} finally {
  const m = await Message.deleteMany({ conversationId: convo });
  const u = await User.findOne({ email: EMAIL });
  const d = u ? await Document.deleteMany({ userId: u._id }) : { deletedCount: 0 };
  const x = await User.deleteMany({ email: EMAIL });
  console.log('\nCleaned up: messages', m.deletedCount, '| documents', d.deletedCount, '| users', x.deletedCount);
  console.log('Left behind: messages', await Message.countDocuments({ conversationId: convo }),
    '| users', await User.countDocuments({ email: EMAIL }));
  await mongoose.disconnect();
}