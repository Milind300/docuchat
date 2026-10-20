import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { LIMITS } from '../../src/config/limits.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';
import { rawMessages, newId, earlyToday, justAfterMidnight } from '../helpers/messages.js';

// These routes never call the AI, but the chat route is used once below, so it is faked
const ai = vi.hoisted(() => ({ generateReply: vi.fn(), generateCitedReply: vi.fn(), streamReply: vi.fn() }));
vi.mock('../../src/services/gemini.js', () => ai);
vi.mock('../../src/services/search.js', () => ({ searchChunks: vi.fn() }));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let me;

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });
beforeEach(async () => {
  await clearDb();
  me = await makeUser('me@example.com');
  ai.generateReply.mockReset();
});

const get = (path, token) => {
  const r = request(app).get(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const del = (path, token) => {
  const r = request(app).delete(path);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

// Inserts conversations with exact timestamps (Mongoose would overwrite them)
const rawConversations = (rows) =>
  Conversation.collection.insertMany(rows.map((r) => ({ ...r, createdAt: r.updatedAt })));

// A chat with two questions and two answers, one of them with a source
async function seedChat(u, title) {
  const convo = await Conversation.create({ userId: u.user._id, title });
  const base = { userId: u.user._id, conversationId: convo._id };
  await rawMessages([
    { ...base, role: 'user', content: `secret question 1 ${title}`, tokensIn: 10, createdAt: new Date(Date.now() - 4 * MIN) },
    { ...base, role: 'assistant', content: `secret answer 1 ${title}`, tokensOut: 5, createdAt: new Date(Date.now() - 3 * MIN),
      sources: [{ documentId: newId(), filename: 'a.pdf', chunkIndex: 0, score: 0.9, snippet: 'secret snippet' }] },
    { ...base, role: 'user', content: `secret question 2 ${title}`, tokensIn: 12, createdAt: new Date(Date.now() - 2 * MIN) },
    { ...base, role: 'assistant', content: `secret answer 2 ${title}`, tokensOut: 6, createdAt: new Date(Date.now() - 1 * MIN) },
  ]);
  return convo;
}

describe('GET /api/conversations', () => {
  it('requires login', async () => {
    expect((await get('/api/conversations')).status).toBe(401);
  });

  it('starts empty', async () => {
    const res = await get('/api/conversations', me.token);
    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
  });

  it('lists only my chats, most recent activity first', async () => {
    const t = Date.now();
    const other = await makeUser('other@example.com');
    await rawConversations([
      { userId: me.user._id, title: 'old', updatedAt: new Date(t - 3 * HOUR) },
      { userId: me.user._id, title: 'newest', updatedAt: new Date(t - 1 * MIN) },
      { userId: me.user._id, title: 'middle', updatedAt: new Date(t - 1 * HOUR) },
      { userId: other.user._id, title: 'someone else\'s', updatedAt: new Date(t) },
    ]);

    const res = await get('/api/conversations', me.token);
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c) => c.title)).toEqual(['newest', 'middle', 'old']);
  });

  it('sends only what the sidebar needs', async () => {
    await rawConversations([{ userId: me.user._id, title: 'one', updatedAt: new Date() }]);
    const [chat] = (await get('/api/conversations', me.token)).body.conversations;
    expect(Object.keys(chat).sort()).toEqual(['_id', 'title', 'updatedAt']);
  });

  it('returns at most 50 chats', async () => {
    const t = Date.now();
    await rawConversations(
      Array.from({ length: 55 }, (_, i) => ({ userId: me.user._id, title: `chat ${i}`, updatedAt: new Date(t - i * MIN) }))
    );
    const { conversations } = (await get('/api/conversations', me.token)).body;
    expect(conversations).toHaveLength(50);
    expect(conversations[0].title).toBe('chat 0');
    expect(conversations[49].title).toBe('chat 49');
  });
});

describe('GET /api/conversations/:id/messages', () => {
  it('requires login', async () => {
    expect((await get(`/api/conversations/${newId()}/messages`)).status).toBe(401);
  });

  it('rejects a bad id and an unknown id', async () => {
    const bad = await get('/api/conversations/abc/messages', me.token);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid conversation id');

    const unknown = await get(`/api/conversations/${newId()}/messages`, me.token);
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('Conversation not found');
  });

  it('never shows another user\'s chat', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await seedChat(other, 'private');

    const res = await get(`/api/conversations/${theirs._id}/messages`, me.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('returns the messages oldest first, with sources and only public fields', async () => {
    const convo = await seedChat(me, 'My chat');

    const res = await get(`/api/conversations/${convo._id}/messages`, me.token);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('My chat');
    expect(res.body.conversationId).toBe(String(convo._id));
    expect(res.body.messages.map((m) => m.content)).toEqual([
      'secret question 1 My chat',
      'secret answer 1 My chat',
      'secret question 2 My chat',
      'secret answer 2 My chat',
    ]);

    expect(res.body.messages[1].sources).toEqual([
      { documentId: expect.any(String), filename: 'a.pdf', chunkIndex: 0, score: 0.9, snippet: 'secret snippet' },
    ]);
    expect(res.body.messages[0].sources).toEqual([]);

    expect(Object.keys(res.body.messages[0]).sort()).toEqual(['_id', 'content', 'createdAt', 'role', 'sources']);
    expect(res.body.messages[0]).not.toHaveProperty('userId');
    expect(res.body.messages[0]).not.toHaveProperty('tokensIn');
  });

  it('returns at most 200 messages, the oldest ones', async () => {
    const convo = await Conversation.create({ userId: me.user._id, title: 'long' });
    const t = Date.now();
    await rawMessages(
      Array.from({ length: 205 }, (_, i) => ({
        userId: me.user._id,
        conversationId: convo._id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i + 1}`,
        createdAt: new Date(t - (205 - i) * 1000),
      }))
    );

    const { messages } = (await get(`/api/conversations/${convo._id}/messages`, me.token)).body;
    expect(messages).toHaveLength(200);
    expect(messages[0].content).toBe('m1');
    expect(messages[199].content).toBe('m200');
  });
});

describe('DELETE /api/conversations/:id', () => {
  it('requires login', async () => {
    const convo = await seedChat(me, 'mine');
    expect((await del(`/api/conversations/${convo._id}`)).status).toBe(401);
    expect(await Conversation.exists({ _id: convo._id })).toBeTruthy();
  });

  it('rejects a bad id and an unknown id', async () => {
    const bad = await del('/api/conversations/abc', me.token);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid conversation id');
    expect((await del(`/api/conversations/${newId()}`, me.token)).status).toBe(404);
  });

  it('will not delete another user\'s chat, and leaves it untouched', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await seedChat(other, 'private');

    const res = await del(`/api/conversations/${theirs._id}`, me.token);
    expect(res.status).toBe(404);
    expect(await Conversation.exists({ _id: theirs._id })).toBeTruthy();
    expect(await Message.countDocuments({ conversationId: theirs._id })).toBe(4);
    expect(await Message.countDocuments({ conversationId: theirs._id, content: /^secret/ })).toBe(4);
  });

  it('removes the chat and the answers, and erases the text of the questions', async () => {
    const convo = await seedChat(me, 'to delete');

    const res = await del(`/api/conversations/${convo._id}`, me.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await Conversation.exists({ _id: convo._id })).toBeNull();
    expect(await Message.countDocuments({ conversationId: convo._id, role: 'assistant' })).toBe(0);
    expect(await Message.countDocuments({ content: /secret/ })).toBe(0); // no trace of the text anywhere

    const questions = await Message.find({ conversationId: convo._id, role: 'user' });
    expect(questions).toHaveLength(2); // kept, so usage counts stay honest
    for (const q of questions) {
      expect(q.content).toBe('[deleted]');
      expect(String(q.userId)).toBe(me.id);
    }
    expect(questions.map((q) => q.tokensIn).sort()).toEqual([10, 12]); // the token numbers are kept
  });

  it('leaves my other chats alone', async () => {
    const doomed = await seedChat(me, 'doomed');
    const keeper = await seedChat(me, 'keeper');

    await del(`/api/conversations/${doomed._id}`, me.token);

    expect(await Message.countDocuments({ conversationId: keeper._id })).toBe(4);
    expect(await Message.countDocuments({ conversationId: keeper._id, content: /^secret/ })).toBe(4);
    const list = (await get('/api/conversations', me.token)).body.conversations;
    expect(list.map((c) => c.title)).toEqual(['keeper']);
  });

  it('answers 404 the second time', async () => {
    const convo = await seedChat(me, 'once');
    expect((await del(`/api/conversations/${convo._id}`, me.token)).status).toBe(200);
    expect((await del(`/api/conversations/${convo._id}`, me.token)).status).toBe(404);
  });

  it('does not give back the day\'s questions: the limit still applies after deleting', async ({ skip }) => {
    if (justAfterMidnight()) skip();

    const convo = await Conversation.create({ userId: me.user._id, title: 'full day' });
    await rawMessages(
      Array.from({ length: LIMITS.USER_PER_DAY }, () => ({ userId: me.user._id, conversationId: convo._id, createdAt: earlyToday() }))
    );

    expect((await del(`/api/conversations/${convo._id}`, me.token)).status).toBe(200);

    const res = await request(app).post('/api/chat').set('Authorization', `Bearer ${me.token}`).send({ message: 'hello again' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('USER_DAILY_LIMIT');
    expect(ai.generateReply).not.toHaveBeenCalled();
  });
});