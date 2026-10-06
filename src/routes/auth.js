import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function makeToken(user) {
  return jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) {
    return res.status(409).json({ message: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash });

  res.status(201).json({ token: makeToken(user), user: { id: user._id, email: user.email } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  // select('+passwordHash') because the model hides it by default
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));

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