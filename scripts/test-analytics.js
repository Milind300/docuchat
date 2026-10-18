import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Message } from '../src/models/Message.js';
import { LIMITS } from '../src/config/limits.js';
import { startOfPacificDay } from '../src/utils/pacificTime.js';

const BASE = 'http://localhost:4000';
const EMAIL = 'analytics-test@example.invalid';
const HOUR = 60 * 60 * 1000;
const label = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

const convo = new mongoose.Types.ObjectId();

async function get(path, token) {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

const check = (name, ok, detail = '') => console.log(ok ? 'PASS' : 'FAIL', '-', name, detail);

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error('The server is not running on localhost:4000.');

  // Is the new index there?
  await Message.init();
  const indexes = await Message.collection.indexes();
  check('index {userId, createdAt} exists', indexes.some((i) => JSON.stringify(i.key) === '{"userId":1,"createdAt":-1}'));

  // A temporary user (removed at the end)
  await User.deleteMany({ email: EMAIL });
  const user = await User.create({ email: EMAIL, passwordHash: 'not-a-real-hash' });
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // Days, counted back from today in Pacific time
  const todayStart = startOfPacificDay();
  const dayStartAgo = (n) => {
    let c = todayStart;
    for (let i = 0; i < n; i++) c = startOfPacificDay(new Date(c.getTime() - HOUR));
    return c;
  };
  const at = (n) => new Date(dayStartAgo(n).getTime() + HOUR); // 01:00 Pacific on that day

  const mk = (userId, role, when, tokensIn = 0, tokensOut = 0) => ({
    userId, conversationId: convo, role, content: 'analytics test', tokensIn, tokensOut,
    sources: [], createdAt: when, updatedAt: when,
  });

  await Message.collection.insertMany([
    mk(user._id, 'user', at(0), 10),
    mk(user._id, 'assistant', at(0), 0, 5),
    mk(user._id, 'user', at(0), 20),
    mk(user._id, 'user', at(1), 4),
    mk(user._id, 'assistant', at(1), 0, 6),
    mk(user._id, 'user', at(3), 1),
    mk(user._id, 'user', at(40), 999),                         // too old for a 7-day window
    mk(new mongoose.Types.ObjectId(), 'user', at(0), 500),     // another user
  ]);

  // ---- Requests ----
  check('no token -> 401', (await get('/api/analytics/summary')).status === 401);
  for (const bad of ['abc', '0', '61', '1.5']) {
    check(`days=${bad} -> 400`, (await get(`/api/analytics/summary?days=${bad}`, token)).status === 400);
  }

  const def = await get('/api/analytics/summary', token);
  check('default window is 14 days', def.status === 200 && def.body.days.length === 14);

  const r = await get('/api/analytics/summary?days=7', token);
  const b = r.body;
  check('days=7 -> 200 with 7 entries', r.status === 200 && b.days.length === 7);

  const expectedDates = [6, 5, 4, 3, 2, 1, 0].map((n) => label.format(dayStartAgo(n)));
  check('dates are consecutive, oldest first', JSON.stringify(b.days.map((d) => d.date)) === JSON.stringify(expectedDates));

  const by = (n) => b.days[6 - n];
  check('today: 2 questions, 30 in, 5 out', by(0).questions === 2 && by(0).tokensIn === 30 && by(0).tokensOut === 5, JSON.stringify(by(0)));
  check('yesterday: 1 question, 4 in, 6 out', by(1).questions === 1 && by(1).tokensIn === 4 && by(1).tokensOut === 6);
  check('3 days ago: 1 question, 1 in', by(3).questions === 1 && by(3).tokensIn === 1);
  check('quiet days are zero', [2, 4, 5, 6].every((n) => by(n).questions === 0 && by(n).tokensIn === 0));
  check('totals: 4 questions, 35 in, 11 out',
    b.totals.questions === 4 && b.totals.tokensIn === 35 && b.totals.tokensOut === 11, JSON.stringify(b.totals));
  check('old and other-user messages are excluded', b.totals.tokensIn === 35);
  check('today shows the daily limit', b.today.questions === 2 && b.today.limit === LIMITS.USER_PER_DAY);
} catch (err) {
  console.error('\nTest failed:', err.message);
} finally {
  const m = await Message.deleteMany({ conversationId: convo });
  const u = await User.deleteMany({ email: EMAIL });
  console.log('\nCleaned up: messages', m.deletedCount, '| users', u.deletedCount);
  console.log('Left behind: messages', await Message.countDocuments({ conversationId: convo }),
    '| users', await User.countDocuments({ email: EMAIL }));
  await mongoose.disconnect();
}