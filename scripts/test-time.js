import { startOfPacificDay, nextPacificReset } from '../src/utils/pacificTime.js';

const now = new Date();
const start = startOfPacificDay(now);
const reset = nextPacificReset(now);

console.log('Now (UTC):            ', now.toISOString());
console.log('Pacific day started:  ', start.toISOString());
console.log('Next reset (UTC):     ', reset.toISOString());
console.log('Next reset (India):   ', reset.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));