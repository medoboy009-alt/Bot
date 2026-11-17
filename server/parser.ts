import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { MarketType, ParsedSignalData } from '../src/types.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function normalizeSymbol(rawSymbol: string): {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
} {
  let clean = rawSymbol
    .toUpperCase()
    .replace(/[#$\s]/g, '')
    .replace(/[_-]/g, '/');

  if (clean.includes('/')) {
    const [base, quote] = clean.split('/');
    const q = quote || 'USDT';
    return {
      symbol: `${base}${q}`,
      baseAsset: base,
      quoteAsset: q,
    };
  }

  const knownQuotes = ['USDT', 'USDC', 'BTC', 'ETH'];
  for (const q of knownQuotes) {
    if (clean.endsWith(q) && clean.length > q.length) {
      const base = clean.slice(0, clean.length - q.length);
      return { symbol: `${base}${q}`, baseAsset: base, quoteAsset: q };
    }
  }

  return {
    symbol: `${clean}USDT`,
    baseAsset: clean,
    quoteAsset: 'USDT',
  };
}

function isResultOrRecapMessage(text: string): boolean {
  const hasEntryAndStop =
    /(?:entries|entry\s*(?:zone|price|range)?|دخول|منطقة الدخول|سعر الدخول)/i.test(
      text
    ) &&
    /(?:stop\s*loss|\bsl\b|ستوب|وقف(?:\s*الخسارة)?)/i.test(text);

  if (hasEntryAndStop) {
    return false;
  }

  return (
    /take[\s-]*profit\s+target\s*\d*/i.test(text) ||
    /\b\d*\s*targets?\s*(?:done|hit|achieved|reached|completed|smashed|cleared)\b/i.test(
      text
    ) ||
    /\btp\s*\d*\s*(?:done|hit|achieved|reached|✅)\b/i.test(text) ||
    /(?:all|both)\s+targets?\s+(?:done|hit|achieved|completed)/i.test(text) ||
    /profit\s*[:\-]?\s*\+?\s*\d+(?:\.\d+)?\s*%/i.test(text) ||
    /\+\s*\d+(?:\.\d+)?\s*%\s*profit/i.test(text) ||
    /(?:✅|🎉|🏆)[^\n]{0,25}(?:target|tp\d*|profit|هدف|ربح)/i.test(text) ||
    /(?:target|tp\d*|profit|هدف|ربح)[^\n]{0,25}✅/i.test(text) ||
    /(?:تم|تحقق|ضرب)\s*(?:الهدف|الأهداف|هدف)|مبروك\s*(?:الربح|الأهداف)|حقق(?:ت|نا)\s*ربح/.test(
      text
    )
  );
}

function deterministicRegexFallback(
  text: string,
  defaultMarketType: MarketType,
  fallbackReason?: string
): ParsedSignalData {
  if (isResultOrRecapMessage(text)) {
    return {
      isSignal: false,
      symbol: '',
      baseAsset: '',
      quoteAsset: 'USDT',
      marketType: defaultMarketType,
      side: 'BUY',
      orderType: 'MARKET',
      entryMin: null,
      entryMax: null,
      takeProfits: [],
      stopLoss: null,
      leverage: null,
      confidence: 0.95,
      reasoning: 'رسالة نتائج أو تحقيق أهداف سابقة وليست توصية دخول جديدة.',
      parserSource: 'REGEX_FALLBACK',
    };
  }

  const upper = text.toUpperCase();

  const isBuy =
    /\b(BUY|LONG|SPOT)\b/.test(upper) || /(شراء|لونج|دخول|تجميع)/.test(text);
  const isSell =
    /\b(SELL|SHORT)\b/.test(upper) || /(بيع|شورت)/.test(text);

  const pairMatch =
    upper.match(/(?:#|\$)?([A-Z0-9]{2,12})\s*[\/_-]?\s*(USDT|USDC)\b/) ||
    upper.match(/(?:#|\$)([A-Z0-9]{2,10})\b/);

  const rawCoin = pairMatch ? pairMatch[1] : '';
  const rawQuote = pairMatch && pairMatch[2] ? pairMatch[2] : 'USDT';

  const numbersMatch = (pattern: RegExp): number[] => {
    const m = text.match(pattern);
    if (!m) return [];
    const nums = m[1].match(/\d+(?:\.\d+)?/g);
    return nums ? nums.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  };

  const entryNums = numbersMatch(
    /(?:entries|entry\s*(?:zone|price|range)?|buy\s*(?:zone|price|at)|سعر الدخول|منطقة الدخول|دخول|buy(?=\s*[:\-@]?\s*\d))\s*[:\-@]?\s*[^\d\n]{0,10}(\d[0-9.,\s\-–~to]*)/i
  );

  // Match either inline "Targets: 🎯 3.86, 4.02, 4.27" or multi-line "TP1: 0.06040"
  const inlineTpNums = numbersMatch(
    /(?:targets?|take\s*profit\s*targets?|أهداف|الاهداف)\s*[:\-]?\s*[^\d\n]{0,12}([0-9.,\s\-\/]+(?:\n[\s\d.,TPtpهدف:\-🥇🥈🥉🏆]*)*)/i
  );
  const lineTpMatches = Array.from(
    text.matchAll(/(?:^|\s)(?:tp\s*\d*|هدف\s*\d*)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)/gi)
  )
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const tpNums = Array.from(new Set([...lineTpMatches, ...inlineTpNums]));

  const slNums = numbersMatch(
    /(?:sl|stop\s*loss|stop|ستوب|وقف(?:\s*الخسارة)?)\s*[:\-]?\s*[^\d\n]{0,8}([0-9]+(?:\.[0-9]+)?)/i
  );
  const levMatch = text.match(/(?:lev(?:erage)?|رافعة)\s*[:\-]?\s*(?:cross|isolated)?\s*(\d{1,3})\s*[x×]?/i);

  const hasTradingContext =
    Boolean(rawCoin) &&
    (isBuy || isSell) &&
    (entryNums.length > 0 || tpNums.length > 0 || slNums.length > 0);

  if (!hasTradingContext || !rawCoin) {
    return {
      isSignal: false,
      symbol: '',
      baseAsset: '',
      quoteAsset: 'USDT',
      marketType: defaultMarketType,
      side: 'BUY',
      orderType: 'MARKET',
      entryMin: null,
      entryMax: null,
      takeProfits: [],
      stopLoss: null,
      leverage: null,
      confidence: 0.15,
      reasoning:
        fallbackReason ??
        'الرسالة لا تحتوي على بنية توصية تداول واضحة (رمز عملة، اتجاه، وأرقام دخول/أهداف/وقف).',
      parserSource: 'REGEX_FALLBACK',
    };
  }

  const normalized = normalizeSymbol(`${rawCoin}/${rawQuote}`);
  const isFutures =
    /\b(FUTURES?|PERP|SHORT|LEVERAGE|CROSS|ISOLATED)\b/.test(upper) ||
    /(فيوتشر|عقود|شورت|رافعة)/.test(text) ||
    Boolean(levMatch);

  return {
    isSignal: true,
    symbol: normalized.symbol,
    baseAsset: normalized.baseAsset,
    quoteAsset: normalized.quoteAsset,
    marketType: isFutures ? 'FUTURES' : defaultMarketType,
    side: isSell && !isBuy ? 'SELL' : 'BUY',
    orderType: entryNums.length > 0 ? 'LIMIT' : 'MARKET',
    entryMin: entryNums.length > 0 ? Math.min(...entryNums.slice(0, 2)) : null,
    entryMax: entryNums.length > 1 ? Math.max(...entryNums.slice(0, 2)) : entryNums[0] ?? null,
    takeProfits: tpNums.slice(0, 5),
    stopLoss: slNums[0] ?? null,
    leverage: levMatch ? Number.parseInt(levMatch[1], 10) : null,
    confidence: slNums.length > 0 && tpNums.length > 0 ? 0.78 : 0.65,
    reasoning:
      fallbackReason ??
      `تم استخراج توصية ${normalized.baseAsset}/${normalized.quoteAsset} عبر المحلل النصي.`,
    parserSource: 'REGEX_FALLBACK',
  };
}

export async function parseTelegramSignal(
  rawText: string,
  defaultMarketType: MarketType = 'SPOT'
): Promise<ParsedSignalData> {
  const trimmed = rawText.trim();
  if (trimmed.length < 8 || !/\d/.test(trimmed) || isResultOrRecapMessage(trimmed)) {
    return deterministicRegexFallback(trimmed, defaultMarketType);
  }

  const ai = getGeminiClient();
  if (!ai) {
    return deterministicRegexFallback(
      trimmed,
      defaultMarketType,
      'مفتاح GEMINI_API_KEY غير مهيأ — تم استخدام المحلل النصي المباشر.'
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analyze this Telegram crypto channel post and extract structured trading signal parameters if it is an actionable trade signal:\n\n"""\n${trimmed}\n"""`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: `You are a precision crypto trading signal parser for MEXC exchange.
Determine whether the Telegram post (which may be in Arabic, English, or mixed) is an actionable trade signal (entry + targets/stop) vs general news, market commentary, promotional spam, or TP-hit recap.
Rules:
1. If it is a "Target Hit / Profit Recap / Good morning / Market update / Referral promo" WITHOUT a fresh trade setup, set isSignal = false.
2. Normalize symbol to uppercase pair without punctuation (e.g. BTCUSDT, SOLUSDT, PEPEUSDT). Default quote asset is USDT if omitted.
3. For SPOT signals, side is BUY. For FUTURES signals, side is BUY (for Long) or SELL (for Short). If leverage or SHORT/FUTURES/فيوتشر is mentioned, set marketType = FUTURES, otherwise ${defaultMarketType}.
4. If "Market" or "سعر السوق" is indicated or no entry price is given, orderType = MARKET and entryMin/entryMax = null. If entry range is given (e.g. 180 - 184), put lower in entryMin and higher in entryMax and orderType = LIMIT.
5. Extract numeric takeProfits sorted logically (ascending for BUY, descending for SELL) and numeric stopLoss if present.
6. Set confidence between 0.0 and 1.0 based on clarity and completeness of the signal.
7. Write "reasoning" as 1 concise sentence in Arabic explaining why it is or isn't a valid actionable signal.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isSignal: { type: Type.BOOLEAN },
            symbol: { type: Type.STRING },
            marketType: { type: Type.STRING, enum: ['SPOT', 'FUTURES'] },
            side: { type: Type.STRING, enum: ['BUY', 'SELL'] },
            orderType: { type: Type.STRING, enum: ['MARKET', 'LIMIT'] },
            entryMin: { type: Type.NUMBER, nullable: true },
            entryMax: { type: Type.NUMBER, nullable: true },
            takeProfits: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER },
            },
            stopLoss: { type: Type.NUMBER, nullable: true },
            leverage: { type: Type.NUMBER, nullable: true },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
          },
          required: [
            'isSignal',
            'symbol',
            'marketType',
            'side',
            'orderType',
            'takeProfits',
            'confidence',
            'reasoning',
          ],
        },
      },
    });

    const jsonText = (response.text ?? '').trim();
    if (!jsonText) {
      return deterministicRegexFallback(trimmed, defaultMarketType);
    }

    const parsed = JSON.parse(jsonText) as {
      isSignal: boolean;
      symbol?: string;
      marketType?: MarketType;
      side?: 'BUY' | 'SELL';
      orderType?: 'MARKET' | 'LIMIT';
      entryMin?: number | null;
      entryMax?: number | null;
      takeProfits?: number[];
      stopLoss?: number | null;
      leverage?: number | null;
      confidence?: number;
      reasoning?: string;
    };

    if (!parsed.isSignal || !parsed.symbol) {
      return {
        isSignal: false,
        symbol: '',
        baseAsset: '',
        quoteAsset: 'USDT',
        marketType: defaultMarketType,
        side: 'BUY',
        orderType: 'MARKET',
        entryMin: null,
        entryMax: null,
        takeProfits: [],
        stopLoss: null,
        leverage: null,
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.2)),
        reasoning:
          parsed.reasoning || 'الرسالة ليست توصية تداول جديدة قابلة للتنفيذ.',
        parserSource: 'GEMINI',
      };
    }

    const normalized = normalizeSymbol(parsed.symbol);
    const tps = Array.isArray(parsed.takeProfits)
      ? parsed.takeProfits.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
      : [];

    return {
      isSignal: true,
      symbol: normalized.symbol,
      baseAsset: normalized.baseAsset,
      quoteAsset: normalized.quoteAsset,
      marketType: parsed.marketType === 'FUTURES' ? 'FUTURES' : 'SPOT',
      side: parsed.side === 'SELL' ? 'SELL' : 'BUY',
      orderType: parsed.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
      entryMin:
        typeof parsed.entryMin === 'number' && parsed.entryMin > 0
          ? parsed.entryMin
          : null,
      entryMax:
        typeof parsed.entryMax === 'number' && parsed.entryMax > 0
          ? parsed.entryMax
          : null,
      takeProfits: tps,
      stopLoss:
        typeof parsed.stopLoss === 'number' && parsed.stopLoss > 0
          ? parsed.stopLoss
          : null,
      leverage:
        typeof parsed.leverage === 'number' && parsed.leverage > 0
          ? Math.round(parsed.leverage)
          : null,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
      reasoning:
        parsed.reasoning || `تم تحليل توصية ${normalized.symbol} بنجاح.`,
      parserSource: 'GEMINI',
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Gemini parser error';
    const isQuota = rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED');
    const shortReason = isQuota
      ? 'تم استهلاك الحصة اليومية المؤقتة لـ Gemini — تم التحليل بالمحرك النصي.'
      : `تعذر التحليل عبر Gemini — تم التحليل بالمحرك النصي.`;
    return deterministicRegexFallback(trimmed, defaultMarketType, shortReason);
  }
}
