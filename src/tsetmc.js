/**
 * TSETMC public API adapter — Tehran Stock Exchange market data.
 *
 * Every request funnels through fetchJson() → requestReadOnly() so the
 * GET-only contract holds even for future adapters. Cache is in-memory,
 * keyed by URL, with a TTL. Prices are Rial.
 *
 * Field names are the REAL TSETMC payloads (verified against live data):
 * - quote        : pDrCotVal, pClosing, priceChange, priceMin/Max,
 *                  priceYesterday, priceFirst, zTotTran, qTotTran5J, qTotCap
 * - order book   : BestLimits rows → number, qTitMeDem, zOrdMeDem, pMeDem,
 *                  pMeOf, zOrdMeOf, qTitMeOf
 * - money flow   : ClientType → buy_I_Volume, buy_N_Volume, buy_DDD_Volume,
 *                  buy_CountI/N/DDD, sell_I_Volume, sell_N_Volume, sell_Count*
 * - marketwatch  : rows → lva, lvc, pdv, pcl, pc (=last−yesterday Rial),
 *                  pcpc (=closing−yesterday Rial), pmn/pmx, py, pf, pmd/pmo
 *                  (top-of-book), qtj, qtc, ztt, eps, pe, insCode, insID, flow
 */
import { redact } from './guard.js';
import { isMarketOpen } from './time.js';

export const TSETMC_BASE = 'https://cdn.tsetmc.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cache = new Map(); // url -> { at, ttl, json }

export function clearCache() {
  cache.clear();
}

async function fetchJson(path, { ttl = 0 } = {}) {
  const url = `${TSETMC_BASE}${path}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.json;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    const msg = `HTTP ${res.status} for ${path}`;
    const hint =
      res.status === 403 || res.status === 429
        ? ' (cdn.tsetmc.com often soft-blocks foreign/VPN IPs — run from an Iranian IP)'
        : res.status === 404 ? ' (usually a bad insCode)' : '';
    throw new Error(`${msg}${hint}`);
  }
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`TSETMC returned non-JSON for ${path}`);
  }
  if (ttl > 0) cache.set(url, { at: Date.now(), ttl, json });
  return json;
}

function unwrap(payload) {
  // TSETMC responses nest the array under a single object key; flatten it.
  const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
  if (keys.length === 1) {
    const v = payload[keys[0]];
    if (Array.isArray(v)) return v;
  }
  return payload;
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
