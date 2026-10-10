import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Document } from '../models/Document.js';
import { generateReply, generateGroundedReply } from '../services/gemini.js';
import { searchChunks } from '../services/search.js';
import { checkLimits } from '../services/usage.js';
import { RAG } from '../config/rag.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_LIMIT = 10; // how many earlier messages the AI "remembers"
const NOT_FOUND_REPLY = 'I could not find anything relevant to that in your uploaded documents.';

// POST /api/chat   body: { message, conversationId?, useDocuments? }
router.post('/', requireAuth, async (req, res) => {
  const { message, conversationId } = req.body;
  const useDocuments = req.body.useDocuments === true;
  const userId = req.user.id;

  // 1. Check the message
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'Message is required' });
  }
  const text = message.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ message: `Message must be under ${MAX_MESSAGE_LENGTH} characters` });
  }

  // 2. Check the usage limits (before spending any Gemini quota)
  const limit = await checkLimits(userId);
  if (!limit.allowed) {
    return res.status(limit.status).json({ code: limit.code, message: limit.message });
  }

  // 3. Find the conversation (it must belong to this user), or start a new one
  let convo = null;
  let history = [];

  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }
    convo = await Conversation.findOne({ _id: conversationId, userId });
    if (!convo) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // 4. Load the most recent messages, then put them back in order
    const recent = await Message.find({ conversationId: convo._id })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT);
    history = recent.reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  const fullHistory = [...history, { role: 'user', content: text }];

  // 5. Get the answer (nothing is saved yet)
  let reply;
  let sources = [];

  try {
    if (useDocuments) {
      const hasDocuments = await Document.exists({ userId, status: 'READY' });
      if (!hasDocuments) {
        return res.status(400).json({
          code: 'NO_DOCUMENTS',
          message: 'You have not uploaded any documents yet.',
        });
      }

      // Search your own chunks, keep only the close ones
      const found = await searchChunks(userId, text, RAG.TOP_K);
      const relevant = found.filter((c) => c.score >= RAG.MIN_SCORE);

      if (relevant.length === 0) {
        // Nothing close enough: answer without spending a chat request
        reply = { text: NOT_FOUND_REPLY, tokensIn: 0, tokensOut: 0 };
      } else {
        const docs = await Document.find({
          _id: { $in: relevant.map((c) => c.documentId) },
          userId,
        }).select('filename');
        const names = new Map(docs.map((d) => [String(d._id), d.filename]));

        sources = relevant.map((c) => ({
          documentId: c.documentId,
          filename: names.get(String(c.documentId)) ?? 'document',
          chunkIndex: c.index,
          score: Number(c.score.toFixed(3)),
          snippet: c.text.slice(0, 200),
        }));

        reply = await generateGroundedReply(fullHistory, relevant);
      }
    } else {
      reply = await generateReply(fullHistory);
    }
  } catch (err) {
    console.error('AI error:', err.status, err.message);
    if (err.status === 429) {
      return res.status(429).json({ message: 'The AI is busy right now. Please try again in a minute.' });
    }
    return res.status(502).json({ message: 'The AI could not answer right now. Please try again.' });
  }

  // 6. Create the conversation if this was the first message
  if (!convo) {
    convo = await Conversation.create({ userId, title: text.slice(0, 50) });
  }

  // 7. Save both messages (the answer remembers its sources)
  await Message.create({
    conversationId: convo._id,
    userId,
    role: 'user',
    content: text,
    tokensIn: reply.tokensIn,
  });
  await Message.create({
    conversationId: convo._id,
    userId,
    role: 'assistant',
    content: reply.text,
    tokensOut: reply.tokensOut,
    sources,
  });

  // 8. Touch the conversation so it sorts as "most recent"
  convo.updatedAt = new Date();
  await convo.save();

  res.json({
    conversationId: convo._id,
    reply: reply.text,
    sources: sources.map((s) => ({
      filename: s.filename,
      chunkIndex: s.chunkIndex,
      score: s.score,
      snippet: s.snippet,
    })),
  });
});

export default router;