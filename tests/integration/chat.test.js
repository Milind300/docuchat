import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { Document } from '../../src/models/Document.js';
import { BudgetError } from '../../src/services/embeddingBudget.js';
import { LIMITS } from '../../src/config/limits.js';
import { RAG } from '../../src/config/rag.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';
import { rawMessages, newId, earlyToday, justAfterMidnight } from '../helpers/messages.js';

// Fake Gemini and fake vector search: each test decides what they return
const ai = vi.hoisted(() => ({
  generateReply: vi.fn(),
  generateCitedReply: vi.fn(),
  streamReply: vi.fn(),
}));
const search = vi.hoisted(() => ({ searchChunks: vi.fn() }));
vi.mock('../../src/services/gemini.js', () => ai);
vi.mock('../../src/services/search.js', () => search);

const NOT_FOUND = 'I could not find anything relevant to that in your uploaded documents.';

let me;
let errorSpy;

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });

beforeEach(async () => {
  await clearDb();
  me = await makeUser('me@example.com');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // the app logs AI failures
  for (const fn of [ai.generateReply, ai.generateCitedReply, ai.streamReply, search.searchChunks]) fn.mockReset();
  ai.generateReply.mockResolvedValue({ text: 'Hello there!', tokensIn: 5, tokensOut: 3 });
  search.searchChunks.mockResolvedValue([]);
});
afterEach(() => { errorSpy.mockRestore(); });

const ask = (body, token = me.token) =>
  request(app).post('/api/chat').set('Authorization', `Bearer ${token}`).send(body);

const failure = (message, status) => Object.assign(new Error(message), { status });

describe('POST /api/chat: plain chat', () => {
  it('requires login', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(ai.generateReply).not.toHaveBeenCalled();
  });

  it('rejects bad input without calling the AI or saving anything', async () => {
    for (const body of [{}, { message: '' }, { message: '   ' }, { message: 123 }, { message: { $ne: 1 } }]) {
      const res = await ask(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Message is required');
    }
    const tooLong = await ask({ message: 'a'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toContain('2000');

    const badId = await ask({ message: 'hi', conversationId: 'abc' });
    expect(badId.status).toBe(400);
    expect(badId.body.message).toBe('Invalid conversation id');

    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(await Conversation.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('answers, and saves the question and the answer with their token counts', async () => {
    const res = await ask({ message: 'Say hello' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Hello there!');
    expect(res.body.sources).toEqual([]);

    const convo = await Conversation.findOne();
    expect(String(convo._id)).toBe(res.body.conversationId);
    expect(convo.title).toBe('Say hello');
    expect(String(convo.userId)).toBe(me.id);

    const messages = await Message.find().sort({ createdAt: 1 });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('Say hello');
    expect(messages[0].tokensIn).toBe(5);
    expect(messages[1].content).toBe('Hello there!');
    expect(messages[1].tokensOut).toBe(3);
  });

  it('cuts the chat title at 50 characters', async () => {
    await ask({ message: 'x'.repeat(100) });
    expect((await Conversation.findOne()).title).toHaveLength(50);
  });

  it('continues a conversation and sends the earlier messages as history', async () => {
    const first = await ask({ message: 'First' });
    const second = await ask({ message: 'Second', conversationId: first.body.conversationId });
    expect(second.status).toBe(200);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    expect(ai.generateReply.mock.calls[1][0]).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Hello there!' },
      { role: 'user', content: 'Second' },
    ]);
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await Message.countDocuments()).toBe(4);
  });

  it('sends at most the last 10 earlier messages', async () => {
    const convo = await Conversation.create({ userId: me.user._id, title: 'long chat' });
    await rawMessages(
      Array.from({ length: 12 }, (_, i) => ({
        userId: me.user._id,
        conversationId: convo._id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i + 1}`,
        createdAt: new Date(Date.now() - (13 - (i + 1)) * 10 * 60 * 1000),
      }))
    );

    await ask({ message: 'What next?', conversationId: String(convo._id) });

    const sent = ai.generateReply.mock.calls[0][0].map((m) => m.content);
    expect(sent).toEqual(['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'What next?']);
  });

  it('does not let you continue someone else\'s conversation', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await Conversation.create({ userId: other.user._id, title: 'private' });

    const res = await ask({ message: 'hi', conversationId: String(theirs._id) });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Conversation not found');
    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(await Message.countDocuments()).toBe(0);
  });

  it('answers 502 and saves nothing when the AI fails', async () => {
    ai.generateReply.mockRejectedValue(failure('boom', 500));
    const res = await ask({ message: 'hi' });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('The AI could not answer right now. Please try again.');
    expect(await Conversation.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('answers 429 with a friendly message when Gemini is rate limited', async () => {
    ai.generateReply.mockRejectedValue(failure('RESOURCE_EXHAUSTED', 429));
    const res = await ask({ message: 'hi' });
    expect(res.status).toBe(429);
    expect(res.body.message).toBe('The AI is busy right now. Please try again in a minute.');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('keeps earlier messages when a later question fails', async () => {
    const first = await ask({ message: 'First' });
    ai.generateReply.mockRejectedValue(failure('boom', 500));
    const res = await ask({ message: 'Second', conversationId: first.body.conversationId });
    expect(res.status).toBe(502);
    expect(await Message.countDocuments()).toBe(2);
  });
});

describe('POST /api/chat: usage limits', () => {
  it('blocks a fourth question within a minute, without calling the AI or saving it', async () => {
    for (let i = 0; i < LIMITS.USER_PER_MINUTE; i++) {
      expect((await ask({ message: `question ${i}` })).status).toBe(200);
    }
    const blocked = await ask({ message: 'one too many' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_FAST');
    expect(ai.generateReply).toHaveBeenCalledTimes(LIMITS.USER_PER_MINUTE);
    expect(await Message.countDocuments()).toBe(LIMITS.USER_PER_MINUTE * 2);
  });

  it('blocks the 21st question of the day', async ({ skip }) => {
    if (justAfterMidnight()) skip();
    await rawMessages(
      Array.from({ length: LIMITS.USER_PER_DAY }, () => ({ userId: me.user._id, conversationId: newId(), createdAt: earlyToday() }))
    );
    const res = await ask({ message: 'one more' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('USER_DAILY_LIMIT');
    expect(res.body.message).toContain('midnight Pacific Time');
    expect(ai.generateReply).not.toHaveBeenCalled();
  });

  it('does not count other people\'s questions against your daily limit', async ({ skip }) => {
    if (justAfterMidnight()) skip();
    await rawMessages(
      Array.from({ length: LIMITS.USER_PER_DAY }, () => ({ userId: newId(), conversationId: newId(), createdAt: earlyToday() }))
    );
    expect((await ask({ message: 'my first question' })).status).toBe(200);
  });

  it('blocks everyone once the whole app has used its daily budget', async ({ skip }) => {
    if (justAfterMidnight()) skip();
    await rawMessages(
      Array.from({ length: LIMITS.APP_PER_DAY }, () => ({ userId: newId(), conversationId: newId(), createdAt: earlyToday() }))
    );
    const res = await ask({ message: 'hello?' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('APP_DAILY_LIMIT');
    expect(res.body.message).toBe('The shared AI budget for today is used up. Please try again tomorrow.');
  });
});

describe('POST /api/chat: answering from documents', () => {
  let doc;

  beforeEach(async () => {
    doc = await Document.create({ userId: me.user._id, filename: 'policy.pdf', status: 'READY', chunkCount: 3, mimeType: 'application/pdf' });
  });

  const chunk = (index, score, text = `Passage ${index}`, documentId = doc._id) => ({ text, index, documentId, score });
  const askDocs = (message = 'What are the opening hours?') => ask({ message, useDocuments: true });

  it('says so when there are no finished documents', async () => {
    await Document.deleteMany({});
    await Document.create({ userId: me.user._id, filename: 'old.pdf', status: 'DELETED', mimeType: 'application/pdf' });

    const res = await askDocs();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_DOCUMENTS');
    expect(search.searchChunks).not.toHaveBeenCalled();
  });

  it('searches only for this user, with the question and the configured number of results', async () => {
    await askDocs('Where is the office?');
    expect(search.searchChunks).toHaveBeenCalledWith(me.id, 'Where is the office?', RAG.TOP_K);
  });

  it('answers "not found" without calling the chat model when nothing is close enough', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, RAG.MIN_SCORE - 0.05)]);

    const res = await askDocs();
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(NOT_FOUND);
    expect(res.body.sources).toEqual([]);
    expect(ai.generateCitedReply).not.toHaveBeenCalled();

    const saved = await Message.findOne({ role: 'assistant' });
    expect(saved.content).toBe(NOT_FOUND);
    expect(saved.tokensOut).toBe(0);
  });

  it('sends only the close passages to the AI and returns just the sources it used', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, 0.9), chunk(1, 0.8), chunk(2, 0.6)]);
    ai.generateCitedReply.mockResolvedValue({ text: 'It opens at 8:00.', tokensIn: 20, tokensOut: 6, used: [1] });

    const res = await askDocs();
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('It opens at 8:00.');

    const [history, excerpts] = ai.generateCitedReply.mock.calls[0];
    expect(excerpts.map((e) => e.index)).toEqual([0, 1]); // the 0.6 passage was filtered out
    expect(history.at(-1)).toEqual({ role: 'user', content: 'What are the opening hours?' });

    expect(res.body.sources).toEqual([{ filename: 'policy.pdf', chunkIndex: 0, score: 0.9, snippet: 'Passage 0' }]);

    const saved = await Message.findOne({ role: 'assistant' });
    expect(saved.sources).toHaveLength(1);
    expect(String(saved.sources[0].documentId)).toBe(String(doc._id));
    expect(saved.tokensOut).toBe(6);
  });

  it('shows every close passage when the AI\'s source line could not be read', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, 0.9), chunk(1, 0.8)]);
    ai.generateCitedReply.mockResolvedValue({ text: 'An answer.', tokensIn: 1, tokensOut: 1, used: null });
    const res = await askDocs();
    expect(res.body.sources.map((s) => s.chunkIndex)).toEqual([0, 1]);
  });

  it('shows no sources when the AI says it used none', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, 0.9)]);
    ai.generateCitedReply.mockResolvedValue({ text: 'I could not find the answer in the uploaded documents.', tokensIn: 1, tokensOut: 1, used: [] });
    const res = await askDocs();
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
  });

  it('caps each source quote at 700 characters', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, 0.9, 'a'.repeat(1000))]);
    ai.generateCitedReply.mockResolvedValue({ text: 'x', tokensIn: 1, tokensOut: 1, used: [1] });
    const res = await askDocs();
    expect(res.body.sources[0].snippet).toHaveLength(700);
  });

  it('never reveals the name of a document that belongs to someone else', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await Document.create({ userId: other.user._id, filename: 'secret-plans.pdf', status: 'READY', mimeType: 'application/pdf' });
    search.searchChunks.mockResolvedValue([chunk(0, 0.9, 'Passage', theirs._id)]);
    ai.generateCitedReply.mockResolvedValue({ text: 'x', tokensIn: 1, tokensOut: 1, used: [1] });

    const res = await askDocs();
    expect(res.body.sources[0].filename).toBe('document');
    expect(JSON.stringify(res.body)).not.toContain('secret-plans');
  });

  it('refuses with the budget message when the shared embedding budget is used up', async () => {
    search.searchChunks.mockRejectedValue(
      new BudgetError('EMBED_BUSY', 'Document processing is busy right now. Please try again in a minute.')
    );
    const res = await askDocs();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('EMBED_BUSY');
    expect(res.body.message).toBe('Document processing is busy right now. Please try again in a minute.');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('answers 502 and saves nothing when the AI fails on a document question', async () => {
    search.searchChunks.mockResolvedValue([chunk(0, 0.9)]);
    ai.generateCitedReply.mockRejectedValue(failure('boom', 500));
    const res = await askDocs();
    expect(res.status).toBe(502);
    expect(await Conversation.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
  });
});