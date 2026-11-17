import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  addTelegramChannel,
  closeTradeManually,
  ensureDefaultChannelsSeeded,
  executeSignalById,
  getDashboardSnapshot,
  processRawSignalText,
  refreshOpenPositions,
  scanAllChannels,
  startAutomationSchedulers,
  updatePollSchedule,
} from './server/engine.ts';
import { verifyMexcSpotAccount } from './server/mexc.ts';
import { loadState, saveState } from './server/store.ts';
import { scrapePublicChannel } from './server/telegram.ts';
import { buildProjectZipBuffer } from './server/zip.ts';
import type { MarketType, RiskConfig } from './src/types.ts';

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/state', async (_req, res) => {
    await ensureDefaultChannelsSeeded();
    await refreshOpenPositions();
    res.json(getDashboardSnapshot());
  });

  app.post('/api/bot/toggle', (req, res) => {
    const running = Boolean(req.body?.running);
    const state = loadState();

    if (
      running &&
      state.risk.executionMode === 'LIVE' &&
      (!state.mexc.apiKey || !state.mexc.apiSecret)
    ) {
      res.status(400).json({
        error:
          'لا يمكن تفعيل التنفيذ التلقائي في الوضع الحقيقي قبل إدخال مفاتيح MEXC API.',
      });
      return;
    }

    state.engine.botRunning = running;
    saveState(state);
    updatePollSchedule();
    res.json(getDashboardSnapshot());
  });

  app.post('/api/bot/scan', async (_req, res) => {
    try {
      const result = await scanAllChannels();
      res.json({ result, state: getDashboardSnapshot() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'فشل فحص القنوات.',
      });
    }
  });

  app.post('/api/channels', async (req, res) => {
    try {
      const username = String(req.body?.username ?? '');
      const marketType: MarketType =
        req.body?.marketType === 'FUTURES' ? 'FUTURES' : 'SPOT';
      const autoExecute = Boolean(req.body?.autoExecute ?? true);

      const channel = await addTelegramChannel({
        username,
        marketType,
        autoExecute,
      });

      res.status(201).json({ channel, state: getDashboardSnapshot() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر إضافة القناة.',
      });
    }
  });

  app.patch('/api/channels/:id', (req, res) => {
    const state = loadState();
    const channel = state.channels.find((c) => c.id === req.params.id);
    if (!channel) {
      res.status(404).json({ error: 'القناة غير موجودة.' });
      return;
    }

    if (typeof req.body?.enabled === 'boolean') {
      channel.enabled = req.body.enabled;
    }
    if (typeof req.body?.autoExecute === 'boolean') {
      channel.autoExecute = req.body.autoExecute;
    }
    if (req.body?.marketType === 'SPOT' || req.body?.marketType === 'FUTURES') {
      channel.marketType = req.body.marketType;
    }

    saveState(state);
    res.json(getDashboardSnapshot());
  });

  app.delete('/api/channels/:id', (req, res) => {
    const state = loadState();
    state.channels = state.channels.filter((c) => c.id !== req.params.id);
    saveState(state);
    res.json(getDashboardSnapshot());
  });

  app.post('/api/channels/:id/preview', async (req, res) => {
    try {
      const state = loadState();
      const channel = state.channels.find((c) => c.id === req.params.id);
      if (!channel) {
        res.status(404).json({ error: 'القناة غير موجودة.' });
        return;
      }

      const scrape = await scrapePublicChannel(channel.username);
      res.json({
        username: scrape.username,
        title: scrape.title,
        posts: scrape.posts.slice(-10).reverse(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر جلب معاينة القناة.',
      });
    }
  });

  app.post('/api/signals/test', async (req, res) => {
    try {
      const rawText = String(req.body?.rawText ?? '').trim();
      const execute = Boolean(req.body?.execute);
      const marketType: MarketType =
        req.body?.marketType === 'FUTURES' ? 'FUTURES' : 'SPOT';

      if (!rawText) {
        res.status(400).json({ error: 'يرجى كتابة نص التوصية للاختبار.' });
        return;
      }

      const signal = await processRawSignalText({
        channelId: 'manual_test',
        channelUsername: 'اختبار_يدوي',
        telegramMessageId: Math.floor(Date.now() / 1000),
        rawText,
        postedAt: new Date().toISOString(),
        marketType,
        allowAutoExecute: execute,
      });

      res.json({ signal, state: getDashboardSnapshot() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'فشل تحليل التوصية.',
      });
    }
  });

  app.post('/api/signals/:id/execute', async (req, res) => {
    try {
      const trade = await executeSignalById(req.params.id, true);
      res.json({ trade, state: getDashboardSnapshot() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'فشل تنفيذ التوصية.',
      });
    }
  });

  app.post('/api/signals/:id/dismiss', (req, res) => {
    const state = loadState();
    const signal = state.signals.find((s) => s.id === req.params.id);
    if (!signal) {
      res.status(404).json({ error: 'التوصية غير موجودة.' });
      return;
    }
    signal.status = 'SKIPPED';
    signal.statusReason = 'تم التجاهل يدوياً من لوحة التحكم.';
    saveState(state);
    res.json(getDashboardSnapshot());
  });

  app.post('/api/trades/:id/close', async (req, res) => {
    try {
      const trade = await closeTradeManually(req.params.id);
      res.json({ trade, state: getDashboardSnapshot() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'فشل إغلاق الصفقة.',
      });
    }
  });

  app.post('/api/risk', (req, res) => {
    const state = loadState();
    const body = req.body as Partial<RiskConfig>;

    const next: RiskConfig = {
      executionMode: body.executionMode === 'LIVE' ? 'LIVE' : 'PAPER',
      capitalPercentPerTrade: Math.min(
        100,
        Math.max(1, Number(body.capitalPercentPerTrade ?? state.risk.capitalPercentPerTrade))
      ),
      takeProfitPercent: Math.min(
        500,
        Math.max(0.5, Number(body.takeProfitPercent ?? state.risk.takeProfitPercent))
      ),
      pollIntervalSeconds: Math.max(
        10,
        Math.min(300, Number(body.pollIntervalSeconds ?? state.risk.pollIntervalSeconds))
      ),
      defaultMarketType: body.defaultMarketType === 'FUTURES' ? 'FUTURES' : 'SPOT',
    };

    if (
      next.executionMode === 'LIVE' &&
      (!state.mexc.apiKey || !state.mexc.apiSecret)
    ) {
      res.status(400).json({
        error: 'أدخل مفاتيح MEXC API وتحقق منها قبل التبديل إلى الوضع الحقيقي.',
      });
      return;
    }

    state.risk = next;
    saveState(state);
    updatePollSchedule();
    res.json(getDashboardSnapshot());
  });

  app.post('/api/mexc/credentials', (req, res) => {
    const apiKey = String(req.body?.apiKey ?? '').trim();
    const apiSecret = String(req.body?.apiSecret ?? '').trim();

    if (!apiKey || !apiSecret) {
      res.status(400).json({ error: 'يرجى إدخال MEXC API Key و Secret Key.' });
      return;
    }

    const state = loadState();
    state.mexc.apiKey = apiKey;
    state.mexc.apiSecret = apiSecret;
    state.mexc.accountStatus = 'UNCONFIGURED';
    state.mexc.lastError = null;
    saveState(state);

    res.json(getDashboardSnapshot());
  });

  app.post('/api/mexc/test', async (_req, res) => {
    const state = loadState();
    try {
      const balances = await verifyMexcSpotAccount(
        state.mexc.apiKey,
        state.mexc.apiSecret
      );
      state.mexc.spotBalances = balances;
      state.mexc.accountStatus = 'VERIFIED';
      state.mexc.lastVerifiedAt = new Date().toISOString();
      state.mexc.lastError = null;
      saveState(state);
      res.json(getDashboardSnapshot());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'فشل التحقق من مفاتيح MEXC.';
      state.mexc.accountStatus = 'ERROR';
      state.mexc.lastError = message;
      saveState(state);
      res.status(400).json({ error: message, state: getDashboardSnapshot() });
    }
  });

  app.post('/api/paper/reset', (_req, res) => {
    const state = loadState();
    state.engine.paperBalanceUsdt = 1000;
    state.engine.dailyPnlUsdt = 0;
    state.trades = state.trades.filter((t) => t.mode !== 'PAPER');
    saveState(state);
    res.json(getDashboardSnapshot());
  });

  // Wake-up / external cron endpoint so deployed Cloud Run stays active 24/7
  app.get('/api/cron/tick', async (_req, res) => {
    try {
      await ensureDefaultChannelsSeeded();
      await refreshOpenPositions();
      const state = loadState();
      let scanResult = { scannedChannels: 0, newMessages: 0 };
      if (state.engine.botRunning) {
        scanResult = await scanAllChannels();
      }
      const latest = loadState();
      res.json({
        ok: true,
        botRunning: latest.engine.botRunning,
        lastPollAt: latest.engine.lastPollAt,
        paperBalanceUsdt: latest.engine.paperBalanceUsdt,
        openTradesCount: latest.trades.filter((t) => t.status === 'OPEN').length,
        scannedChannels: scanResult.scannedChannels,
        newMessages: scanResult.newMessages,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Cron tick failed',
      });
    }
  });

  app.get('/api/backup', (_req, res) => {
    const state = loadState();
    const safeBackup = {
      exportedAt: new Date().toISOString(),
      engine: state.engine,
      risk: state.risk,
      channels: state.channels,
      signals: state.signals,
      trades: state.trades,
      seenMessageKeys: state.seenMessageKeys,
    };
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mexc-bot-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.json(safeBackup);
  });

  app.get('/api/project-zip', (_req, res) => {
    try {
      const zipBuffer = buildProjectZipBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="mexc-signal-automator-source.zip"'
      );
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'تعذر ضغط ملفات المشروع.',
      });
    }
  });

  app.post('/api/backup/restore', (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body || !Array.isArray(body.channels) || !body.risk) {
        res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح.' });
        return;
      }

      const state = loadState();
      if (body.engine && typeof body.engine === 'object') {
        const eng = body.engine as Partial<typeof state.engine>;
        if (typeof eng.paperBalanceUsdt === 'number') {
          state.engine.paperBalanceUsdt = eng.paperBalanceUsdt;
        }
        if (typeof eng.dailyPnlUsdt === 'number') {
          state.engine.dailyPnlUsdt = eng.dailyPnlUsdt;
        }
        if (typeof eng.botRunning === 'boolean') {
          state.engine.botRunning = eng.botRunning;
        }
      }
      const r = body.risk as Partial<RiskConfig>;
      state.risk = {
        executionMode: r.executionMode === 'LIVE' && state.mexc.apiKey ? 'LIVE' : 'PAPER',
        capitalPercentPerTrade: Math.min(100, Math.max(1, Number(r.capitalPercentPerTrade ?? 10))),
        takeProfitPercent: Math.min(500, Math.max(0.5, Number(r.takeProfitPercent ?? 10))),
        pollIntervalSeconds: Math.max(10, Math.min(300, Number(r.pollIntervalSeconds ?? 20))),
        defaultMarketType: r.defaultMarketType === 'FUTURES' ? 'FUTURES' : 'SPOT',
      };
      state.channels = body.channels as typeof state.channels;
      if (Array.isArray(body.signals)) {
        state.signals = body.signals as typeof state.signals;
      }
      if (Array.isArray(body.trades)) {
        state.trades = body.trades as typeof state.trades;
      }
      if (Array.isArray(body.seenMessageKeys)) {
        state.seenMessageKeys = body.seenMessageKeys as string[];
      }
      saveState(state);
      updatePollSchedule();
      res.json(getDashboardSnapshot());
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'فشل استعادة النسخة الاحتياطية.',
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MEXC Signal Automator listening on http://0.0.0.0:${PORT}`);
    startAutomationSchedulers();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
