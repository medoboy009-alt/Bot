import type {
  DashboardStateResponse,
  MarketType,
  RiskConfig,
  ScrapedPostPreview,
  SignalRecord,
  TradeOrder,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text);
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string };
    throw new Error(errObj?.error || `خطأ في الخادم (${res.status})`);
  }

  return data as T;
}

export const api = {
  getState: () => request<DashboardStateResponse>('/api/state'),

  toggleBot: (running: boolean) =>
    request<DashboardStateResponse>('/api/bot/toggle', {
      method: 'POST',
      body: JSON.stringify({ running }),
    }),

  scanNow: () =>
    request<{
      result: { scannedChannels: number; newMessages: number };
      state: DashboardStateResponse;
    }>('/api/bot/scan', { method: 'POST' }),

  addChannel: (payload: {
    username: string;
    marketType: MarketType;
    autoExecute: boolean;
  }) =>
    request<{ channel: unknown; state: DashboardStateResponse }>(
      '/api/channels',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateChannel: (
    id: string,
    payload: Partial<{
      enabled: boolean;
      autoExecute: boolean;
      marketType: MarketType;
    }>
  ) =>
    request<DashboardStateResponse>(`/api/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteChannel: (id: string) =>
    request<DashboardStateResponse>(`/api/channels/${id}`, {
      method: 'DELETE',
    }),

  previewChannel: (id: string) =>
    request<{ username: string; title: string; posts: ScrapedPostPreview[] }>(
      `/api/channels/${id}/preview`,
      { method: 'POST' }
    ),

  testSignal: (payload: {
    rawText: string;
    marketType: MarketType;
    execute: boolean;
  }) =>
    request<{ signal: SignalRecord; state: DashboardStateResponse }>(
      '/api/signals/test',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  executeSignal: (id: string) =>
    request<{ trade: TradeOrder | null; state: DashboardStateResponse }>(
      `/api/signals/${id}/execute`,
      { method: 'POST' }
    ),

  dismissSignal: (id: string) =>
    request<DashboardStateResponse>(`/api/signals/${id}/dismiss`, {
      method: 'POST',
    }),

  closeTrade: (id: string) =>
    request<{ trade: TradeOrder; state: DashboardStateResponse }>(
      `/api/trades/${id}/close`,
      { method: 'POST' }
    ),

  updateRisk: (payload: Partial<RiskConfig>) =>
    request<DashboardStateResponse>('/api/risk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveMexcCredentials: (apiKey: string, apiSecret: string) =>
    request<DashboardStateResponse>('/api/mexc/credentials', {
      method: 'POST',
      body: JSON.stringify({ apiKey, apiSecret }),
    }),

  testMexcConnection: () =>
    request<DashboardStateResponse>('/api/mexc/test', {
      method: 'POST',
    }),

  resetPaperWallet: () =>
    request<DashboardStateResponse>('/api/paper/reset', {
      method: 'POST',
    }),

  triggerCronTick: () =>
    request<{
      ok: boolean;
      botRunning: boolean;
      lastPollAt: string | null;
      scannedChannels: number;
      newMessages: number;
    }>('/api/cron/tick'),

  restoreBackup: (backupPayload: unknown) =>
    request<DashboardStateResponse>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(backupPayload),
    }),
};
