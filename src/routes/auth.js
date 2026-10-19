import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { LIMITS } from '../config/limits.js';
import { readCredentials } from '../utils/credentials.js';

const router = Router();

const registerLimit = rateLimit({
  name: 'register',
  max: LIMITS.REGISTER_ATTEMPTS,
  windowSeconds: LIMITS.REGISTER_WINDOW_SECONDS,
});

const loginLimit = rateLimit({
  name: 'login',
  max: LIMITS.LOGIN_ATTEMPTS,
  windowSeconds: LIMITS.LOGIN_WINDOW_SECONDS,
});

function makeToken(user) {
  return jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', registerLimit, async (req, res) => {
  const creds = readCredentials(req.body);
  if (creds.error) {
    return res.status(400).json({ message: creds.error });
  }
  if (creds.password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  const exists = await User.findOne({ email: creds.email });
  if (exists) {
    return res.status(409).json({ message: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(creds.password, 12);

  let user;
  try {
    user = await User.create({ email: creds.email, passwordHash });
  } catch (err) {
    // Two requests registered the same email at the same moment
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    throw err;
  }

  res.status(201).json({ token: makeToken(user), user: { id: user._id, email: user.email } });
});

// POST /api/auth/login
router.post('/login', loginLimit, async (req, res) => {
  const creds = readCredentials(req.body);
  if (creds.error) {
    return res.status(400).json({ message: creds.error });
  }

  // select('+passwordHash') because the model hides it by default
  const user = await User.findOne({ email: creds.email }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(creds.password, user.passwordHash));

  // Same message for "no such user" and "wrong password" so attackers can't tell which emails exist
  if (!ok) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  res.json({ token: makeToken(user), user: { id: user._id, email: user.email } });
});

// GET /api/auth/me  (protected: needs a valid token)
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;