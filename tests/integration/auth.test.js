import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';

const PASSWORD = 'Password123';

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

const register = (email = 'me@example.com', password = PASSWORD) =>
  request(app).post('/api/auth/register').send({ email, password });

describe('server basics', () => {
  it('answers the health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('serves the page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('DocuChat');
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('register', () => {
  it('creates an account and returns a token', async () => {
    const res = await register('Me@Example.com');
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('me@example.com');
  });

  it('never returns the password or its hash, and stores only a bcrypt hash', async () => {
    const res = await register();
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('passwordHash');

    const stored = await User.findOne({ email: 'me@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('refuses a duplicate email, whatever the capitals', async () => {
    expect((await register('me@example.com')).status).toBe(201);
    const again = await register('ME@example.com');
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('Email already registered');
    expect(await User.countDocuments()).toBe(1);
  });

  it('lets only one of several simultaneous registrations of one email through', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => register('race@example.com')));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect(await User.countDocuments()).toBe(1);
  });

  it('refuses a short password and creates nothing', async () => {
    const res = await register('me@example.com', 'short');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Password must be at least 8 characters');
    expect(await User.countDocuments()).toBe(0);
  });

  it('refuses an email sent as an object (database operator injection)', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: { $ne: null }, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });
});

describe('login', () => {
  beforeEach(async () => { await register('me@example.com'); });

  it('logs in with the right password, whatever the email capitals', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ME@Example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('me@example.com');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'me@example.com', password: 'WrongPassword9' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.message).toBe('Invalid email or password');
  });

  it('refuses operator objects instead of passing them to the database', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});

describe('tokens and /api/auth/me', () => {
  async function tokenFor(email = 'me@example.com') {
    const res = await register(email);
    return { token: res.body.token, id: res.body.user.id };
  }

  it('returns the current user for a valid token', async () => {
    const { token, id } = await tokenFor();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id, email: 'me@example.com' });
  });

  it('refuses a missing or malformed header', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Token abc')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer ')).status).toBe(401);
  });

  it('refuses a token with a damaged signature', async () => {
    const { token } = await tokenFor();
    const [header, payload] = token.split('.');
    const forged = `${header}.${payload}.${'A'.repeat(43)}`;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  it('refuses a token signed with a different secret', async () => {
    const { id } = await tokenFor();
    const other = jwt.sign({ sub: id }, 'some-other-secret-that-is-long-enough-123456');
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${other}`)).status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const { id } = await tokenFor();
    const expired = jwt.sign({ sub: id, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('refuses a valid token once its user no longer exists', async () => {
    const { token, id } = await tokenFor();
    await User.deleteOne({ _id: id });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('User no longer exists');
  });
});

describe('malformed requests get clean errors, never a crash', () => {
  it('answers a non-JSON body with 400, not 500', async () => {
    const res = await request(app).post('/api/auth/login').type('form').send('x=1');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Email and password are required');
  });

  it('answers broken JSON with 400', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request body is not valid JSON');
  });

  it('answers an oversized body with 413', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a'.repeat(200_000), password: 'x' });
    expect(res.status).toBe(413);
  });
});