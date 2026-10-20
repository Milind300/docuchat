import jwt from 'jsonwebtoken';
import { User } from '../../src/models/User.js';

// Makes a user directly in the database (no slow password hashing) and a login token for them
export async function makeUser(email = 'me@example.com') {
  const user = await User.create({ email, passwordHash: 'not-a-real-hash' });
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  return { user, id: String(user._id), token };
}