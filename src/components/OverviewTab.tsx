import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Play,
  Plus,
  X,
} from 'lucide-react';
import type { DashboardStateResponse, SignalRecord } from '../types';

interface OverviewTabProps {
  data: DashboardStateResponse;
  busyId: string | null;
  onExecuteSignal: (id: string) => void;
  onDismissSignal: (id: string) => void;
  onCloseTrade: (id: string) => void;
  onGoToChannels: () => void;
}

type SignalFilter = 'ALL' | 'ACTIONABLE' | 'EXECUTED' | 'SKIPPED';

function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (val >= 1) return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return val.toLocaleString('en-US', { maximumFractionDigits: 7 });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function signalStatusLabel(status: SignalRecord['status']): {
  text: string;
  tone: string;
} {
  switch (status) {
    case 'EXECUTED':
      return { text: 'تم التنفيذ', tone: 'text-emerald-400' };
    case 'PARSED':
      return { text: 'جاهز للتنفيذ', tone: 'text-amber-400' };
    case 'SKIPPED':
      return { text: 'تم التخطي', tone: 'text-slate-400' };
    case 'FAILED':
      return { text: 'فشل التنفيذ', tone: 'text-rose-400' };
    case 'NON_SIGNAL':
      return { text: 'منشور عادي', tone: 'text-slate-500' };
  }
}

export function OverviewTab({
  data,
  busyId,
  onExecuteSignal,
  onDismissSignal,
  onCloseTrade,
  onGoToChannels,
}: OverviewTabProps) {
  const [filter, setFilter] = useState<SignalFilter>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const openTrades = useMemo(
    () => data.trades.filter((t) => t.status === 'OPEN'),
    [data.trades]
  );

  const totalUnrealized = useMemo(
    () => openTrades.reduce((sum, t) => sum + t.unrealizedPnlUsdt, 0),
    [openTrades]
  );

  const usdtSpotBalance = useMemo(() => {
    const usdt = data.mexc.spotBalances.find((b) => b.asset === 'USDT');
    return usdt ? usdt.free : 0;
  }, [data.mexc.spotBalances]);

  const validSignalsCount = useMemo(
    () => data.signals.filter((s) => s.parsed.isSignal).length,
    [data.signals]
  );

  const closedTrades = useMemo(
    () => data.trades.filter((t) => t.status !== 'OPEN' && t.status !== 'FAILED'),
    [data.trades]
  );

  const winRate = useMemo(() => {
    if (closedTrades.length === 0) return null;
    const wins = closedTrades.filter((t) => t.realizedPnlUsdt > 0).length;
    return Math.round((wins / closedTrades.length) * 100);
  }, [closedTrades]);

  const filteredSignals = useMemo(() => {
    return data.signals.filter((s) => {
      if (filter === 'ACTIONABLE') return s.parsed.isSignal && s.status === 'PARSED';
      if (filter === 'EXECUTED') return s.status === 'EXECUTED';
      if (filter === 'SKIPPED')
        return s.status === 'SKIPPED' || s.status === 'FAILED';
      return true;
    });
  }, [data.signals, filter]);

  const activeBalance =
    data.risk.executionMode === 'LIVE'
      ? usdtSpotBalance
      : data.engine.paperBalanceUsdt;

  const totalCapital = useMemo(() => {
    if (data.risk.executionMode === 'LIVE') {
      const usdt = data.mexc.spotBalances.find((b) => b.asset === 'USDT');
      return (usdt?.free ?? 0) + (usdt?.locked ?? 0);
    }
    const lockedPaper = openTrades
      .filter((t) => t.mode === 'PAPER')
      .reduce((sum, t) => sum + t.marginUsdt, 0);
    return data.engine.paperBalanceUsdt + lockedPaper;
  }, [data.risk.executionMode, data.mexc.spotBalances, data.engine.paperBalanceUsdt, openTrades]);

  const estimatedOrderUsdt =
    (totalCapital * data.risk.capitalPercentPerTrade) / 100;

  return (
    <div className="space-y-6">
      {/* 4-column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              {data.risk.executionMode === 'LIVE'
                ? 'رصيد MEXC Spot المتاح'
                : 'رصيد المحاكاة (Paper)'}
            </span>
            <span className="text-slate-500">
              {data.risk.executionMode === 'LIVE' ? 'تداول حقيقي' : 'أسعار حية'}
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2" dir="ltr">
            <span className="text-2xl font-semibold text-slate-100 font-mono-tabular">
              ${activeBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-slate-400 font-mono-tabular">USDT</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            دخول الصفقة: <span className="font-mono-tabular text-slate-300" dir="ltr">{data.risk.capitalPercentPerTrade}% (~${estimatedOrderUsdt.toFixed(2)})</span>
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>الصفقات المفتوحة</span>
            <span className="text-slate-500">
              هدف البيع +{data.risk.takeProfitPercent}%
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-slate-100 font-mono-tabular">
              {openTrades.length}
            </span>
            <span
              dir="ltr"
              className={`text-sm font-medium font-mono-tabular ${
                totalUnrealized > 0
                  ? 'text-emerald-400'
                  : totalUnrealized < 0
                    ? 'text-rose-400'
                    : 'text-slate-400'
              }`}
            >
              {totalUnrealized >= 0 ? '+' : ''}
              {totalUnrealized.toFixed(2)} USDT
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            تحديث تلقائي كل 10 ثوانٍ من MEXC
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>التوصيات المرصودة</span>
            <span className="text-slate-500">
              {data.channels.length} قناة مراقبة
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-100 font-mono-tabular">
              {validSignalsCount}
            </span>
            <span className="text-xs text-slate-400">
              من أصل {data.signals.length} منشور
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            آخر فحص: <span className="font-mono-tabular">{formatTime(data.engine.lastPollAt)}</span>
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>صافي ربح اليوم</span>
            <span className="text-slate-500">
              الوقف من التوصية
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2" dir="ltr">
            <span
              className={`text-2xl font-semibold font-mono-tabular ${
                data.engine.dailyPnlUsdt > 0
                  ? 'text-emerald-400'
                  : data.engine.dailyPnlUsdt < 0
                    ? 'text-rose-400'
                    : 'text-slate-100'
              }`}
            >
              {data.engine.dailyPnlUsdt >= 0 ? '+' : ''}
              {data.engine.dailyPnlUsdt.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-mono-tabular">USDT</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            نسبة النجاح: {winRate !== null ? `${winRate}% (${closedTrades.length} صفقة)` : 'لا توجد صفقات مغلقة'}
          </p>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Signal Stream (7 cols) */}
        <section className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                سجل توصيات تليجرام والتحليل الآلي
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                رصد الرسائل العامة واستخراج الزوج ونقاط الدخول والأهداف ووقف الخسارة
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'الكل' },
                  { id: 'ACTIONABLE', label: 'جاهزة' },
                  { id: 'EXECUTED', label: 'منفذة' },
                  { id: 'SKIPPED', label: 'مستبعدة' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filter === tab.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredSignals.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-slate-200">
                لا توجد توصيات مسجلة بعد
              </p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                أضف قناة تليجرام عامة أو استخدم مختبر اختبار التوصيات لقراءة المنشورات وتحليلها تلقائياً.
              </p>
              <button
                onClick={onGoToChannels}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة قناة أو اختبار توصية</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[680px] overflow-y-auto">
              {filteredSignals.map((sig) => {
                const statusInfo = signalStatusLabel(sig.status);
                const isExpanded = expandedId === sig.id;
                const p = sig.parsed;

                return (
                  <div
                    key={sig.id}
                    className="px-5 py-4 hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Metadata line — clean unboxed text with separators */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="font-medium text-slate-200" dir="ltr">
                          @{sig.channelUsername}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {formatTime(sig.postedAt)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={statusInfo.tone}>{statusInfo.text}</span>
                      </div>

                      {p.isSignal && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>الثقة</span>
                          <span className="font-mono-tabular text-slate-200">
                            {Math.round(p.confidence * 100)}%
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{p.marketType}</span>
                        </div>
                      )}
                    </div>

                    {/* Signal Summary */}
                    {p.isSignal ? (
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span
                            dir="ltr"
                            className="text-base font-semibold text-slate-100 font-mono-tabular"
                          >
                            {p.symbol}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium ${
                              p.side === 'BUY'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {p.side === 'BUY' ? (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            )}
                            {p.side === 'BUY' ? 'شراء (LONG)' : 'بيع (SHORT)'}
                          </span>
                          {p.leverage && p.leverage > 1 && (
                            <span
                              dir="ltr"
                              className="text-xs font-mono-tabular text-amber-400"
                            >
                              {p.leverage}x
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {(sig.status === 'PARSED' ||
                            sig.status === 'SKIPPED' ||
                            sig.status === 'FAILED') && (
                            <button
                              disabled={busyId === sig.id}
                              onClick={() => onExecuteSignal(sig.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>تنفيذ على MEXC</span>
                            </button>
                          )}
                          {sig.status === 'PARSED' && (
                            <button
                              disabled={busyId === sig.id}
                              onClick={() => onDismissSignal(sig.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>تجاهل</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400 line-clamp-2">
                        {sig.rawText}
                      </p>
                    )}

                    {/* Parsed Levels Grid */}
                    {p.isSignal && (
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2.5 border-t border-slate-800/60">
                        <div>
                          <span className="text-slate-500 block">الدخول</span>
                          <span
                            dir="ltr"
                            className="text-slate-200 font-mono-tabular mt-0.5 block"
                          >
                            {p.entryMin
                              ? p.entryMax && p.entryMax !== p.entryMin
                                ? `${formatPrice(p.entryMin)} - ${formatPrice(p.entryMax)}`
                                : formatPrice(p.entryMin)
                              : 'سعر السوق'}
                          </span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-slate-500 block">هدف البيع الكامل</span>
                          <span
                            dir="ltr"
                            className="text-emerald-400 font-mono-tabular mt-0.5 block truncate"
                          >
                            +{data.risk.takeProfitPercent}% من الدخول (بيع 100%)
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">وقف التوصية (SL)</span>
                          <span
                            dir="ltr"
                            className="text-rose-400 font-mono-tabular mt-0.5 block"
                          >
                            {formatPrice(p.stopLoss)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Status Reason & Toggle Raw Text */}
                    <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400 truncate">
                        {sig.statusReason}
                      </span>
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : sig.id)
                        }
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <span>نص التليجرام</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {isExpanded && (
                      <pre className="mt-2.5 p-3 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                        {sig.rawText}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Active Positions Monitor (5 cols) */}
        <section className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                الصفقات المفتوحة حالياً
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                مراقبة حية للأهداف ووقف الخسارة مقابل أسعار MEXC
              </p>
            </div>
            <span className="text-xs font-mono-tabular text-slate-400">
              {openTrades.length} مفتوحة
            </span>
          </div>

          {openTrades.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-300">
                لا توجد صفقات مفتوحة الآن
              </p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                عند تفعيل الأتمتة أو تنفيذ أي توصية من السجل، ستظهر الصفقة هنا مع تتبع لحظي للسعر والربح.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {openTrades.map((trade) => {
                const pnlPositive = trade.unrealizedPnlUsdt >= 0;
                return (
                  <div key={trade.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          dir="ltr"
                          className="text-sm font-semibold text-slate-100 font-mono-tabular"
                        >
                          {trade.symbol}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            trade.side === 'BUY'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {trade.side === 'BUY' ? 'شراء' : 'بيع'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {trade.mode === 'LIVE' ? 'حقيقي' : 'محاكاة'}
                          {trade.leverage > 1 ? ` · ${trade.leverage}x` : ''}
                        </span>
                      </div>

                      <div
                        dir="ltr"
                        className={`text-sm font-semibold font-mono-tabular ${
                          pnlPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pnlPositive ? '+' : ''}
                        {trade.unrealizedPnlUsdt.toFixed(2)} USDT ({pnlPositive ? '+' : ''}
                        {trade.pnlPercent.toFixed(2)}%)
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 block">سعر الدخول</span>
                        <span
                          dir="ltr"
                          className="text-slate-200 font-mono-tabular mt-0.5 block"
                        >
                          {formatPrice(trade.entryPrice)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">السعر الحالي</span>
                        <span
                          dir="ltr"
                          className="text-slate-100 font-medium font-mono-tabular mt-0.5 block"
                        >
                          {formatPrice(trade.currentPrice)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">الوقف (SL)</span>
                        <span
                          dir="ltr"
                          className="text-rose-400 font-mono-tabular mt-0.5 block"
                        >
                          {formatPrice(trade.stopLoss)}
                        </span>
                      </div>
                    </div>

                    {trade.takeProfits.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>هدف البيع الكامل:</span>
                        <span
                          dir="ltr"
                          className={`inline-flex items-center gap-1 font-mono-tabular ${
                            trade.hitTakeProfits.includes(trade.takeProfits[0])
                              ? 'text-emerald-400'
                              : 'text-emerald-300'
                          }`}
                        >
                          {trade.hitTakeProfits.includes(trade.takeProfits[0]) && (
                            <Check className="w-3 h-3" />
                          )}
                          {formatPrice(trade.takeProfits[0])}
                          {trade.takeProfitPercent ? ` (+${trade.takeProfitPercent}%)` : ''}
                        </span>
                      </div>
                    )}

                    <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs">
                      <span className="text-slate-500" dir="ltr">
                        @{trade.channelUsername} · ${trade.marginUsdt.toFixed(2)}
                        {trade.capitalPercent ? ` (${trade.capitalPercent}%)` : ''}
                      </span>
                      <button
                        disabled={busyId === trade.id}
                        onClick={() => onCloseTrade(trade.id)}
                        className="px-3 py-1.5 text-xs font-medium text-rose-300 hover:text-white hover:bg-rose-600/80 border border-slate-700 hover:border-rose-600 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        إغلاق بسعر السوق
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
