import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { streamReply } from '../services/gemini.js';
import { checkLimits } from '../services/usage.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_LIMIT = 10;

// Sends one Server-Sent Event: a line starting with "data:" followed by a blank line
function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// POST /api/chat/stream   body: { message, conversationId? }   (plain chat, no documents)
router.post('/', requireAuth, async (req, res) => {
  const { message, conversationId } = req.body;
  const userId = req.user.id;

  // ---- Checks. Nothing has been streamed yet, so normal JSON errors still work ----
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'Message is required' });
  }
  const text = message.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ message: `Message must be under ${MAX_MESSAGE_LENGTH} characters` });
  }

  const limit = await checkLimits(userId);
  if (!limit.allowed) {
    return res.status(limit.status).json({ code: limit.code, message: limit.message });
  }

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
    const recent = await Message.find({ conversationId: convo._id })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT);
    history = recent.reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  const fullHistory = [...history, { role: 'user', content: text }];

  // ---- Save the question first, so it counts toward the limits even if the stream is cancelled ----
  const createdConvo = !convo;
  if (createdConvo) {
    convo = await Conversation.create({ userId, title: text.slice(0, 50) });
  }
  const userMsg = await Message.create({
    conversationId: convo._id,
    userId,
    role: 'user',
    content: text,
  });

  // ---- Start the stream ----
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // asks proxies not to hold the data back
  });
  res.flushHeaders();

  let aborted = false;
  res.on('close', () => {
    if (!res.writableEnded) aborted = true; // the browser went away before we finished
  });

  let fullText = '';
  let usage = { tokensIn: 0, tokensOut: 0 };
  let failure = null;

  try {
    for await (const part of streamReply(fullHistory)) {
      if (aborted) break;
      if (part.type === 'text') {
        fullText += part.text;
        send(res, { type: 'text', text: part.text });
      } else if (part.type === 'done') {
        usage = part;
      }
    }
  } catch (err) {
    failure = err;
    console.error('Stream error:', err.status, err.message);
  }

  try {
    // Nothing usable arrived
    if (!fullText) {
      if (aborted) return; // the question stays, the answer never existed

      // The AI failed or returned nothing: this should not cost the user an allowance
      await Message.deleteOne({ _id: userMsg._id });
      if (createdConvo) await Conversation.deleteOne({ _id: convo._id });

      const busy = failure?.status === 429;
      send(res, {
        type: 'error',
        message: busy
          ? 'The AI is busy right now. Please try again in a minute.'
          : 'The AI could not answer right now. Please try again.',
      });
      return res.end();
    }

    // Something arrived: save it (the whole answer, or the part that arrived before a cancel or a failure)
    await Message.updateOne({ _id: userMsg._id }, { tokensIn: usage.tokensIn });
    await Message.create({
      conversationId: convo._id,
      userId,
      role: 'assistant',
      content: fullText,
      tokensOut: usage.tokensOut,
    });
    convo.updatedAt = new Date();
    await convo.save();

    if (aborted) return;

    if (failure) {
      send(res, { type: 'error', message: 'The answer was cut off. You can ask again.' });
    }
    send(res, { type: 'done', conversationId: convo._id });
    res.end();
  } catch (err) {
    console.error('Stream save error:', err.message);
    if (!aborted && !res.writableEnded) {
      send(res, { type: 'error', message: 'Something went wrong while saving the answer.' });
      res.end();
    }
  }
});

export default router;