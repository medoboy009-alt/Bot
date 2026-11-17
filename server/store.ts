import fs from 'fs';
import path from 'path';
import type {
  EngineState,
  MexcBalance,
  MexcConfigPublic,
  RiskConfig,
  SignalRecord,
  TelegramChannel,
  TradeOrder,
} from '../src/types.ts';

export interface StoredMexcCredentials {
  apiKey: string;
  apiSecret: string;
  lastVerifiedAt: string | null;
  spotBalances: MexcBalance[];
  accountStatus: 'UNCONFIGURED' | 'VERIFIED' | 'ERROR';
  lastError: string | null;
}

export interface PersistedState {
  engine: Omit<EngineState, 'isPolling' | 'nextPollAt' | 'geminiConfigured'>;
  risk: RiskConfig;
  mexc: StoredMexcCredentials;
  channels: TelegramChannel[];
  signals: SignalRecord[];
  trades: TradeOrder[];
  seenMessageKeys: string[];
  seededDefaults?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'automator-state.json');

const DEFAULT_STATE: PersistedState = {
  engine: {
    botRunning: true,
    lastPollAt: null,
    dailyPnlUsdt: 0,
    paperBalanceUsdt: 1000,
  },
  risk: {
    executionMode: 'PAPER',
    capitalPercentPerTrade: 10,
    takeProfitPercent: 10,
    pollIntervalSeconds: 20,
    defaultMarketType: 'SPOT',
  },
  mexc: {
    apiKey: '',
    apiSecret: '',
    lastVerifiedAt: null,
    spotBalances: [],
    accountStatus: 'UNCONFIGURED',
    lastError: null,
  },
  channels: [],
  signals: [],
  trades: [],
  seenMessageKeys: [],
};

let stateCache: PersistedState | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(): PersistedState {
  if (stateCache) {
    return stateCache;
  }

  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    stateCache = structuredClone(DEFAULT_STATE);
    saveState(stateCache);
    return stateCache;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    stateCache = {
      engine: { ...DEFAULT_STATE.engine, ...(parsed.engine ?? {}) },
      risk: {
        executionMode: parsed.risk?.executionMode === 'LIVE' ? 'LIVE' : 'PAPER',
        capitalPercentPerTrade:
          typeof parsed.risk?.capitalPercentPerTrade === 'number'
            ? parsed.risk.capitalPercentPerTrade
            : DEFAULT_STATE.risk.capitalPercentPerTrade,
        takeProfitPercent:
          typeof parsed.risk?.takeProfitPercent === 'number'
            ? parsed.risk.takeProfitPercent
            : DEFAULT_STATE.risk.takeProfitPercent,
        pollIntervalSeconds:
          typeof parsed.risk?.pollIntervalSeconds === 'number'
            ? parsed.risk.pollIntervalSeconds
            : DEFAULT_STATE.risk.pollIntervalSeconds,
        defaultMarketType:
          parsed.risk?.defaultMarketType === 'FUTURES' ? 'FUTURES' : 'SPOT',
      },
      mexc: { ...DEFAULT_STATE.mexc, ...(parsed.mexc ?? {}) },
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      seenMessageKeys: Array.isArray(parsed.seenMessageKeys)
        ? parsed.seenMessageKeys
        : [],
      seededDefaults: Boolean(parsed.seededDefaults),
    };
  } catch {
    stateCache = structuredClone(DEFAULT_STATE);
  }

  return stateCache;
}

export function saveState(nextState?: PersistedState): void {
  const target = nextState ?? loadState();
  stateCache = target;

  // Cap stored signals and seen keys to keep disk state nimble
  if (target.signals.length > 150) {
    target.signals = target.signals.slice(0, 150);
  }
  if (target.trades.length > 200) {
    target.trades = target.trades.slice(0, 200);
  }
  if (target.seenMessageKeys.length > 1500) {
    target.seenMessageKeys = target.seenMessageKeys.slice(-1500);
  }

  ensureDataDir();
  const tmpPath = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STATE_FILE);
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function getPublicMexcConfig(state: PersistedState): MexcConfigPublic {
  return {
    hasApiKey: Boolean(state.mexc.apiKey && state.mexc.apiSecret),
    apiKeyMasked: maskApiKey(state.mexc.apiKey),
    lastVerifiedAt: state.mexc.lastVerifiedAt,
    spotBalances: state.mexc.spotBalances,
    accountStatus: state.mexc.accountStatus,
    lastError: state.mexc.lastError,
  };
}
