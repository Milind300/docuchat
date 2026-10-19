const TZ = 'America/Los_Angeles';
const HOUR = 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// The Pacific wall-clock reading (year, month, day, hour...) for a moment in time
function wallParts(date) {
  const parts = formatter.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

// How far Pacific time is from UTC at this moment, in milliseconds (a negative number)
function offsetMs(date) {
  const p = wallParts(date);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000; // the wall clock has no milliseconds
  return wallAsUtc - wholeSeconds;
}

// Returns the exact moment (as a Date) when the current Pacific-time day began.
export function startOfPacificDay(now = new Date()) {
  const p = wallParts(now);
  const midnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);

  // First guess, using today's offset from UTC
  const guess = new Date(midnightAsUtc - offsetMs(now));
  // On the days the clocks change, the offset at midnight differs from the one now,
  // so measure it again at the guess and correct.
  return new Date(midnightAsUtc - offsetMs(guess));
}

// The moment the next Pacific-time day starts. 36 hours after a day starts is always
// inside the next day, even when a day is 23 or 25 hours long.
export function nextPacificReset(now = new Date()) {
  return startOfPacificDay(new Date(startOfPacificDay(now).getTime() + 36 * HOUR));
}