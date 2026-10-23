import 'dotenv/config';
import './config/startupChecks.js'; // keep this line before app.js: it stops the server early if settings are wrong
import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();
  app.listen(PORT, (err) => {
    if (err) {
      console.error('Failed to listen on port', PORT + ':', err.message);
      process.exit(1);
    }
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});