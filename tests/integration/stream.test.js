import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { LIMITS } from '../../src/config/limits.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';

// Fake Gemini: each test describes what the stream produces
const ai = vi.hoisted(() => ({
  generateReply: vi.fn(),
  generateCitedReply: vi.fn(),
  streamReply: vi.fn(),
}));
vi.mock('../../src/services/gemini.js', () => ai);

let me;
let errorSpy;

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });

beforeEach(async () => {
  await clearDb();
  me = await makeUser('me@example.com');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const fn of [ai.generateReply, ai.generateCitedReply, ai.streamReply]) fn.mockReset();
});
afterEach(() => { errorSpy.mockRestore(); });

// ----- helpers -----
const text = (t) => ({ type: 'text', text: t });
const finish = (tokensIn = 4, tokensOut = 2) => ({ type: 'done', tokensIn, tokensOut });
const failure = (message, status) => Object.assign(new Error(message), { status });

// streaming(text('a'), text('b'), finish()) makes the fake AI produce those pieces.
// An Error in the list is thrown at that point.
const streaming = (...parts) =>
  ai.streamReply.mockImplementation(async function* () {
    for (const part of parts) {
      if (part instanceof Error) throw part;
      yield part;
    }
  });

// Read the whole response as text, whatever its content type
const readAll = (res, done) => {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => done(null, data));
};

const stream = (body, token = me.token) =>
  request(app).post('/api/chat/stream').set('Authorization', `Bearer ${token}`).send(body).buffer(true).parse(readAll);

const events = (res) => res.body.split('\n\n').filter(Boolean).map((block) => JSON.parse(block.replace(/^data: /, '')));
const json = (res) => JSON.parse(res.body);

describe('checks that run before streaming starts (normal JSON errors)', () => {
  it('requires login', async () => {
    const res = await request(app).post('/api/chat/stream').send({ message: 'hi' }).buffer(true).parse(readAll);
    expect(res.status).toBe(401);
    expect(ai.streamReply).not.toHaveBeenCalled();
  });

  it('rejects bad input with status 400', async () => {
    for (const body of [{}, { message: '   ' }, { message: 5 }]) {
      const res = await stream(body);
      expect(res.status).toBe(400);
      expect(json(res).message).toBe('Message is required');
    }
    const badId = await stream({ message: 'hi', conversationId: 'abc' });
    expect(badId.status).toBe(400);
    expect(json(badId).message).toBe('Invalid conversation id');
    expect(ai.streamReply).not.toHaveBeenCalled();
    expect(await Message.countDocuments()).toBe(0);
  });

  it('answers 404 for someone else\'s conversation', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await Conversation.create({ userId: other.user._id, title: 'private' });
    const res = await stream({ message: 'hi', conversationId: String(theirs._id) });
    expect(res.status).toBe(404);
    expect(ai.streamReply).not.toHaveBeenCalled();
  });

  it('answers 429 as normal JSON once the per-minute limit is reached', async () => {
    streaming(text('ok'), finish());
    for (let i = 0; i < LIMITS.USER_PER_MINUTE; i++) {
      expect((await stream({ message: `question ${i}` })).status).toBe(200);
    }
    const blocked = await stream({ message: 'one too many' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/json');
    expect(json(blocked).code).toBe('TOO_FAST');
    expect(ai.streamReply).toHaveBeenCalledTimes(LIMITS.USER_PER_MINUTE);
  });
});

describe('a normal stream', () => {
  it('sends the answer in pieces, then a done event with the conversation id', async () => {
    streaming(text('Hel'), text('lo'), finish(4, 2));

    const res = await stream({ message: 'Say hello' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');

    const evs = events(res);
    expect(evs.map((e) => e.type)).toEqual(['text', 'text', 'done']);
    expect(evs.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Hello');

    const convo = await Conversation.findOne();
    expect(evs[2].conversationId).toBe(String(convo._id));
    expect(convo.title).toBe('Say hello');
  });

  it('saves the question and the full answer with their token counts', async () => {
    streaming(text('Hel'), text('lo'), finish(4, 2));
    await stream({ message: 'Say hello' });

    const messages = await Message.find().sort({ createdAt: 1 });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('Say hello');
    expect(messages[0].tokensIn).toBe(4);
    expect(messages[1].content).toBe('Hello');
    expect(messages[1].tokensOut).toBe(2);
  });

  it('continues a conversation and sends the earlier messages as history', async () => {
    streaming(text('Hello'), finish());
    const first = await stream({ message: 'First' });
    const conversationId = events(first).at(-1).conversationId;

    await stream({ message: 'Second', conversationId });

    expect(ai.streamReply.mock.calls[1][0]).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Second' },
    ]);
    expect(await Conversation.countDocuments()).toBe(1);
    expect(await Message.countDocuments()).toBe(4);
  });
});

describe('when the AI fails', () => {
  it('before any text: sends a friendly error and removes the question and the new chat', async () => {
    streaming(failure('boom', 500));

    const res = await stream({ message: 'Will this work?' });
    expect(res.status).toBe(200); // the stream had already started
    const evs = events(res);
    expect(evs).toEqual([{ type: 'error', message: 'The AI could not answer right now. Please try again.' }]);

    expect(await Message.countDocuments()).toBe(0);
    expect(await Conversation.countDocuments()).toBe(0);
  });

  it('before any text, when rate limited: says the AI is busy', async () => {
    streaming(failure('RESOURCE_EXHAUSTED', 429));
    const evs = events(await stream({ message: 'hi' }));
    expect(evs).toEqual([{ type: 'error', message: 'The AI is busy right now. Please try again in a minute.' }]);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('with an empty answer: treats it as a failure', async () => {
    streaming(finish());
    const evs = events(await stream({ message: 'hi' }));
    expect(evs.map((e) => e.type)).toEqual(['error']);
    expect(await Message.countDocuments()).toBe(0);
    expect(await Conversation.countDocuments()).toBe(0);
  });

  it('on an existing chat: removes only the new question', async () => {
    streaming(text('Hello'), finish());
    const first = await stream({ message: 'First' });
    const conversationId = events(first).at(-1).conversationId;

    streaming(failure('boom', 500));
    await stream({ message: 'Second', conversationId });

    expect(await Message.countDocuments()).toBe(2);
    expect(await Conversation.countDocuments()).toBe(1);
  });

  it('after some text: keeps what arrived and marks it as interrupted', async () => {
    streaming(text('Partial answer here'), failure('connection lost', 500));

    const evs = events(await stream({ message: 'Tell me a lot' }));
    expect(evs.map((e) => e.type)).toEqual(['text', 'error', 'done']);
    expect(evs[1].message).toBe('The answer was cut off. You can ask again.');

    const messages = await Message.find().sort({ createdAt: 1 });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].content).toBe('Partial answer here\n\n(answer interrupted)');
  });
});