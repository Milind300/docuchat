const TZ = "America/Los_Angeles";

// Returns the exact moment (as a Date) when the current Pacific-time day began.
export function startOfPacificDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type) => Number(parts.find((p) => p.type === type).value);

  // The Pacific wall-clock time, pretending it is UTC
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  // How far Pacific time is from real UTC right now (negative number)
  // How far Pacific time is from real UTC right now (negative number)
  // We drop the milliseconds, because the wall-clock time above has none
  const nowWholeSeconds = Math.floor(now.getTime() / 1000) * 1000;
  const offset = wallAsUtc - nowWholeSeconds;
  // Pacific midnight, pretending it is UTC, then shifted back to real time
  const midnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));

  return new Date(midnightAsUtc - offset);
}

// About when the next Pacific day starts (can be off by an hour on a daylight-saving change day)
export function nextPacificReset(now = new Date()) {
  return new Date(startOfPacificDay(now).getTime() + 24 * 60 * 60 * 1000);
}
