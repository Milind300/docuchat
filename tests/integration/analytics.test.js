import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { Document } from '../../src/models/Document.js';
import { LIMITS } from '../../src/config/limits.js';
import { startOfPacificDay } from '../../src/utils/pacificTime.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';
import { rawMessages, newId } from '../helpers/messages.js';

const HOUR = 60 * 60 * 1000;
const label = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Counting back from today in Pacific time
const dayStartAgo = (n) => {
  let c = startOfPacificDay();
  for (let i = 0; i < n; i++) c = startOfPacificDay(new Date(c.getTime() - HOUR));
  return c;
};
const at = (n) => new Date(dayStartAgo(n).getTime() + HOUR); // 01:00 Pacific, n days ago

let me;
const convo = newId();

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });
beforeEach(async () => {
  await clearDb();
  me = await makeUser('me@example.com');
});

const get = (path, token) => {
  const r = request(app).get(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const msg = (userId, role, when, tokensIn = 0, tokensOut = 0) =>
  ({ userId, conversationId: convo, role, content: 'seed', tokensIn, tokensOut, createdAt: when });

async function seedKnownData() {
  await rawMessages([
    msg(me.user._id, 'user', at(0), 10),
    msg(me.user._id, 'assistant', at(0), 0, 5),
    msg(me.user._id, 'user', at(0), 20),
    msg(me.user._id, 'user', at(1), 4),
    msg(me.user._id, 'assistant', at(1), 0, 6),
    msg(me.user._id, 'user', at(3), 1),
    msg(me.user._id, 'user', at(40), 999),          // outside a 7-day window
    msg(newId(), 'user', at(0), 500),               // another user
  ]);
}

describe('GET /api/analytics/summary', () => {
  it('requires login', async () => {
    expect((await get('/api/analytics/summary')).status).toBe(401);
  });

  it('rejects an invalid number of days', async () => {
    for (const days of ['abc', '0', '61', '1.5', '-3']) {
      const res = await get(`/api/analytics/summary?days=${days}`, me.token);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('days must be a whole number from 1 to 60');
    }
  });

  it('returns 14 days by default, and honors 1 and 60', async () => {
    expect((await get('/api/analytics/summary', me.token)).body.days).toHaveLength(14);
    expect((await get('/api/analytics/summary?days=1', me.token)).body.days).toHaveLength(1);
    expect((await get('/api/analytics/summary?days=60', me.token)).body.days).toHaveLength(60);
  });

  it('is all zeros for a user with no activity', async () => {
    const res = await get('/api/analytics/summary?days=3', me.token);
    expect(res.status).toBe(200);
    expect(res.body.days.every((d) => d.questions === 0 && d.tokensIn === 0 && d.tokensOut === 0)).toBe(true);
    expect(res.body.totals).toEqual({ questions: 0, tokensIn: 0, tokensOut: 0 });
    expect(res.body.today).toEqual({ questions: 0, limit: LIMITS.USER_PER_DAY });
    expect(res.body.timezone).toBe('America/Los_Angeles');
  });

  it('lists consecutive Pacific dates, oldest first, ending today', async () => {
    const { days } = (await get('/api/analytics/summary?days=7', me.token)).body;
    expect(days.map((d) => d.date)).toEqual([6, 5, 4, 3, 2, 1, 0].map((n) => label.format(dayStartAgo(n))));
  });

  it('adds up questions and tokens per day, with zeros on quiet days', async () => {
    await seedKnownData();
    const { days } = (await get('/api/analytics/summary?days=7', me.token)).body;
    const by = (n) => days[6 - n];

    expect(by(0)).toMatchObject({ questions: 2, tokensIn: 30, tokensOut: 5 });
    expect(by(1)).toMatchObject({ questions: 1, tokensIn: 4, tokensOut: 6 });
    expect(by(3)).toMatchObject({ questions: 1, tokensIn: 1, tokensOut: 0 });
    for (const n of [2, 4, 5, 6]) expect(by(n)).toMatchObject({ questions: 0, tokensIn: 0, tokensOut: 0 });
  });

  it('totals the window, and leaves out other users and older days', async () => {
    await seedKnownData();
    const week = (await get('/api/analytics/summary?days=7', me.token)).body;
    expect(week.totals).toEqual({ questions: 4, tokensIn: 35, tokensOut: 11 });

    const long = (await get('/api/analytics/summary?days=60', me.token)).body;
    expect(long.totals).toEqual({ questions: 5, tokensIn: 1034, tokensOut: 11 }); // the 40-day-old question now counts
  });

  it('shows today against the daily limit', async () => {
    await seedKnownData();
    const { today } = (await get('/api/analytics/summary', me.token)).body;
    expect(today).toEqual({ questions: 2, limit: LIMITS.USER_PER_DAY });
  });

  it('starts a new day exactly at Pacific midnight', async () => {
    const midnight = dayStartAgo(0);
    await rawMessages([
      msg(me.user._id, 'user', new Date(midnight.getTime() - 1000), 1), // one second before: yesterday
      msg(me.user._id, 'user', midnight, 2),                            // exactly at midnight: today
    ]);
    const { days } = (await get('/api/analytics/summary?days=2', me.token)).body;
    expect(days[0]).toMatchObject({ questions: 1, tokensIn: 1 });
    expect(days[1]).toMatchObject({ questions: 1, tokensIn: 2 });
  });

  it('only ever shows my own numbers', async () => {
    await seedKnownData();
    const other = await makeUser('other@example.com');
    const res = await get('/api/analytics/summary?days=7', other.token);
    expect(res.body.totals).toEqual({ questions: 0, tokensIn: 0, tokensOut: 0 });
  });
});

describe('GET /api/analytics/documents', () => {
  const mkDoc = (u, filename, status, chunkCount) =>
    Document.create({ userId: u.user._id, filename, status, chunkCount, mimeType: 'text/plain' });
  const src = (doc, chunkIndex) => ({ documentId: doc._id, filename: doc.filename, chunkIndex, score: 0.9, snippet: 'x' });

  it('requires login', async () => {
    expect((await get('/api/analytics/documents')).status).toBe(401);
  });

  it('is empty for a user with no documents', async () => {
    const res = await get('/api/analytics/documents', me.token);
    expect(res.status).toBe(200);
    expect(res.body.documents).toEqual([]);
    expect(res.body.totals).toEqual({ documents: 0, chunks: 0, answersWithSources: 0 });
  });

  it('counts how often each document is cited, most used first, and hides deleted ones', async () => {
    const A = await mkDoc(me, 'A-popular.txt', 'READY', 10);
    const B = await mkDoc(me, 'B-some.txt', 'READY', 5);
    await mkDoc(me, 'D-unused.txt', 'READY', 3);
    await mkDoc(me, 'C-deleted.txt', 'DELETED', 0);

    const t1 = new Date(Date.now() - 2 * HOUR);
    const t2 = new Date(Date.now() - 1 * HOUR);
    const answer = (userId, sources, createdAt) =>
      ({ userId, conversationId: convo, role: 'assistant', content: 'seed', sources, createdAt });
    await rawMessages([
      answer(me.user._id, [src(A, 0), src(A, 2), src(B, 1)], t1), // A twice and B once, in one answer
      answer(me.user._id, [src(A, 1)], t2),
      answer(me.user._id, [], t2),                                 // an answer that used no documents
      answer(newId(), [src(A, 0)], t2),                            // someone else's answer
    ]);

    const res = await get('/api/analytics/documents', me.token);
    expect(res.status).toBe(200);

    const names = res.body.documents.map((d) => d.filename);
    expect(names).toEqual(['A-popular.txt', 'B-some.txt', 'D-unused.txt']);

    const [a, b, d] = res.body.documents;
    expect(a).toMatchObject({ answers: 2, passages: 3, chunkCount: 10, status: 'READY' });
    expect(new Date(a.lastCitedAt).getTime()).toBe(t2.getTime());
    expect(b).toMatchObject({ answers: 1, passages: 1 });
    expect(d).toMatchObject({ answers: 0, passages: 0, lastCitedAt: null });

    expect(res.body.totals).toEqual({ documents: 3, chunks: 18, answersWithSources: 2 });
  });

  it('never shows another user\'s documents or citations', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await mkDoc(other, 'their-secret.txt', 'READY', 7);
    await rawMessages([
      { userId: other.user._id, conversationId: convo, role: 'assistant', content: 'seed', sources: [src(theirs, 0)] },
    ]);

    const res = await get('/api/analytics/documents', me.token);
    expect(res.body.documents).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('their-secret');
    expect(res.body.totals).toEqual({ documents: 0, chunks: 0, answersWithSources: 0 });
  });
});