import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { generateReply } from '../services/gemini.js';
import { checkLimits } from '../services/usage.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_LIMIT = 10; // how many earlier messages the AI "remembers"

// POST /api/chat   body: { message, conversationId? }
router.post('/', requireAuth, async (req, res) => {
  const { message, conversationId } = req.body;
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

  // 5. Ask Gemini (nothing is saved yet)
  let reply;
  try {
    reply = await generateReply([...history, { role: 'user', content: text }]);
  } catch (err) {
    console.error('Gemini error:', err.status, err.message);
    return res.status(502).json({ message: 'The AI could not answer right now. Please try again.' });
  }

  // 6. Create the conversation if this was the first message
  if (!convo) {
    convo = await Conversation.create({ userId, title: text.slice(0, 50) });
  }

  // 7. Save both messages
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
  });

  // 8. Touch the conversation so it sorts as "most recent"
  convo.updatedAt = new Date();
  await convo.save();

  res.json({ conversationId: convo._id, reply: reply.text });
});

export default router;