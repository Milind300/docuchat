import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';

const router = Router();

// GET /api/conversations  -> the logged-in user's chats, newest first
router.get('/', requireAuth, async (req, res) => {
  const conversations = await Conversation.find({ userId: req.user.id })
    .sort({ updatedAt: -1 })
    .limit(50)
    .select('title updatedAt');

  res.json({ conversations });
});

// GET /api/conversations/:id/messages  -> one chat's messages, oldest first
router.get('/:id/messages', requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid conversation id' });
  }

  // The conversation must belong to this user
  const convo = await Conversation.findOne({ _id: id, userId: req.user.id });
  if (!convo) {
    return res.status(404).json({ message: 'Conversation not found' });
  }

  const messages = await Message.find({ conversationId: convo._id })
    .sort({ createdAt: 1 })
    .limit(200)
    .select('role content createdAt sources');

  res.json({ conversationId: convo._id, title: convo.title, messages });
});

// DELETE /api/conversations/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid conversation id' });
  }

  const convo = await Conversation.findOne({ _id: id, userId });
  if (!convo) {
    return res.status(404).json({ message: 'Conversation not found' });
  }

  // 1. Remove the answers (and their sources)
  await Message.deleteMany({ conversationId: convo._id, userId, role: 'assistant' });

  // 2. Keep the question rows so usage limits stay honest, but erase the text
  await Message.updateMany(
    { conversationId: convo._id, userId, role: 'user' },
    { $set: { content: '[deleted]' } }
  );

  // 3. Last: remove the conversation itself. If anything above failed, the chat is still
  //    listed and the delete can simply be tried again.
  await Conversation.deleteOne({ _id: convo._id });

  res.json({ ok: true });
});

export default router;