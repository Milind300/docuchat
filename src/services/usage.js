import { Message } from '../models/Message.js';
import { LIMITS } from '../config/limits.js';
import { startOfPacificDay, nextPacificReset } from '../utils/pacificTime.js';

/**
 * Decides whether a user may send another question.
 * Returns { allowed: true } or { allowed: false, status, code, message }
 */
export async function checkLimits(userId, now = new Date()) {
  const dayStart = startOfPacificDay(now);
  const minuteAgo = new Date(now.getTime() - 60 * 1000);

  // 1. Too fast? (per user, last minute)
  const lastMinute = await Message.countDocuments({
    userId,
    role: 'user',
    createdAt: { $gte: minuteAgo },
  });
  if (lastMinute >= LIMITS.USER_PER_MINUTE) {
    return {
      allowed: false,
      status: 429,
      code: 'TOO_FAST',
      message: "You're sending messages too fast. Please wait a minute and try again.",
    };
  }

  // 2. Your daily limit
  const userToday = await Message.countDocuments({
    userId,
    role: 'user',
    createdAt: { $gte: dayStart },
  });
  if (userToday >= LIMITS.USER_PER_DAY) {
    const reset = nextPacificReset(now).toUTCString();
    return {
      allowed: false,
      status: 429,
      code: 'USER_DAILY_LIMIT',
      message: `You've used your ${LIMITS.USER_PER_DAY} messages for today. The limit resets at midnight Pacific Time (${reset}).`,
    };
  }

  // 3. The shared budget for the whole app
  const appToday = await Message.countDocuments({
    role: 'user',
    createdAt: { $gte: dayStart },
  });
  if (appToday >= LIMITS.APP_PER_DAY) {
    return {
      allowed: false,
      status: 429,
      code: 'APP_DAILY_LIMIT',
      message: 'The shared AI budget for today is used up. Please try again tomorrow.',
    };
  }

  return { allowed: true };
}