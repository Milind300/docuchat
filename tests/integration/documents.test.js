import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { Document } from '../../src/models/Document.js';
import { Chunk } from '../../src/models/Chunk.js';
import { Message } from '../../src/models/Message.js';
import { EmbeddingLog } from '../../src/models/EmbeddingLog.js';
import { RAG } from '../../src/config/rag.js';
import { startDb, clearDb, stopDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';
import { rawMessages, newId, earlyToday, justAfterMidnight } from '../helpers/messages.js';

// Only the call to Gemini is faked. Extraction, chunking, budgets and the database are real.
const embed = vi.hoisted(() => ({ embedDocuments: vi.fn(), embedQuery: vi.fn() }));
vi.mock('../../src/services/embeddings.js', () => embed);

const MIN = 60 * 1000;
const fakeVector = () => Array(RAG.EMBED_DIMENSIONS).fill(0.01);

const PARAGRAPH = 'The office is open on weekdays from eight in the morning until six in the evening. Visitors must sign in at the front desk. ';
const SAMPLE = PARAGRAPH.repeat(12);                           // about 1,500 characters: a few chunks
const TOO_BIG = 'Lorem ipsum dolor sit amet. '.repeat(3000);   // 84,000 characters: far more than 60 chunks

// A small valid PDF with correct byte offsets, so any PDF reader accepts it
function tinyPdf(line) {
  const stream = `BT /F1 18 Tf 20 100 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

let me;
let errorSpy;

beforeAll(async () => { await startDb(); });
afterAll(async () => { await stopDb(); });

beforeEach(async () => {
  await clearDb();
  me = await makeUser('me@example.com');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // the app logs ingest failures
  embed.embedDocuments.mockReset();
  embed.embedQuery.mockReset();
  embed.embedDocuments.mockImplementation(async (texts) => texts.map(fakeVector));
});
afterEach(() => { errorSpy.mockRestore(); });

// ----- helpers -----
const upload = (token, content = SAMPLE, filename = 'notes.txt', contentType = 'text/plain', field = 'file') => {
  const req = request(app).post('/api/documents');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.attach(field, Buffer.isBuffer(content) ? content : Buffer.from(content), { filename, contentType });
};

const get = (token) => {
  const req = request(app).get('/api/documents');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const del = (id, token) => {
  const req = request(app).delete(`/api/documents/${id}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const mkDoc = (u, props = {}) =>
  Document.create({ userId: u.user._id, filename: 'doc.txt', status: 'READY', chunkCount: 2, mimeType: 'text/plain', ...props });

const mkChunks = (doc, count = 2) =>
  Chunk.insertMany(
    Array.from({ length: count }, (_, i) => ({
      userId: doc.userId, documentId: doc._id, index: i, text: `chunk ${i}`, embedding: fakeVector(),
    }))
  );

// Inserts documents with exact timestamps (Mongoose would overwrite them)
const rawDocs = (rows) =>
  Document.collection.insertMany(
    rows.map((r) => ({ mimeType: 'text/plain', status: 'READY', chunkCount: 1, charCount: 10, error: '', deletedAt: null, ...r, updatedAt: r.createdAt }))
  );

const failure = (message, status) => Object.assign(new Error(message), { status });

describe('POST /api/documents: what the upload route refuses', () => {
  it('requires login', async () => {
    const res = await upload(undefined);
    expect(res.status).toBe(401);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
    expect(await Document.countDocuments()).toBe(0);
  });

  it('asks for a file when none is sent', async () => {
    const res = await request(app).post('/api/documents').set('Authorization', `Bearer ${me.token}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No file received.');
  });

  it('refuses a file sent under the wrong field name', async () => {
    const res = await upload(me.token, 'text', 'a.txt', 'text/plain', 'photo');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Upload failed. Send one file in the field named "file".');
    expect(await Document.countDocuments()).toBe(0);
  });

  it('refuses a file over 4 MB', async () => {
    const huge = Buffer.alloc(4 * 1024 * 1024 + 1024, 97);
    const res = await upload(me.token, huge, 'huge.txt');
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('That file is too large. The limit is 4 MB.');
    expect(await Document.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });

  it('refuses types other than PDF and TXT, and creates nothing', async () => {
    const res = await upload(me.token, 'not really an image', 'photo.png', 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only PDF and TXT files are supported.');
    expect(await Document.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });

  it('refuses a damaged PDF with a friendly message', async () => {
    const res = await upload(me.token, 'this is not a pdf at all', 'broken.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Could not read this file. It may be damaged or password-protected.');
    expect(await Document.countDocuments()).toBe(0);
  });

  it('refuses a file with no readable text, without creating a document or using budget', async () => {
    const res = await upload(me.token, '   \n  \n ', 'blank.txt');
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('No readable text found in this file.');
    expect(await Document.countDocuments()).toBe(0);
    expect(await EmbeddingLog.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });

  it('refuses a document of more than 60 chunks, without creating a document or using budget', async () => {
    const res = await upload(me.token, TOO_BIG, 'enormous.txt');
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/^This document is too large/);
    expect(res.body.message).toContain(`The limit is ${RAG.MAX_CHUNKS_PER_DOCUMENT}`);
    expect(await Document.countDocuments()).toBe(0);
    expect(await EmbeddingLog.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });
});

describe('POST /api/documents: a successful upload', () => {
  it('reads the text, splits it, embeds it and saves everything', async () => {
    const res = await upload(me.token);
    expect(res.status).toBe(201);
    const { document } = res.body;
    expect(document).toMatchObject({ filename: 'notes.txt', status: 'READY' });
    expect(document.chunkCount).toBeGreaterThanOrEqual(2);

    const stored = await Document.findById(document.id);
    expect(stored.status).toBe('READY');
    expect(String(stored.userId)).toBe(me.id);
    expect(stored.chunkCount).toBe(document.chunkCount);
    expect(stored.charCount).toBe(SAMPLE.trim().length);

    const chunks = await Chunk.find({ documentId: document.id }).sort({ index: 1 }).select('+embedding');
    expect(chunks).toHaveLength(document.chunkCount);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(String(c.userId)).toBe(me.id);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.embedding).toHaveLength(RAG.EMBED_DIMENSIONS);
    }
  });

  it('sends every chunk to the embedder in one call, and counts them against the shared budget', async () => {
    const res = await upload(me.token);
    const count = res.body.document.chunkCount;

    expect(embed.embedDocuments).toHaveBeenCalledTimes(1);
    expect(embed.embedDocuments.mock.calls[0][0]).toHaveLength(count);

    const logs = await EmbeddingLog.find();
    expect(logs).toHaveLength(1);
    expect(logs[0].count).toBe(count);
    expect(logs[0].kind).toBe('document');
  });

  it('reads a real PDF', async () => {
    const res = await upload(me.token, tinyPdf('Hello PDF world'), 'hello.pdf', 'application/pdf');
    expect(res.status).toBe(201);
    const chunk = await Chunk.findOne({ documentId: res.body.document.id });
    expect(chunk.text).toContain('Hello PDF world');
  });

  it('cuts a very long file name to 200 characters', async () => {
    const res = await upload(me.token, SAMPLE, 'a'.repeat(300) + '.txt');
    expect(res.status).toBe(201);
    expect((await Document.findById(res.body.document.id)).filename).toHaveLength(200);
  });
});

describe('POST /api/documents: limits and failures', () => {
  it('allows 3 uploads a day, and counts deleted documents too', async () => {
    const ids = [];
    for (let i = 0; i < RAG.MAX_DOCUMENTS_PER_DAY; i++) {
      const res = await upload(me.token, SAMPLE, `doc${i}.txt`);
      expect(res.status).toBe(201);
      ids.push(res.body.document.id);
    }

    const fourth = await upload(me.token);
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('DOCUMENT_DAILY_LIMIT');
    expect(fourth.body.message).toContain('midnight Pacific Time');

    expect((await del(ids[0], me.token)).status).toBe(200);
    const afterDelete = await upload(me.token);
    expect(afterDelete.status).toBe(429); // deleting did not give an upload back
    expect(afterDelete.body.code).toBe('DOCUMENT_DAILY_LIMIT');
  });

  it('does not count other people\'s uploads against my daily limit', async () => {
    const other = await makeUser('other@example.com');
    for (let i = 0; i < RAG.MAX_DOCUMENTS_PER_DAY; i++) await mkDoc(other, { filename: `theirs${i}.txt` });
    expect((await upload(me.token)).status).toBe(201);
  });

  it('refuses when the shared daily embedding budget is used up, creating nothing', async ({ skip }) => {
    if (justAfterMidnight()) skip();
    await EmbeddingLog.create({ count: RAG.EMBED_PER_DAY, kind: 'test', createdAt: earlyToday() });

    const res = await upload(me.token);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('EMBED_DAILY');
    expect(res.body.message).toBe('The shared document budget for today is used up. Please try again tomorrow.');
    expect(await Document.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });

  it('refuses when the shared per-minute embedding budget is used up, creating nothing', async () => {
    await EmbeddingLog.create({ count: RAG.EMBED_PER_MINUTE, kind: 'test' });

    const res = await upload(me.token);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('EMBED_BUSY');
    expect(res.body.message).toBe('Document processing is busy right now. Please try again in a minute.');
    expect(await Document.countDocuments()).toBe(0);
    expect(embed.embedDocuments).not.toHaveBeenCalled();
  });

  it('marks the document FAILED, keeps no chunks, and still counts the budget when the AI fails', async () => {
    embed.embedDocuments.mockRejectedValue(new Error('boom'));

    const res = await upload(me.token);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Could not process the document right now. Please try again.');

    const doc = await Document.findOne();
    expect(doc.status).toBe('FAILED');
    expect(doc.error).toBe('boom');
    expect(await Chunk.countDocuments()).toBe(0);
    expect(await EmbeddingLog.countDocuments()).toBe(1); // the requests were reserved before the call
  });

  it('says the AI is busy when Gemini is rate limited', async () => {
    embed.embedDocuments.mockRejectedValue(failure('RESOURCE_EXHAUSTED', 429));

    const res = await upload(me.token);
    expect(res.status).toBe(429);
    expect(res.body.message).toBe('The AI is busy right now. Please try again in a minute.');
    expect((await Document.findOne()).status).toBe('FAILED');
    expect(await Chunk.countDocuments()).toBe(0);
  });
});

describe('GET /api/documents', () => {
  it('requires login', async () => {
    expect((await get()).status).toBe(401);
  });

  it('starts empty', async () => {
    const res = await get(me.token);
    expect(res.status).toBe(200);
    expect(res.body.documents).toEqual([]);
  });

  it('lists only my documents, newest first, and hides deleted ones', async () => {
    const t = Date.now();
    const other = await makeUser('other@example.com');
    await rawDocs([
      { userId: me.user._id, filename: 'old.txt', createdAt: new Date(t - 3 * MIN) },
      { userId: me.user._id, filename: 'newest.txt', createdAt: new Date(t - 1 * MIN) },
      { userId: me.user._id, filename: 'gone.txt', status: 'DELETED', createdAt: new Date(t - 2 * MIN) },
      { userId: other.user._id, filename: 'theirs.txt', createdAt: new Date(t) },
    ]);

    const res = await get(me.token);
    expect(res.body.documents.map((d) => d.filename)).toEqual(['newest.txt', 'old.txt']);
  });

  it('sends only what the list needs', async () => {
    await mkDoc(me);
    const [doc] = (await get(me.token)).body.documents;
    expect(doc).toMatchObject({ filename: 'doc.txt', status: 'READY', chunkCount: 2 });
    for (const secret of ['userId', 'mimeType', 'charCount', 'deletedAt']) expect(doc).not.toHaveProperty(secret);
  });

  it('shows failed documents with their reason', async () => {
    await mkDoc(me, { status: 'FAILED', chunkCount: 0, error: 'No readable text found in this file.' });
    const [doc] = (await get(me.token)).body.documents;
    expect(doc.status).toBe('FAILED');
    expect(doc.error).toBe('No readable text found in this file.');
  });

  it('returns at most 50 documents, the newest', async () => {
    const t = Date.now();
    await rawDocs(Array.from({ length: 55 }, (_, i) => ({ userId: me.user._id, filename: `doc ${i}`, createdAt: new Date(t - i * MIN) })));
    const { documents } = (await get(me.token)).body;
    expect(documents).toHaveLength(50);
    expect(documents[0].filename).toBe('doc 0');
    expect(documents[49].filename).toBe('doc 49');
  });
});

describe('DELETE /api/documents/:id', () => {
  it('requires login', async () => {
    const doc = await mkDoc(me);
    expect((await del(doc._id)).status).toBe(401);
    expect((await Document.findById(doc._id)).status).toBe('READY');
  });

  it('rejects a bad id and an unknown id', async () => {
    const bad = await del('abc', me.token);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Invalid document id');

    const unknown = await del(newId(), me.token);
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('Document not found');
  });

  it('will not delete another user\'s document, and leaves it and its chunks untouched', async () => {
    const other = await makeUser('other@example.com');
    const theirs = await mkDoc(other);
    await mkChunks(theirs);

    const res = await del(theirs._id, me.token);
    expect(res.status).toBe(404);
    expect((await Document.findById(theirs._id)).status).toBe('READY');
    expect(await Chunk.countDocuments({ documentId: theirs._id })).toBe(2);
  });

  it('will not delete a document that is still processing', async () => {
    const busy = await mkDoc(me, { status: 'PROCESSING', chunkCount: 0 });
    await mkChunks(busy);

    const res = await del(busy._id, me.token);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This document is still being processed. Try again in a moment.');
    expect((await Document.findById(busy._id)).status).toBe('PROCESSING');
    expect(await Chunk.countDocuments({ documentId: busy._id })).toBe(2);
  });

  it('removes the chunks, keeps the record as DELETED, and hides it from the list', async () => {
    const A = await mkDoc(me, { filename: 'A.txt' });
    const B = await mkDoc(me, { filename: 'B.txt' });
    await mkChunks(A);
    await mkChunks(B);

    const res = await del(A._id, me.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await Chunk.countDocuments({ documentId: A._id })).toBe(0);
    expect(await Chunk.countDocuments({ documentId: B._id })).toBe(2); // the other document is untouched

    const kept = await Document.findById(A._id);
    expect(kept.status).toBe('DELETED');
    expect(kept.chunkCount).toBe(0);
    expect(kept.deletedAt).toBeInstanceOf(Date);
    expect(kept.filename).toBe('A.txt');

    const list = (await get(me.token)).body.documents;
    expect(list.map((d) => d.filename)).toEqual(['B.txt']);
  });

  it('removes the document from the sources of my old answers, and only mine', async () => {
    const other = await makeUser('other@example.com');
    const A = await mkDoc(me, { filename: 'A.txt' });
    const B = await mkDoc(me, { filename: 'B.txt' });
    const src = (doc, i) => ({ documentId: doc._id, filename: doc.filename, chunkIndex: i, score: 0.9, snippet: 'x' });

    await rawMessages([
      { userId: me.user._id, conversationId: newId(), role: 'assistant', content: 'mine', sources: [src(A, 0), src(B, 1)] },
      { userId: other.user._id, conversationId: newId(), role: 'assistant', content: 'theirs', sources: [src(A, 0)] },
    ]);

    await del(A._id, me.token);

    const mine = await Message.findOne({ content: 'mine' });
    expect(mine.sources.map((s) => s.filename)).toEqual(['B.txt']);
    const theirs = await Message.findOne({ content: 'theirs' });
    expect(theirs.sources).toHaveLength(1);
  });

  it('can delete a failed document', async () => {
    const failed = await mkDoc(me, { status: 'FAILED', chunkCount: 0, error: 'boom' });
    expect((await del(failed._id, me.token)).status).toBe(200);
    expect((await Document.findById(failed._id)).status).toBe('DELETED');
  });

  it('answers 404 the second time', async () => {
    const doc = await mkDoc(me);
    expect((await del(doc._id, me.token)).status).toBe(200);
    expect((await del(doc._id, me.token)).status).toBe(404);
  });
});