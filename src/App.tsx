import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Menu,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { ChannelsTab } from './components/ChannelsTab';
import { OverviewTab } from './components/OverviewTab';
import { SettingsTab } from './components/SettingsTab';
import { TradesTab } from './components/TradesTab';
import { api } from './lib/api';
import type { DashboardStateResponse } from './types';

type NavTab = 'overview' | 'channels' | 'trades' | 'settings';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: typeof BarChart3;
}> = [
  { id: 'overview', label: 'لوحة التحكم', icon: BarChart3 },
  { id: 'channels', label: 'قنوات تليجرام', icon: Radio },
  { id: 'trades', label: 'الصفقات والأوامر', icon: Activity },
  { id: 'settings', label: 'MEXC وإدارة المخاطر', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [data, setData] = useState<DashboardStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  const notify = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => {
      setToast({ message, tone });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const didCheckRestoreRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      let next = await api.getState();

      if (!didCheckRestoreRef.current) {
        didCheckRestoreRef.current = true;
        try {
          const rawBackup = localStorage.getItem('mexc_bot_backup_v1');
          const looksFreshServer =
            next.trades.length === 0 &&
            next.engine.paperBalanceUsdt === 1000 &&
            next.engine.dailyPnlUsdt === 0;

          if (rawBackup && looksFreshServer) {
            const saved = JSON.parse(rawBackup) as Partial<DashboardStateResponse>;
            const savedChannels = Array.isArray(saved.channels) ? saved.channels : [];
            const hasNewCustomChannels = savedChannels.some(
              (sc) => !next.channels.some((nc) => nc.username.toLowerCase() === sc.username.toLowerCase())
            );
            const hasSavedTradesOrBalance =
              (Array.isArray(saved.trades) && saved.trades.length > 0) ||
              (typeof saved.engine?.paperBalanceUsdt === 'number' &&
                saved.engine.paperBalanceUsdt !== 1000);
            const shouldRestore = hasSavedTradesOrBalance || hasNewCustomChannels;

            if (shouldRestore) {
              const mergedChannels =
                savedChannels.length < next.channels.length
                  ? [
                      ...savedChannels,
                      ...next.channels.filter(
                        (nc) =>
                          !savedChannels.some(
                            (sc) => sc.username.toLowerCase() === nc.username.toLowerCase()
                          )
                      ),
                    ]
                  : savedChannels;
              next = await api.restoreBackup({
                ...saved,
                channels: mergedChannels,
              });
            }
          }
        } catch {
          // Ignore malformed localStorage cache
        }
      }

      setData(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'تعذر الاتصال بالخادم.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(
        'mexc_bot_backup_v1',
        JSON.stringify({
          engine: data.engine,
          risk: data.risk,
          channels: data.channels,
          signals: data.signals,
          trades: data.trades,
        })
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [data]);

  useEffect(() => {
    void fetchState();
    const timer = setInterval(() => {
      void fetchState();
    }, 8000);
    return () => clearInterval(timer);
  }, [fetchState]);

  async function handleToggleBot() {
    if (!data) return;
    setTogglingBot(true);
    try {
      const next = await api.toggleBot(!data.engine.botRunning);
      setData(next);
      notify(
        next.engine.botRunning
          ? 'تم تشغيل الأتمتة: سيراقب النظام القنوات وينفذ التوصيات الصالحة تلقائياً.'
          : 'تم إيقاف التشغيل التلقائي.',
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'تعذر تغيير حالة الأتمتة.',
        'error'
      );
    } finally {
      setTogglingBot(false);
    }
  }

  async function handleScanNow() {
    setScanning(true);
    try {
      const res = await api.scanNow();
      setData(res.state);
      notify(
        `تم فحص ${res.result.scannedChannels} قناة · منشورات جديدة: ${res.result.newMessages}`,
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'تعذر فحص القنوات.',
        'error'
      );
    } finally {
      setScanning(false);
    }
  }

  async function handleExecuteSignal(id: string) {
    setBusyId(id);
    try {
      const res = await api.executeSignal(id);
      setData(res.state);
      notify('تم إرسال أمر التنفيذ بنجاح.', 'success');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'فشل تنفيذ التوصية.',
        'error'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismissSignal(id: string) {
    setBusyId(id);
    try {
      const next = await api.dismissSignal(id);
      setData(next);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'تعذر تحديث التوصية.',
        'error'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleCloseTrade(id: string) {
    setBusyId(id);
    try {
      const res = await api.closeTrade(id);
      setData(res.state);
      notify('تم إغلاق الصفقة بسعر السوق الحالي على MEXC.', 'success');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'فشل إغلاق الصفقة.',
        'error'
      );
    } finally {
      setBusyId(null);
    }
  }

  const activeNavLabel =
    NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? 'لوحة التحكم';

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 shrink-0 bg-[#0F1623] border-l border-slate-800">
        <div className="px-5 py-5 border-b border-slate-800">
          <span className="text-base font-bold tracking-tight text-slate-100 block whitespace-nowrap">
            MEXC Signal Automator
          </span>
          <span className="text-xs text-slate-400 mt-1 block">
            أتمتة توصيات تليجرام
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {data && (
          <div className="px-5 py-4 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>حالة التنفيذ</span>
              <span
                className={
                  data.engine.botRunning
                    ? 'text-emerald-400 font-medium'
                    : 'text-slate-400'
                }
              >
                {data.engine.botRunning ? 'أتمتة نشطة' : 'وضع يدوي'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>الوضع</span>
              <span className="text-slate-200">
                {data.risk.executionMode === 'LIVE' ? 'تداول حقيقي' : 'محاكاة'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>المحلل الذكي</span>
              <span
                className={
                  data.engine.geminiConfigured
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }
              >
                {data.engine.geminiConfigured ? 'Gemini مفعّل' : 'محلل نصي'}
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-[#0F1623] border-l border-slate-800 flex flex-col z-10">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">
                MEXC Signal Automator
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="h-16 px-4 sm:px-6 border-b border-slate-800 bg-[#0B0F17] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="lg:hidden p-2 text-slate-400 hover:text-slate-100 rounded-lg border border-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 hidden sm:inline">
                نظام الأتمتة
              </span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-100 truncate">
                {activeNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              disabled={scanning || !data}
              onClick={handleScanNow}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`}
              />
              <span>{scanning ? 'جارٍ الفحص...' : 'فحص القنوات الآن'}</span>
            </button>

            <button
              disabled={togglingBot || !data}
              onClick={handleToggleBot}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                data?.engine.botRunning
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {data?.engine.botRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>إيقاف الأتمتة</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>تشغيل الأتمتة</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Non-blocking Toast Banner */}
        {toast && (
          <div className="px-4 sm:px-6 pt-4">
            <div
              className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                toast.tone === 'error'
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                  : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              }`}
            >
              <span>{toast.message}</span>
              <button
                onClick={() => setToast(null)}
                className="text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Viewport Body */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-28 bg-[#111827] border border-slate-800 rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : loadError || !data ? (
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-sm font-medium text-rose-400">
                {loadError ?? 'تعذر تحميل بيانات النظام.'}
              </p>
              <button
                onClick={() => void fetchState()}
                className="mt-4 px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  data={data}
                  busyId={busyId}
                  onExecuteSignal={handleExecuteSignal}
                  onDismissSignal={handleDismissSignal}
                  onCloseTrade={handleCloseTrade}
                  onGoToChannels={() => setActiveTab('channels')}
                />
              )}
              {activeTab === 'channels' && (
                <ChannelsTab
                  data={data}
                  onStateChange={setData}
                  onNotify={notify}
                />
              )}
              {activeTab === 'trades' && (
                <TradesTab
                  data={data}
                  busyId={busyId}
                  onCloseTrade={handleCloseTrade}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsTab
                  data={data}
                  onStateChange={setData}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
