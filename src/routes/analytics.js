import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Message } from '../models/Message.js';
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

export default router;