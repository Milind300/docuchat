import 'dotenv/config';
import { findEnvProblems } from '../src/config/env.js';

const problems = findEnvProblems(process.env);

if (problems.length === 0) {
  console.log('All settings look fine.');
} else {
  console.log('Problems found:');
  for (const p of problems) console.log(' -', p);
}