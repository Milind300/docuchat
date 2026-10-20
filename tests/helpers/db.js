import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

// Import the app (and so its models) BEFORE calling this, so the indexes get built
export async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('docuchat-test'));
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

// Empties every collection but keeps the indexes
export async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}