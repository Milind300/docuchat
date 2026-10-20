import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { LIMITS } from '../../src/config/limits.js';
import { hit } from '../../src/services/rateLimit.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

// Counters use fixed time windows. If a window is about to end, wait for the next one
// so a test cannot be split across two windows.
async function avoidWindowBoundary(windowSeconds, marginMs = 5000) {
  const windowMs = windowSeconds * 1000;
  const left = windowMs - (Date.now() % windowMs);
  if (left < marginMs) await new Promise((resolve) => setTimeout(resolve, left + 50));
}

const login = () => request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Password123' });
const badRegister = () => request(app).post('/api/auth/register').send({});

describe('login and register rate limits', () => {
  it('blocks login after the allowed attempts, with a Retry-After header', async () => {
    await avoidWindowBoundary(LIMITS.LOGIN_WINDOW_SECONDS);

    for (let i = 0; i < LIMITS.LOGIN_ATTEMPTS; i++) {
      expect((await login()).status).toBe(401);
    }

    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.message).toContain('Too many attempts');

    const wait = Number(blocked.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(LIMITS.LOGIN_WINDOW_SECONDS);
  });

  it('blocks even a correct password while the limit is exceeded', async () => {
    await avoidWindowBoundary(LIMITS.LOGIN_WINDOW_SECONDS);
    await request(app).post('/api/auth/register').send({ email: 'me@example.com', password: 'Password123' });

    for (let i = 0; i < LIMITS.LOGIN_ATTEMPTS; i++) await login();

    const real = await request(app).post('/api/auth/login').send({ email: 'me@example.com', password: 'Password123' });
    expect(real.status).toBe(429);
  });

  it('blocks register after the allowed attempts, counting refused ones too', async () => {
    await avoidWindowBoundary(LIMITS.REGISTER_WINDOW_SECONDS);

    for (let i = 0; i < LIMITS.REGISTER_ATTEMPTS; i++) {
      expect((await badRegister()).status).toBe(400);
    }
    expect((await badRegister()).status).toBe(429);
  });

  it('keeps the login and register counters apart', async () => {
    await avoidWindowBoundary(LIMITS.LOGIN_WINDOW_SECONDS);

    for (let i = 0; i < LIMITS.LOGIN_ATTEMPTS + 1; i++) await login();
    expect((await login()).status).toBe(429);

    expect((await badRegister()).status).toBe(400); // register is untouched
  });
});

describe('the counter behind the limits', () => {
  const base = Math.ceil((Date.now() + 10 * 24 * 3600 * 1000) / 60000) * 60000; // a minute boundary, 10 days ahead

  it('counts up for one key and starts fresh for another', async () => {
    const counts = [];
    for (let i = 0; i < 4; i++) counts.push((await hit('a', 60, new Date(base + 1000))).count);
    expect(counts).toEqual([1, 2, 3, 4]);
    expect((await hit('b', 60, new Date(base + 1000))).count).toBe(1);
  });

  it('does not lose or repeat a count when requests arrive at the same moment', async () => {
    const hits = await Promise.all(Array.from({ length: 10 }, () => hit('parallel', 60, new Date(base + 2000))));
    expect(hits.map((h) => h.count).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('starts again from 1 in the next window, and reports when the window ends', async () => {
    const a = await hit('w', 60, new Date(base + 10_000));
    const b = await hit('w', 60, new Date(base + 50_000));
    const c = await hit('w', 60, new Date(base + 65_000));
    expect([a.count, b.count, c.count]).toEqual([1, 2, 1]);
    expect(a.resetAt.getTime()).toBe(base + 60_000);
    expect(c.resetAt.getTime()).toBe(base + 120_000);
  });
});