import 'dotenv/config';
import mongoose from 'mongoose';
import { RateLimit } from '../src/models/RateLimit.js';

const BASE = 'http://localhost:4000';

async function post(path, body, raw = false) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, message: json?.message, hasToken: Boolean(json?.token) };
}

const check = (name, ok, got) => console.log(ok ? 'PASS' : 'FAIL', '-', name, ok ? '' : JSON.stringify(got));

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });

  const health = await fetch(BASE + '/api/health').catch(() => null);
  if (!health?.ok) throw new Error('The server is not running on localhost:4000.');

  await RateLimit.deleteMany({});

  let r = await post('/api/auth/login', { email: 'not-an-email', password: 'Password123' });
  check('bad email -> 400', r.status === 400 && r.message === 'Please enter a valid email address', r);

  r = await post('/api/auth/login', { email: { $ne: null }, password: 'x' });
  check('email sent as an object -> 400', r.status === 400 && r.message === 'Email and password are required', r);

  r = await post('/api/auth/login', '{"email":', true);
  check('broken JSON -> 400', r.status === 400 && r.message === 'Request body is not valid JSON', r);

  r = await post('/api/auth/login', { email: 'me@example.com', password: 'a'.repeat(73) });
  check('73-character password -> 400', r.status === 400 && r.message === 'Password must be 72 characters or fewer', r);

  r = await post('/api/auth/login', { email: 'test@example.com', password: 'Password123' });
  check('real login -> 200 with a token', r.status === 200 && r.hasToken, r);

  r = await post('/api/auth/login', { email: 'test@example.com', password: 'WrongPassword999' });
  check('wrong password -> 401', r.status === 401 && r.message === 'Invalid email or password', r);

  r = await post('/api/auth/register', { email: 'new-person@example.com', password: 'short' });
  check('register with a short password -> 400 (no user created)', r.status === 400 && r.message === 'Password must be at least 8 characters', r);
} catch (err) {
  console.error('\nCheck failed:', err.message);
} finally {
  const cleared = await RateLimit.deleteMany({});
  console.log('\nCleared rate-limit rows:', cleared.deletedCount);
  await mongoose.disconnect();
}