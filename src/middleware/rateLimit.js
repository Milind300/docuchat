import { hit } from '../services/rateLimit.js';

/**
 * Returns an Express middleware that allows `max` requests per `windowSeconds` per IP address.
 * `name` keeps different routes from sharing one counter.
 */
export function rateLimit({ name, max, windowSeconds }) {
  return async (req, res, next) => {
    try {
      const { count, resetAt } = await hit(`${name}:${req.ip}`, windowSeconds);

      if (count > max) {
        const seconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
        const minutes = Math.ceil(seconds / 60);
        res.set('Retry-After', String(seconds));
        return res.status(429).json({
          code: 'RATE_LIMITED',
          message: `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}