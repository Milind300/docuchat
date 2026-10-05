import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI?.trim();

  if (!uri) {
    throw new Error('MONGO_URI is missing. Check your .env file.');
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('MONGO_URI must start with mongodb+srv:// (check for quotes or spaces in .env)');
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log('MongoDB connected');
}