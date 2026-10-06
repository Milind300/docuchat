import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Please log in' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }
    req.user = { id: String(user._id), email: user.email };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}