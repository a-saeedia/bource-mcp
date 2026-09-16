/**
 * Tehran market calendar helpers.
 * Session: Saturday–Wednesday 09:00–12:30 (Asia/Tehran).
 * Weekends in Iran are Thursday & Friday.
 */

const OPEN_DAYS = new Set(['Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 12 * 60 + 30;

export function tehranParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function isMarketOpen(date = new Date()) {
  const { weekday, hour, minute } = tehranParts(date);
  if (!OPEN_DAYS.has(weekday)) return false;
  const t = hour * 60 + minute;
  return t >= OPEN_MIN && t <= CLOSE_MIN;
}

export function marketStatus() {
  const { weekday, hour, minute, second } = tehranParts();
  const open = isMarketOpen();
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return {
    market: 'Tehran Stock Exchange (TSE + Fara Bourse via TSETMC)',
    open,
    weekday,
    tehran_time: clock,
    session: 'Sat–Wed 09:00–12:30 Asia/Tehran',
    note: open
      ? 'Market is live now — real-time quotes are current.'
      : 'Market is closed — live quotes will be empty/stale; rely on last closing prices.',
  };
}
