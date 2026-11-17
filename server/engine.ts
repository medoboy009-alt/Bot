import crypto from 'crypto';
import type {
  DashboardStateResponse,
  MarketType,
  SignalRecord,
  TelegramChannel,
  TradeOrder,
} from '../src/types.ts';
import {
  getMexcBatchPrices,
  getMexcSpotPrice,
  placeLiveMexcOrder,
  verifyMexcSpotAccount,
} from './mexc.ts';
import { isGeminiConfigured, parseTelegramSignal } from './parser.ts';
import { getPublicMexcConfig, loadState, saveState } from './store.ts';
import { scrapePublicChannel } from './telegram.ts';

let isPolling = false;
let nextPollAt: string | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let priceTimer: NodeJS.Timeout | null = null;

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function getDashboardSnapshot(): DashboardStateResponse {
  const state = loadState();
  return {
    engine: {
      ...state.engine,
      isPolling,
      nextPollAt,
      geminiConfigured: isGeminiConfigured(),
    },
    risk: state.risk,
    mexc: getPublicMexcConfig(state),
    channels: state.channels,
    signals: state.signals,
    trades: state.trades,
  };
}

export async function executeSignalById(
  signalId: string,
  forceManual = false
): Promise<TradeOrder | null> {
  const state = loadState();
  const signal = state.signals.find((s) => s.id === signalId);
  if (!signal) {
    throw new Error('التوصية غير موجودة.');
  }

  if (!signal.parsed.isSignal || !signal.parsed.symbol) {
    signal.status = 'NON_SIGNAL';
    signal.statusReason = 'الرسالة ليست توصية تداول صالحة.';
    saveState(state);
    return null;
  }

  if (signal.tradeId) {
    const existing = state.trades.find((t) => t.id === signal.tradeId);
    if (existing) return existing;
  }

  const risk = state.risk;
  const openTrades = state.trades.filter((t) => t.status === 'OPEN');

  const isPaper = risk.executionMode === 'PAPER';

  if (isPaper && signal.parsed.side !== 'BUY') {
    const msg =
      'تم التخطي: التداول الافتراضي يعمل بنظام Spot لشراء فقط (بدون صفقات بيع أو شورت).';
    signal.status = 'SKIPPED';
    signal.statusReason = msg;
    saveState(state);
    if (forceManual) {
      throw new Error(msg);
    }
    return null;
  }

  const effectiveMarketType: MarketType = isPaper
    ? 'SPOT'
    : signal.parsed.marketType;

  // Prevent duplicate simultaneous open position on same symbol
  if (
    openTrades.some(
      (t) =>
        t.symbol === signal.parsed.symbol &&
        t.marketType === effectiveMarketType
    )
  ) {
    signal.status = 'SKIPPED';
    signal.statusReason = `توجد صفقة مفتوحة بالفعل على ${signal.parsed.symbol}.`;
    saveState(state);
    return null;
  }

  const leverage = isPaper
    ? 1
    : effectiveMarketType === 'FUTURES'
      ? Math.max(1, signal.parsed.leverage ?? 1)
      : 1;

  const capitalPercent = Math.min(100, Math.max(1, risk.capitalPercentPerTrade));
  let totalCapitalUsdt = 0;
  let availableUsdt = 0;

  if (risk.executionMode === 'LIVE') {
    try {
      const balances = await verifyMexcSpotAccount(
        state.mexc.apiKey,
        state.mexc.apiSecret
      );
      state.mexc.spotBalances = balances;
      state.mexc.accountStatus = 'VERIFIED';
      state.mexc.lastVerifiedAt = new Date().toISOString();
      state.mexc.lastError = null;
      const usdtRow = balances.find((b) => b.asset === 'USDT');
      availableUsdt = usdtRow?.free ?? 0;
      totalCapitalUsdt = (usdtRow?.free ?? 0) + (usdtRow?.locked ?? 0);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'تعذر جلب رصيد MEXC لحساب حجم الصفقة.';
      signal.status = 'FAILED';
      signal.statusReason = message;
      saveState(state);
      if (forceManual) {
        throw new Error(message);
      }
      return null;
    }
  } else {
    const lockedPaperMargin = openTrades
      .filter((t) => t.mode === 'PAPER')
      .reduce((sum, t) => sum + t.marginUsdt, 0);
    availableUsdt = state.engine.paperBalanceUsdt;
    totalCapitalUsdt = availableUsdt + lockedPaperMargin;
  }

  const marginUsdt = Number(((totalCapitalUsdt * capitalPercent) / 100).toFixed(2));

  if (marginUsdt < 5) {
    const msg = `حجم الصفقة المحسوب ($${marginUsdt.toFixed(2)} = ${capitalPercent}% من $${totalCapitalUsdt.toFixed(2)}) أقل من الحد الأدنى لمنصة MEXC ($5).`;
    signal.status = 'FAILED';
    signal.statusReason = msg;
    saveState(state);
    if (forceManual) {
      throw new Error(msg);
    }
    return null;
  }

  if (availableUsdt < marginUsdt) {
    const msg = `الرصيد المتاح غير كافٍ ($${availableUsdt.toFixed(2)} USDT) لتنفيذ ${capitalPercent}% من رأس المال ($${marginUsdt.toFixed(2)}).`;
    signal.status = 'FAILED';
    signal.statusReason = msg;
    saveState(state);
    if (forceManual) {
      throw new Error(msg);
    }
    return null;
  }

  try {
    const livePrice = await getMexcSpotPrice(signal.parsed.symbol);
    let entryPrice = livePrice;
    let quantity = (marginUsdt * leverage) / livePrice;
    let mexcOrderId: string | null = null;

    if (risk.executionMode === 'LIVE') {
      const limitTarget =
        signal.parsed.orderType === 'LIMIT'
          ? signal.parsed.entryMax ?? signal.parsed.entryMin
          : null;

      const liveOrder = await placeLiveMexcOrder({
        apiKey: state.mexc.apiKey,
        apiSecret: state.mexc.apiSecret,
        symbol: signal.parsed.symbol,
        marketType: signal.parsed.marketType,
        side: signal.parsed.side,
        orderType: signal.parsed.orderType,
        amountUsdt: marginUsdt,
        limitPrice: limitTarget,
        leverage,
      });

      entryPrice = liveOrder.executedPrice;
      quantity = liveOrder.executedQty;
      mexcOrderId = liveOrder.mexcOrderId;
    } else {
      // Paper trade executes on real live MEXC price
      state.engine.paperBalanceUsdt = Number(
        (state.engine.paperBalanceUsdt - marginUsdt).toFixed(4)
      );
      mexcOrderId = `PAPER-${Date.now().toString().slice(-6)}`;
    }

    const tpPercent = Math.max(0.5, risk.takeProfitPercent);
    const targetPrice = Number(
      (signal.parsed.side === 'BUY'
        ? entryPrice * (1 + tpPercent / 100)
        : entryPrice * (1 - tpPercent / 100)
      ).toPrecision(7)
    );

    const trade: TradeOrder = {
      id: createId('trd'),
      signalId: signal.id,
      channelUsername: signal.channelUsername,
      symbol: signal.parsed.symbol,
      marketType: effectiveMarketType,
      side: signal.parsed.side,
      orderType: signal.parsed.orderType,
      mode: risk.executionMode,
      quantity: Number(quantity.toFixed(6)),
      remainingQuantity: Number(quantity.toFixed(6)),
      entryPrice,
      currentPrice: livePrice,
      takeProfits: [targetPrice],
      hitTakeProfits: [],
      stopLoss: signal.parsed.stopLoss,
      leverage,
      marginUsdt,
      capitalPercent,
      takeProfitPercent: tpPercent,
      realizedPnlUsdt: 0,
      unrealizedPnlUsdt: 0,
      pnlPercent: 0,
      mexcOrderId,
      status: 'OPEN',
      openedAt: new Date().toISOString(),
      closedAt: null,
      errorMessage: null,
    };

    state.trades.unshift(trade);
    signal.status = 'EXECUTED';
    signal.statusReason =
      risk.executionMode === 'LIVE'
        ? `تم التنفيذ على MEXC بنسبة ${capitalPercent}% ($${marginUsdt}) — أمر ${mexcOrderId}`
        : `تم فتح صفقة شراء Spot افتراضية بدون رافعة بنسبة ${capitalPercent}% ($${marginUsdt}) على سعر $${entryPrice}`;
    signal.tradeId = trade.id;

    saveState(state);
    return trade;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل تنفيذ الأمر على MEXC';
    signal.status = 'FAILED';
    signal.statusReason = message;
    saveState(state);
    if (forceManual) {
      throw new Error(message);
    }
    return null;
  }
}

export async function processRawSignalText(params: {
  channelId: string;
  channelUsername: string;
  telegramMessageId: number;
  rawText: string;
  postedAt: string;
  marketType: MarketType;
  allowAutoExecute: boolean;
}): Promise<SignalRecord> {
  const state = loadState();
  const parsed = await parseTelegramSignal(params.rawText, params.marketType);

  const record: SignalRecord = {
    id: createId('sig'),
    channelId: params.channelId,
    channelUsername: params.channelUsername,
    telegramMessageId: params.telegramMessageId,
    rawText: params.rawText,
    postedAt: params.postedAt,
    scrapedAt: new Date().toISOString(),
    parsed,
    status: parsed.isSignal ? 'PARSED' : 'NON_SIGNAL',
    statusReason: parsed.isSignal
      ? 'تم تحليل التوصية وجاهزة للتنفيذ'
      : parsed.reasoning,
    tradeId: null,
  };

  state.signals.unshift(record);
  const channel = state.channels.find((c) => c.id === params.channelId);
  if (channel && parsed.isSignal) {
    channel.signalsFound += 1;
  }
  saveState(state);

  if (parsed.isSignal && params.allowAutoExecute) {
    await executeSignalById(record.id, false);
  }

  return record;
}

export async function addTelegramChannel(input: {
  username: string;
  marketType: MarketType;
  autoExecute: boolean;
}): Promise<TelegramChannel> {
  const state = loadState();
  const scrape = await scrapePublicChannel(input.username);

  const existing = state.channels.find(
    (c) => c.username.toLowerCase() === scrape.username.toLowerCase()
  );
  if (existing) {
    throw new Error(`القناة @${scrape.username} مضافة بالفعل.`);
  }

  const channel: TelegramChannel = {
    id: createId('chn'),
    username: scrape.username,
    title: scrape.title,
    enabled: true,
    marketType: input.marketType,
    autoExecute: input.autoExecute,
    lastMessageId: scrape.latestMessageId,
    lastCheckedAt: new Date().toISOString(),
    messagesFound: scrape.posts.length,
    signalsFound: 0,
    lastError: null,
  };

  state.channels.unshift(channel);

  // Mark older posts as seen so old signals are not blindly auto-executed
  for (const post of scrape.posts) {
    state.seenMessageKeys.push(`${scrape.username}:${post.messageId}`);
  }
  saveState(state);

  // Parse up to the newest 2 posts for immediate visibility (without auto-executing historical signals)
  const latestPosts = scrape.posts.slice(-2);
  for (const post of latestPosts) {
    await processRawSignalText({
      channelId: channel.id,
      channelUsername: channel.username,
      telegramMessageId: post.messageId,
      rawText: post.text,
      postedAt: post.postedAt,
      marketType: channel.marketType,
      allowAutoExecute: false,
    });
  }

  return channel;
}

export async function scanAllChannels(): Promise<{
  scannedChannels: number;
  newMessages: number;
}> {
  if (isPolling) {
    return { scannedChannels: 0, newMessages: 0 };
  }

  isPolling = true;
  let scannedChannels = 0;
  let newMessages = 0;

  try {
    const state = loadState();
    const enabledChannels = state.channels.filter((c) => c.enabled);

    for (const channel of enabledChannels) {
      scannedChannels += 1;
      try {
        const scrape = await scrapePublicChannel(channel.username);
        channel.title = scrape.title;
        channel.lastCheckedAt = new Date().toISOString();
        channel.lastError = null;
        channel.messagesFound = scrape.posts.length;

        const unseen = scrape.posts.filter((p) => {
          const key = `${channel.username}:${p.messageId}`;
          return (
            p.messageId > channel.lastMessageId &&
            !state.seenMessageKeys.includes(key)
          );
        });

        for (const post of unseen) {
          newMessages += 1;
          state.seenMessageKeys.push(`${channel.username}:${post.messageId}`);
          if (post.messageId > channel.lastMessageId) {
            channel.lastMessageId = post.messageId;
          }
          saveState(state);

          await processRawSignalText({
            channelId: channel.id,
            channelUsername: channel.username,
            telegramMessageId: post.messageId,
            rawText: post.text,
            postedAt: post.postedAt,
            marketType: channel.marketType,
            allowAutoExecute: state.engine.botRunning && channel.autoExecute,
          });
        }

        if (scrape.latestMessageId > channel.lastMessageId) {
          channel.lastMessageId = scrape.latestMessageId;
        }
        saveState(state);
      } catch (err) {
        channel.lastCheckedAt = new Date().toISOString();
        channel.lastError =
          err instanceof Error ? err.message : 'خطأ أثناء فحص القناة';
        saveState(state);
      }
    }

    state.engine.lastPollAt = new Date().toISOString();
    saveState(state);
    return { scannedChannels, newMessages };
  } finally {
    isPolling = false;
  }
}

export async function refreshOpenPositions(): Promise<void> {
  const state = loadState();
  const openTrades = state.trades.filter((t) => t.status === 'OPEN');
  if (openTrades.length === 0) return;

  try {
    const symbols = Array.from(new Set(openTrades.map((t) => t.symbol)));
    const prices = await getMexcBatchPrices(symbols);

    let changed = false;
    for (const trade of openTrades) {
      const livePrice = prices[trade.symbol];
      if (!livePrice) continue;

      trade.currentPrice = livePrice;
      const dir = trade.side === 'BUY' ? 1 : -1;
      const pctMove = ((livePrice - trade.entryPrice) / trade.entryPrice) * dir;
      const leveragedPct = pctMove * trade.leverage;
      const remainingRatio =
        trade.quantity > 0 ? trade.remainingQuantity / trade.quantity : 1;

      trade.unrealizedPnlUsdt = Number(
        (trade.marginUsdt * remainingRatio * leveragedPct).toFixed(4)
      );
      trade.pnlPercent = Number((leveragedPct * 100).toFixed(2));
      changed = true;

      // Monitor Signal Stop Loss & Fixed-Percentage Full-Exit Target
      const hitStop =
        trade.stopLoss !== null &&
        ((trade.side === 'BUY' && livePrice <= trade.stopLoss) ||
          (trade.side === 'SELL' && livePrice >= trade.stopLoss));

      const targetPrice = trade.takeProfits[0] ?? null;
      const hitTarget =
        targetPrice !== null &&
        ((trade.side === 'BUY' && livePrice >= targetPrice) ||
          (trade.side === 'SELL' && livePrice <= targetPrice));

      if (hitStop || hitTarget) {
        if (trade.mode === 'LIVE') {
          if (trade.marketType === 'SPOT' && trade.side === 'BUY') {
            try {
              await placeLiveMexcOrder({
                apiKey: state.mexc.apiKey,
                apiSecret: state.mexc.apiSecret,
                symbol: trade.symbol,
                marketType: 'SPOT',
                side: 'SELL',
                orderType: 'MARKET',
                amountUsdt: trade.remainingQuantity * livePrice,
                quantity: trade.remainingQuantity,
              });
            } catch (err) {
              trade.errorMessage =
                err instanceof Error ? err.message : 'فشل البيع التلقائي على MEXC';
              continue;
            }
          } else {
            continue;
          }
        }

        const closePnl = trade.unrealizedPnlUsdt;
        trade.realizedPnlUsdt = Number(
          (trade.realizedPnlUsdt + closePnl).toFixed(4)
        );
        trade.unrealizedPnlUsdt = 0;
        trade.remainingQuantity = 0;
        trade.status = hitStop ? 'SL_HIT' : 'TP_HIT';
        if (hitTarget && targetPrice !== null) {
          trade.hitTakeProfits = [targetPrice];
        }
        trade.closedAt = new Date().toISOString();

        if (trade.mode === 'PAPER') {
          const returnedMargin = Math.max(
            0,
            trade.marginUsdt * remainingRatio + closePnl
          );
          state.engine.paperBalanceUsdt = Number(
            (state.engine.paperBalanceUsdt + returnedMargin).toFixed(4)
          );
          state.engine.dailyPnlUsdt = Number(
            (state.engine.dailyPnlUsdt + closePnl).toFixed(4)
          );
        }
      }
    }

    if (changed) {
      saveState(state);
    }
  } catch {
    // Silent network retry on next tick
  }
}

export async function closeTradeManually(tradeId: string): Promise<TradeOrder> {
  const state = loadState();
  const trade = state.trades.find((t) => t.id === tradeId);
  if (!trade) {
    throw new Error('الصفقة غير موجودة.');
  }
  if (trade.status !== 'OPEN') {
    throw new Error('الصفقة مغلقة بالفعل.');
  }

  const livePrice = await getMexcSpotPrice(trade.symbol);
  trade.currentPrice = livePrice;

  if (trade.mode === 'LIVE' && trade.marketType === 'SPOT' && trade.side === 'BUY') {
    await placeLiveMexcOrder({
      apiKey: state.mexc.apiKey,
      apiSecret: state.mexc.apiSecret,
      symbol: trade.symbol,
      marketType: 'SPOT',
      side: 'SELL',
      orderType: 'MARKET',
      amountUsdt: trade.remainingQuantity * livePrice,
      quantity: trade.remainingQuantity,
    });
  }

  const dir = trade.side === 'BUY' ? 1 : -1;
  const pctMove = ((livePrice - trade.entryPrice) / trade.entryPrice) * dir;
  const leveragedPct = pctMove * trade.leverage;
  const remainingRatio =
    trade.quantity > 0 ? trade.remainingQuantity / trade.quantity : 1;

  const closingPnl = Number(
    (trade.marginUsdt * remainingRatio * leveragedPct).toFixed(4)
  );
  trade.realizedPnlUsdt = Number(
    (trade.realizedPnlUsdt + closingPnl).toFixed(4)
  );
  trade.unrealizedPnlUsdt = 0;
  trade.pnlPercent = Number((leveragedPct * 100).toFixed(2));
  trade.remainingQuantity = 0;
  trade.status = 'CLOSED';
  trade.closedAt = new Date().toISOString();

  if (trade.mode === 'PAPER') {
    const returned = Math.max(0, trade.marginUsdt * remainingRatio + closingPnl);
    state.engine.paperBalanceUsdt = Number(
      (state.engine.paperBalanceUsdt + returned).toFixed(4)
    );
    state.engine.dailyPnlUsdt = Number(
      (state.engine.dailyPnlUsdt + closingPnl).toFixed(4)
    );
  }

  saveState(state);
  return trade;
}

let seedingPromise: Promise<void> | null = null;

export async function ensureDefaultChannelsSeeded(): Promise<void> {
  if (seedingPromise) {
    return seedingPromise;
  }

  seedingPromise = (async () => {
    const state = loadState();
    if (state.seededDefaults || state.channels.length > 0) {
      if (!state.seededDefaults) {
        state.seededDefaults = true;
        saveState(state);
      }
      return;
    }

    state.seededDefaults = true;
    saveState(state);

    const defaults = ['CryptoRoyalsOffical', 'MaheeCrypto', 'Official_GCR'];
    await Promise.allSettled(
      defaults.map((username) =>
        addTelegramChannel({
          username,
          marketType: 'SPOT',
          autoExecute: true,
        })
      )
    );
  })();

  return seedingPromise;
}

export function startAutomationSchedulers(): void {
  void ensureDefaultChannelsSeeded();

  const scheduleNextPoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    const state = loadState();
    const intervalMs = Math.max(10, state.risk.pollIntervalSeconds) * 1000;
    nextPollAt = state.engine.botRunning
      ? new Date(Date.now() + intervalMs).toISOString()
      : null;

    pollTimer = setTimeout(async () => {
      const current = loadState();
      if (current.engine.botRunning) {
        await scanAllChannels();
      }
      scheduleNextPoll();
    }, intervalMs);
  };

  scheduleNextPoll();

  if (priceTimer) clearInterval(priceTimer);
  priceTimer = setInterval(() => {
    void refreshOpenPositions();
  }, 10000);
}

export function updatePollSchedule(): void {
  startAutomationSchedulers();
}
