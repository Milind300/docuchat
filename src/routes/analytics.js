import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Message } from '../models/Message.js';
import { Document } from '../models/Document.js';
import { LIMITS } from '../config/limits.js';
import { startOfPacificDay } from '../utils/pacificTime.js';

const router = Router();

const TZ = 'America/Los_Angeles';
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const HOUR = 60 * 60 * 1000;

// en-CA prints dates as 2026-10-18
const dayLabel = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The last `count` Pacific days, oldest first, plus the start of the oldest one
function lastDays(count, now = new Date()) {
  const labels = [];
  let cursor = startOfPacificDay(now);
  let oldestStart = cursor;

  for (let i = 0; i < count; i++) {
    labels.push(dayLabel.format(cursor));
    oldestStart = cursor;
    cursor = startOfPacificDay(new Date(cursor.getTime() - HOUR)); // an hour earlier is the previous day
  }
  return { labels: labels.reverse(), from: oldestStart };
}

// GET /api/analytics/summary?days=14  -> my questions and tokens per day
router.get('/summary', requireAuth, async (req, res) => {
  let days = DEFAULT_DAYS;
  if (req.query.days !== undefined) {
    days = Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return res.status(400).json({ message: `days must be a whole number from 1 to ${MAX_DAYS}` });
    }
  }

  const { labels, from } = lastDays(days);

  const rows = await Message.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.user.id), // pipelines do not convert ids for us
        createdAt: { $gte: from },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
        questions: { $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] } },
        tokensIn: { $sum: '$tokensIn' },
        tokensOut: { $sum: '$tokensOut' },
      },
    },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r]));
  const series = labels.map((date) => {
    const r = byDay.get(date);
    return {
      date,
      questions: r?.questions ?? 0,
      tokensIn: r?.tokensIn ?? 0,
      tokensOut: r?.tokensOut ?? 0,
    };
  });

  const totals = series.reduce(
    (t, d) => ({
      questions: t.questions + d.questions,
      tokensIn: t.tokensIn + d.tokensIn,
      tokensOut: t.tokensOut + d.tokensOut,
    }),
    { questions: 0, tokensIn: 0, tokensOut: 0 }
  );

  const today = series[series.length - 1];

  res.json({
    timezone: TZ,
    days: series,
    totals,
    today: { questions: today.questions, limit: LIMITS.USER_PER_DAY },
  });
});

// GET /api/analytics/documents  -> how often each of my documents is cited
router.get('/documents', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);

  // Step 1: one row per (document, answer), so an answer citing 3 passages of one document counts once
  // Step 2: add those up per document
  const cited = await Message.aggregate([
    { $match: { userId, role: 'assistant', 'sources.0': { $exists: true } } },
    { $unwind: '$sources' },
    {
      $group: {
        _id: { doc: '$sources.documentId', msg: '$_id' },
        passages: { $sum: 1 },
        at: { $first: '$createdAt' },
      },
    },
    {
      $group: {
        _id: '$_id.doc',
        answers: { $sum: 1 },
        passages: { $sum: '$passages' },
        lastCitedAt: { $max: '$at' },
      },
    },
  ]);
  const citedBy = new Map(cited.map((c) => [String(c._id), c]));

  const docs = await Document.find({ userId, status: { $ne: 'DELETED' } })
    .select('filename status chunkCount createdAt');

  const documents = docs
    .map((d) => {
      const c = citedBy.get(String(d._id));
      return {
        id: d._id,
        filename: d.filename,
        status: d.status,
        chunkCount: d.chunkCount,
        answers: c?.answers ?? 0,
        passages: c?.passages ?? 0,
        lastCitedAt: c?.lastCitedAt ?? null,
        uploadedAt: d.createdAt,
      };
    })
    .sort((a, b) => b.answers - a.answers || new Date(b.uploadedAt) - new Date(a.uploadedAt));

  const answersWithSources = await Message.countDocuments({
    userId,
    role: 'assistant',
    'sources.0': { $exists: true },
  });

  res.json({
    documents,
    totals: {
      documents: documents.length,
      chunks: documents.reduce((sum, d) => sum + d.chunkCount, 0),
      answersWithSources,
    },
  });
});

export default router;