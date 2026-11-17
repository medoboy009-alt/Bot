export type MarketType = 'SPOT' | 'FUTURES';
export type ExecutionMode = 'PAPER' | 'LIVE';
export type TradeSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export type SignalStatus =
  | 'PARSED'
  | 'EXECUTED'
  | 'SKIPPED'
  | 'FAILED'
  | 'NON_SIGNAL';

export type TradeStatus =
  | 'OPEN'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'CLOSED'
  | 'CANCELLED'
  | 'FAILED';

export interface TelegramChannel {
  id: string;
  username: string;
  title: string;
  enabled: boolean;
  marketType: MarketType;
  autoExecute: boolean;
  lastMessageId: number;
  lastCheckedAt: string | null;
  messagesFound: number;
  signalsFound: number;
  lastError: string | null;
}

export interface ParsedSignalData {
  isSignal: boolean;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: MarketType;
  side: TradeSide;
  orderType: OrderType;
  entryMin: number | null;
  entryMax: number | null;
  takeProfits: number[];
  stopLoss: number | null;
  leverage: number | null;
  confidence: number;
  reasoning: string;
  parserSource: 'GEMINI' | 'REGEX_FALLBACK';
}

export interface SignalRecord {
  id: string;
  channelId: string;
  channelUsername: string;
  telegramMessageId: number;
  rawText: string;
  postedAt: string;
  scrapedAt: string;
  parsed: ParsedSignalData;
  status: SignalStatus;
  statusReason: string;
  tradeId: string | null;
}

export interface TradeOrder {
  id: string;
  signalId: string | null;
  channelUsername: string;
  symbol: string;
  marketType: MarketType;
  side: TradeSide;
  orderType: OrderType;
  mode: ExecutionMode;
  quantity: number;
  remainingQuantity: number;
  entryPrice: number;
  currentPrice: number;
  takeProfits: number[];
  hitTakeProfits: number[];
  stopLoss: number | null;
  leverage: number;
  marginUsdt: number;
  capitalPercent?: number;
  takeProfitPercent?: number;
  realizedPnlUsdt: number;
  unrealizedPnlUsdt: number;
  pnlPercent: number;
  mexcOrderId: string | null;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  errorMessage: string | null;
}

export interface RiskConfig {
  executionMode: ExecutionMode;
  capitalPercentPerTrade: number;
  takeProfitPercent: number;
  pollIntervalSeconds: number;
  defaultMarketType: MarketType;
}

export interface MexcBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface MexcConfigPublic {
  hasApiKey: boolean;
  apiKeyMasked: string;
  lastVerifiedAt: string | null;
  spotBalances: MexcBalance[];
  accountStatus: 'UNCONFIGURED' | 'VERIFIED' | 'ERROR';
  lastError: string | null;
}

export interface EngineState {
  botRunning: boolean;
  isPolling: boolean;
  lastPollAt: string | null;
  nextPollAt: string | null;
  dailyPnlUsdt: number;
  paperBalanceUsdt: number;
  geminiConfigured: boolean;
}

export interface DashboardStateResponse {
  engine: EngineState;
  risk: RiskConfig;
  mexc: MexcConfigPublic;
  channels: TelegramChannel[];
  signals: SignalRecord[];
  trades: TradeOrder[];
}

export interface ScrapedPostPreview {
  messageId: number;
  text: string;
  postedAt: string;
}
