/**
 * Market session clock — Asia/Tehran.
 * Session: Sat–Wed 09:00–12:30 local. Initiated window keeps the market
 * session open for 30 min after the official close (settlement tail).
 */

const TEHRAN_TZ = 'Asia/Tehran';

export function nowInTehran() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function tehranNow() {
  const parts = nowInTehran().split(/[\/\s:,]+/);
  return {
    date: `${parts[0]}-${parts[1]}-${parts[2]}`, // YYYY-MM-DD
    ymd: Number(`${parts[0]}${parts[1]}${parts[2]}`), // YYYYMMDD
    dow: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TEHRAN_TZ }).format(new Date()),
    hh: Number(parts[3]),
    mm: Number(parts[4]),
  };
}

const NO_TRADE = new Set(['Fri', 'Thu']);

/** True when the Tehran market session is currently open. */
export function isMarketOpen() {
  const n = tehranNow();
  if (NO_TRADE.has(n.dow)) return false;
  const mins = n.hh * 60 + n.mm;
  return mins >= 9 * 60 && mins <= 12 * 60 + 30 + 30; // 09:00–12:30 + 30 min tail
}

export function nextOpen() {
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = nowInTehranAt(now.getTime() + i * 86_400_000);
    const dw = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TEHRAN_TZ }).format(new Date(now.getTime() + i * 86_400_000));
    if (!NO_TRADE.has(dw)) {
      const [y, m, day] = d.split(/[\/\s:,]+/).slice(0, 3).map(Number);
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00`;
    }
  }
  return null;
}

function nowInTehranAt(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts));
}
