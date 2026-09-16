/**
 * Public TSETMC adapter (no auth required).
 *
 * Base: https://cdn.tsetmc.com/api — the JSON API only answers on cdn. No key.
 * Constraints (from field experience):
 *  - A browser User-Agent is required (the default node UA gets blocked).
 *  - The API favors Iranian IPs; foreign/VPN IPs are commonly soft-blocked.
 *  - Session: Sat–Wed 09:00–12:30 Asia/Tehran. Outside it live prices are empty.
 *  - Rate limits: prefer bulk endpoints; serialize + backoff on 5xx / block text.
 *
 * Everything here is GET-only by construction — see requestReadOnly().
 */
import { redact } from './guard.js';
import { isMarketOpen } from './time.js';

const BASE = 'https://cdn.tsetmc.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BLOCK_RE = /مسدود|دسترسی شما|General Error Detected/i;

const cache = new Map(); // key -> { at, data }
let chain = Promise.resolve(); // serialized upstream fan-out

function serialized(task) {
  const p = chain.then(task, task);
  chain = p.catch(() => {});
  return p;
}

function pull(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  return undefined;
}

async function fetchJson(path, { ttl = 60_000, retries = 3 } = {}) {
  const key = path;
  const cached = pull(key, ttl);
  if (cached !== undefined) return cached;

  const run = async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt)); // backoff
      try {
        const res = await fetch(BASE + path, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        if (!res.ok || BLOCK_RE.test(text) || !text.trim().startsWith('{')) {
          lastErr = new Error(
            `upstream rejected ${path} (http ${res.status}) — is this machine in Iran and NOT on a foreign VPN? ` +
              `TSETMC soft-blocks foreign IPs with ${BLOCK_RE.test(text) ? 'a block message' : 'non-JSON'}.`
          );
          if (attempt < retries) continue;
          throw lastErr;
        }
        const data = JSON.parse(text);
        cache.set(key, { at: Date.now(), data });
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) continue;
        throw new Error(
          `tsetmc network failure for ${path}: ${redact(err.message)} — upstream may be unreachable from this network.`
        );
      }
    }
    throw lastErr;
  };

  return serialized(run);
}

/** Unwrap the single camelCase key TSETMC wraps every response in. */
function unwrap(data) {
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 1 && typeof data[keys[0]] !== 'string') return data[keys[0]];
  }
  return data;
}

export async function searchSymbol(query) {
  const data = unwrap(await fetchJson(`/Instrument/GetInstrumentSearch/${encodeURIComponent(query)}`, { ttl: 10 * 60_000 }));
  const rows = Array.isArray(data) ? data : [];
  return rows.slice(0, 12).map((r) => ({
    insCode: String(r.insCode ?? ''),
    symbol: r.lVal18AFC ?? '',
    name: r.lVal30 ?? '',
    market: marketName(r.flow),
  }));
}

/** Instrument identity (symbol/name/sector/ISIN) — cached 1h, only when needed. */
export async function identity(insCode) {
  const data = unwrap(await fetchJson(`/Instrument/GetInstrumentIdentity/${insCode}`, { ttl: 60 * 60_000 }));
  const r = data ?? {};
  return {
    insCode: String(insCode),
    symbol: r.lVal18AFC ?? r.lVal18 ?? '',
    name: r.lVal30 ?? '',
    company: r.lSoc30 ?? '',
    english: r.lVal18 ?? '',
    isin: r.cIsin ?? '',
    sector: r.sector?.lSecVal ?? null,
    sub_sector: r.subSector?.lSoSecVal ?? null,
    trading_halted: r.yMarNSC === 'YES',
  };
}

export async function quote(insCode) {
  const at = Date.now();
  const raw = unwrap(await fetchJson(`/ClosingPrice/GetClosingPriceInfo/${insCode}`, { ttl: 10_000 }));
  const r = raw ?? {};
  const last = num(r.pDrCotVal);
  const yesterday = num(r.priceYesterday);
  const id = await identity(insCode);
  return {
    insCode: String(insCode),
    symbol: id.symbol || r.instrumentState?.lVal18AFC || '',
    name: id.name || r.instrumentState?.lVal30 || '',
    company: id.company || '',
    isin: id.isin || '',
    sector: id.sector || null,
    last_price: last,                      // Rial
    closing_price: num(r.pClosing),        // Rial
    change: last !== null && yesterday !== null ? Math.round((last - yesterday) * 100) / 100 : null, // Rial
    change_percent: last !== null && yesterday ? Math.round(((last - yesterday) / yesterday) * 10000) / 100 : null,
    first_price: num(r.priceFirst),
    high: num(r.priceMax),
    low: num(r.priceMin),
    yesterday,
    trades: num(r.zTotTran),
    volume: num(r.qTotTran5J),             // shares
    value: num(r.qTotCap),                 // Rial
    trade_date: num(r.dEven) || num(r.finalLastDate), // YYYYMMDD
    market_state: r.instrumentState?.cEtavalTitle ?? null,
    trading_halted: id.trading_halted ?? null,
    unit: 'Rial',
    freshness: {
      market_open: isMarketOpen(),
      staleness_seconds: Math.round((Date.now() - at) / 1000),
      upstream_reachable: true,
    },
  };
}

export async function orderBook(insCode) {
  const data = unwrap(await fetchJson(`/BestLimits/${insCode}`, { ttl: 10_000 }));
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => ({
    level: num(r.number),
    bid_orders: num(r.zOrdMeDem),
    bid_volume: num(r.qTitMeDem),
    bid_price: num(r.pMeDem),
    ask_price: num(r.pMeOf),
    ask_orders: num(r.zOrdMeOf),
    ask_volume: num(r.qTitMeOf),
  }));
}

export async function moneyFlow(insCode) {
  const data = unwrap(await fetchJson(`/ClientType/GetClientType/${insCode}/1/0`, { ttl: 30_000 }));
  const r = Array.isArray(data) ? data[0] : data ?? {};
  const buyReal = num(r.buy_I_Volume) ?? 0;
  const buyLegal = num(r.buy_N_Volume) ?? 0;
  const sellReal = num(r.sell_I_Volume) ?? 0;
  const sellLegal = num(r.sell_N_Volume) ?? 0;
  const id = await identity(insCode);
  return {
    insCode: String(insCode),
    symbol: id.symbol,
    real: {
      buy_volume: buyReal,
      sell_volume: sellReal,
      buy_trades: num(r.buy_CountI),
      sell_trades: num(r.sell_CountI),
    },
    legal: {
      buy_volume: buyLegal,
      sell_volume: sellLegal,
      buy_trades: num(r.buy_CountN),
      sell_trades: num(r.sell_CountN),
    },
    other: {
      buy_volume: num(r.buy_DDD_Volume),
      sell_volume: num(r.sell_DDD_Volume),
      buy_trades: num(r.buy_CountDDD),
      sell_trades: num(r.sell_CountDDD),
    },
    net_real_buy: buyReal - sellReal,          // shares
    net_legal_buy: buyLegal - sellLegal,        // shares
    unit: 'shares (volume)',
  };
}

export async function priceHistory(insCode, top = 260) {
  const data = unwrap(await fetchJson(`/ClosingPrice/GetClosingPriceDailyList/${insCode}/${top}`, { ttl: 60 * 60_000 }));
  const rows = Array.isArray(data) ? data : [];
  return rows.slice(-top).map((r) => {
    const last = num(r.pDrCotVal);
    const yesterday = num(r.priceYesterday);
    return {
      date: num(r.dEven),                  // YYYYMMDD
      last_price: last,
      closing_price: num(r.pClosing),
      change: last !== null && yesterday !== null ? Math.round((last - yesterday) * 100) / 100 : null,
      change_percent: last !== null && yesterday ? Math.round(((last - yesterday) / yesterday) * 10000) / 100 : null,
      high: num(r.priceMax),
      low: num(r.priceMin),
      yesterday,
      first_price: num(r.priceFirst),
      volume: num(r.qTotTran5J),           // shares
      value: num(r.qTotCap),               // Rial
      trades: num(r.zTotTran),
    };
  });
}

export async function marketWatch({ flow = 0, top = 200 } = {}) {
  const data = unwrap(await fetchJson(
    `/ClosingPrice/GetMarketWatch?market=${flow}&paperTypes[0]=1&paperTypes[1]=2&paperTypes[2]=3&paperTypes[3]=4&paperTypes[4]=5&paperTypes[5]=6&paperTypes[6]=7&paperTypes[7]=8&paperTypes[8]=9&withBestLimits=false&hEven=0&RefID=0`,
    { ttl: 15_000 }
  ));
  const rows = Array.isArray(data) ? data : [];
  return rows.slice(0, top).map((r) => {
    const last = num(r.pdv);
    const yesterday = num(r.py);
    return {
      insCode: String(r.insCode ?? ''),
      isin: r.insID ?? '',
      symbol: r.lva ?? '',
      name: r.lvc ?? '',
      last_price: last,
      closing_price: num(r.pcl),
      change: num(r.pc),                              // last - yesterday (Rial)
      change_closing: num(r.pcpc),                    // closing - yesterday (Rial)
      change_percent: last !== null && yesterday ? Math.round(((last - yesterday) / yesterday) * 10000) / 100 : null,
      bid_price: num(r.pmd),
      ask_price: num(r.pmo),
      first_price: num(r.pf),
      high: num(r.pmx),
      low: num(r.pmn),
      yesterday,
      volume: num(r.qtj),
      value: num(r.qtc),
      trades: num(r.ztt),
      eps: num(r.eps),
      pe: r.pe !== null && r.pe !== undefined ? num(r.pe) : null,
      market: marketName(r.flow),
      unit: 'Rial',
    };
  });
}

export async function indexOverview(flow = 1) {
  const data = unwrap(await fetchJson(`/MarketData/GetMarketOverview/${flow}`, { ttl: 30_000 }));
  const r = data ?? {};
  return {
    flow,
    market: flow === 1 ? 'bourse' : 'fara-bourse',
    last_data_date: num(r.lastDataDEven) ?? null,
    index_last: num(r.indexLastValue) ?? null,
    index_change: num(r.indexChange) ?? null,
    index_equal_weighted: num(r.indexEqualWeightedLastValue) ?? null,
    index_equal_weighted_change: num(r.indexEqualWeightedChange) ?? null,
    activity_date: num(r.marketActivityDEven) ?? null,
    trades: num(r.marketActivityZTotTran) ?? null,
    volume: num(r.marketActivityQTotCap) ?? null,
    value: num(r.marketActivityQTitTran) ?? null,
    raw_count: r.raw ? Object.keys(r.raw ?? {}).length : undefined,
  };
}

function marketName(flow) {
  return flow === 1 ? 'bourse' : flow === 2 ? 'fara-bourse' : flow === 4 ? 'payeh' : flow === 3 ? 'option' : String(flow ?? '');
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
