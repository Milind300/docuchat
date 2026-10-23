import { findEnvProblems } from './env.js';

// Runs when the server starts. If settings are wrong, stop now with a clear message.
const problems = findEnvProblems(process.env);

if (problems.length > 0) {
  console.error('\nThe server cannot start. Fix these in your .env file:');
  for (const p of problems) console.error(' - ' + p);
  console.error('');
  process.exit(1);
}