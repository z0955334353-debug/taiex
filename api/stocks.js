// Vercel Serverless Function — proxy for Taiwan stock lists
// GET /api/stocks?type=twse  → TWSE listed stocks
// GET /api/stocks?type=tpex  → TPEx OTC stocks
// GET /api/stocks            → both combined

export const config = { runtime: 'edge' };

const TWSE_URLS = [
  'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d',
];

const TPEX_URLS = [
  'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_perday_quotes',
  'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
];

async function tryFetch(urls, codeKey, nameKey) {
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockProxy/1.0)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || data.length < 10) continue;
      const stocks = [];
      for (const s of data) {
        // support both object-style and positional keys
        const code = (s[codeKey] || s['Code'] || s['SecuritiesCompanyCode'] || s['股票代號'] || '').toString().trim();
        const name = (s[nameKey] || s['Name'] || s['CompanyName'] || s['股票名稱'] || '').toString().trim();
        if (code && name && /^\d{4,6}/.test(code)) stocks.push({ code, name });
      }
      if (stocks.length > 100) return stocks;
    } catch (_) {}
  }
  return null;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'both';

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    let twse = [], tpex = [];

    if (type === 'twse' || type === 'both') {
      twse = await tryFetch(TWSE_URLS, 'Code', 'Name') || [];
    }
    if (type === 'tpex' || type === 'both') {
      tpex = await tryFetch(TPEX_URLS, 'SecuritiesCompanyCode', 'CompanyName') || [];
    }

    const result = {
      twse: twse.map(s => ({ ...s, ex: '上市' })),
      tpex: tpex.map(s => ({ ...s, ex: '上櫃' })),
      total: twse.length + tpex.length,
      ts: Date.now(),
    };

    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, twse: [], tpex: [], total: 0 }), {
      status: 500, headers,
    });
  }
}
