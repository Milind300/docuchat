import mongoose from 'mongoose';
import { Message } from '../../src/models/Message.js';
import { startOfPacificDay } from '../../src/utils/pacificTime.js';

// Inserts messages with exact timestamps (Mongoose would overwrite them)
export function rawMessages(rows) {
  return Message.collection.insertMany(
    rows.map((r) => {
      const when = r.createdAt ?? new Date();
      return { role: 'user', content: 'seed', tokensIn: 0, tokensOut: 0, sources: [], ...r, createdAt: when, updatedAt: when };
    })
  );
}

export const newId = () => new mongoose.Types.ObjectId();

// "Earlier today" for the daily limit: just after Pacific midnight
export const earlyToday = () => new Date(startOfPacificDay().getTime() + 1000);

// In the first two minutes of a Pacific day those seeded messages would count as "the last minute"
export const justAfterMidnight = () => Date.now() - startOfPacificDay().getTime() < 2 * 60 * 1000;