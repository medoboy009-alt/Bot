import crypto from 'crypto';
import type {
  MarketType,
  MexcBalance,
  OrderType,
  TradeSide,
} from '../src/types.ts';

const MEXC_SPOT_BASE = 'https://api.mexc.com';
const MEXC_FUTURES_BASE = 'https://contract.mexc.com';

function signSpotQuery(queryString: string, apiSecret: string): string {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

function signFuturesRequest(
  apiKey: string,
  reqTime: string,
  paramString: string,
  apiSecret: string
): string {
  const payload = `${apiKey}${reqTime}${paramString}`;
  return crypto
    .createHmac('sha256', apiSecret)
    .update(payload)
    .digest('hex');
}

export async function getMexcSpotPrice(symbol: string): Promise<number> {
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const url = `${MEXC_SPOT_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(cleanSymbol)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`تعذر جلب سعر ${cleanSymbol} من MEXC (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { symbol?: string; price?: string };
  const price = Number.parseFloat(data.price ?? '');
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`سعر العملة ${cleanSymbol} غير صالح أو غير مدرج على MEXC Spot.`);
  }
  return price;
}

export async function getMexcBatchPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  const res = await fetch(`${MEXC_SPOT_BASE}/api/v3/ticker/price`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`MEXC ticker error (${res.status})`);
  }
  const rows = (await res.json()) as Array<{ symbol: string; price: string }>;
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (wanted.has(row.symbol)) {
      const p = Number.parseFloat(row.price);
      if (Number.isFinite(p) && p > 0) {
        map[row.symbol] = p;
      }
    }
  }
  return map;
}

export async function getMexcSymbolPrecision(symbol: string): Promise<{
  basePrecision: number;
  quotePrecision: number;
}> {
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    const res = await fetch(
      `${MEXC_SPOT_BASE}/api/v3/exchangeInfo?symbol=${encodeURIComponent(cleanSymbol)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { basePrecision: 4, quotePrecision: 4 };
    const data = (await res.json()) as {
      symbols?: Array<{
        symbol: string;
        baseAssetPrecision?: number;
        quotePrecision?: number;
      }>;
    };
    const info = data.symbols?.[0];
    return {
      basePrecision: info?.baseAssetPrecision ?? 4,
      quotePrecision: info?.quotePrecision ?? 4,
    };
  } catch {
    return { basePrecision: 4, quotePrecision: 4 };
  }
}

export async function verifyMexcSpotAccount(
  apiKey: string,
  apiSecret: string
): Promise<MexcBalance[]> {
  if (!apiKey.trim() || !apiSecret.trim()) {
    throw new Error('يرجى إدخال MEXC API Key و Secret Key أولاً.');
  }
  const timestamp = Date.now();
  const params = new URLSearchParams({
    recvWindow: '5000',
    timestamp: String(timestamp),
  });
  const signature = signSpotQuery(params.toString(), apiSecret.trim());
  params.append('signature', signature);

  const res = await fetch(
    `${MEXC_SPOT_BASE}/api/v3/account?${params.toString()}`,
    {
      headers: {
        'X-MEXC-APIKEY': apiKey.trim(),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  const bodyText = await res.text();
  if (!res.ok) {
    let msg = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { msg?: string; code?: number };
      msg = parsed.msg ? `${parsed.msg} (code ${parsed.code ?? res.status})` : bodyText;
    } catch {
      // keep raw text
    }
    throw new Error(`فشل التحقق من حساب MEXC: ${msg}`);
  }

  const data = JSON.parse(bodyText) as {
    balances?: Array<{ asset: string; free: string; locked: string }>;
  };

  return (data.balances ?? [])
    .map((b) => ({
      asset: b.asset,
      free: Number.parseFloat(b.free),
      locked: Number.parseFloat(b.locked),
    }))
    .filter((b) => b.free > 0 || b.locked > 0 || b.asset === 'USDT')
    .sort((a, b) => (a.asset === 'USDT' ? -1 : b.asset === 'USDT' ? 1 : b.free - a.free))
    .slice(0, 12);
}

export interface PlaceOrderInput {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  marketType: MarketType;
  side: TradeSide;
  orderType: OrderType;
  amountUsdt: number;
  quantity?: number;
  limitPrice?: number | null;
  leverage?: number;
}

export async function placeLiveMexcOrder(input: PlaceOrderInput): Promise<{
  mexcOrderId: string;
  executedPrice: number;
  executedQty: number;
}> {
  const {
    apiKey,
    apiSecret,
    symbol,
    marketType,
    side,
    orderType,
    amountUsdt,
    quantity,
    limitPrice,
    leverage = 1,
  } = input;

  if (!apiKey.trim() || !apiSecret.trim()) {
    throw new Error('لا يمكن التنفيذ الحقيقي بدون ضبط مفاتيح MEXC API.');
  }

  const cleanSymbol = symbol.toUpperCase();
  const livePrice = await getMexcSpotPrice(cleanSymbol);
  const precision = await getMexcSymbolPrecision(cleanSymbol);

  if (marketType === 'FUTURES') {
    const futuresSymbol = cleanSymbol.endsWith('USDT')
      ? `${cleanSymbol.slice(0, -4)}_USDT`
      : cleanSymbol;

    const reqTime = String(Date.now());
    const vol = Math.max(
      1,
      Math.floor((amountUsdt * Math.max(1, leverage)) / livePrice)
    );
    const payloadObj = {
      symbol: futuresSymbol,
      price: orderType === 'LIMIT' && limitPrice ? limitPrice : livePrice,
      vol,
      leverage: Math.max(1, leverage),
      side: side === 'BUY' ? 1 : 3, // 1=open long, 3=open short
      type: orderType === 'LIMIT' ? 1 : 5, // 1=limit, 5=market
      openType: 1, // isolated
    };
    const paramJson = JSON.stringify(payloadObj);
    const signature = signFuturesRequest(
      apiKey.trim(),
      reqTime,
      paramJson,
      apiSecret.trim()
    );

    const res = await fetch(`${MEXC_FUTURES_BASE}/api/v1/private/order/submit`, {
      method: 'POST',
      headers: {
        ApiKey: apiKey.trim(),
        'Request-Time': reqTime,
        Signature: signature,
        'Content-Type': 'application/json',
      },
      body: paramJson,
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    const parsed = JSON.parse(text) as {
      success?: boolean;
      data?: string | number;
      message?: string;
      code?: number;
    };

    if (!res.ok || !parsed.success) {
      throw new Error(
        `فشل أمر MEXC Futures (${parsed.code ?? res.status}): ${parsed.message ?? text}`
      );
    }

    return {
      mexcOrderId: String(parsed.data ?? `FUT-${Date.now()}`),
      executedPrice: payloadObj.price,
      executedQty: vol,
    };
  }

  // MEXC Spot v3 Order
  const timestamp = Date.now();
  const params = new URLSearchParams({
    symbol: cleanSymbol,
    side,
    type: orderType,
    recvWindow: '5000',
    timestamp: String(timestamp),
  });

  let expectedQty = quantity ?? amountUsdt / livePrice;
  const qtyRounded = Number(
    expectedQty.toFixed(Math.min(6, Math.max(2, precision.basePrecision)))
  );

  if (orderType === 'MARKET' && side === 'BUY' && !quantity) {
    params.append('quoteOrderQty', amountUsdt.toFixed(2));
  } else {
    params.append('quantity', String(qtyRounded));
    if (orderType === 'LIMIT') {
      const targetPrice = limitPrice && limitPrice > 0 ? limitPrice : livePrice;
      params.append(
        'price',
        targetPrice.toFixed(Math.min(8, Math.max(2, precision.quotePrecision)))
      );
      params.append('timeInForce', 'GTC');
    }
  }

  const signature = signSpotQuery(params.toString(), apiSecret.trim());
  params.append('signature', signature);

  const res = await fetch(
    `${MEXC_SPOT_BASE}/api/v3/order?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'X-MEXC-APIKEY': apiKey.trim(),
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const errJson = JSON.parse(text) as { msg?: string; code?: number };
      msg = errJson.msg ? `${errJson.msg} (code ${errJson.code ?? res.status})` : text;
    } catch {
      // keep raw
    }
    throw new Error(`فشل تنفيذ أمر MEXC Spot: ${msg}`);
  }

  const data = JSON.parse(text) as {
    orderId?: string;
    price?: string;
    origQty?: string;
  };

  const execPrice = Number.parseFloat(data.price ?? '') || livePrice;
  const execQty = Number.parseFloat(data.origQty ?? '') || qtyRounded;

  return {
    mexcOrderId: String(data.orderId ?? `SPOT-${Date.now()}`),
    executedPrice: execPrice,
    executedQty: execQty,
  };
}
