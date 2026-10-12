import { RateLimit } from '../models/RateLimit.js';

/**
 * Counts one attempt for `key` in the current time window.
 * Returns { count, resetAt }. The caller decides whether count is too high.
 */
export async function hit(key, windowSeconds, now = new Date()) {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);
  const bucket = `${key}:${windowStart}`;

  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt: new Date(resetAt.getTime() + 60 * 1000) },
  };
  const options = { upsert: true, returnDocument: 'after' };

  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate({ bucket }, update, options);
  } catch (err) {
    // Two requests created the same new bucket at once. The loser retries as a plain update.
    if (err.code !== 11000) throw err;
    doc = await RateLimit.findOneAndUpdate({ bucket }, update, options);
  }

  return { count: doc.count, resetAt };
}