import { useMemo, useState } from 'react';
import type { DashboardStateResponse, TradeOrder } from '../types';

interface TradesTabProps {
  data: DashboardStateResponse;
  busyId: string | null;
  onCloseTrade: (id: string) => void;
}

type TradeFilter = 'ALL' | 'OPEN' | 'CLOSED' | 'PAPER' | 'LIVE';

function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (val >= 1) return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return val.toLocaleString('en-US', { maximumFractionDigits: 7 });
}

function tradeStatusText(status: TradeOrder['status']): {
  label: string;
  tone: string;
} {
  switch (status) {
    case 'OPEN':
      return { label: 'مفتوحة', tone: 'text-amber-400' };
    case 'TP_HIT':
      return { label: 'تحقق الهدف', tone: 'text-emerald-400' };
    case 'SL_HIT':
      return { label: 'وقف خسارة', tone: 'text-rose-400' };
    case 'CLOSED':
      return { label: 'مغلقة يدوياً', tone: 'text-slate-300' };
    case 'CANCELLED':
      return { label: 'ملغاة', tone: 'text-slate-500' };
    case 'FAILED':
      return { label: 'فاشلة', tone: 'text-rose-400' };
  }
}

export function TradesTab({ data, busyId, onCloseTrade }: TradesTabProps) {
  const [filter, setFilter] = useState<TradeFilter>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return data.trades.filter((t) => {
      if (filter === 'OPEN' && t.status !== 'OPEN') return false;
      if (filter === 'CLOSED' && t.status === 'OPEN') return false;
      if (filter === 'PAPER' && t.mode !== 'PAPER') return false;
      if (filter === 'LIVE' && t.mode !== 'LIVE') return false;
      if (
        q &&
        !t.symbol.includes(q) &&
        !t.channelUsername.toUpperCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [data.trades, filter, search]);

  const evaluation = useMemo(() => {
    const closed = data.trades.filter(
      (t) => t.status !== 'OPEN' && t.status !== 'FAILED'
    );
    const open = data.trades.filter((t) => t.status === 'OPEN');
    const wins = closed.filter((t) => t.realizedPnlUsdt > 0);
    const losses = closed.filter((t) => t.realizedPnlUsdt <= 0);
    const realizedTotal = closed.reduce((sum, t) => sum + t.realizedPnlUsdt, 0);
    const winRate =
      closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : null;

    const channelPnl = new Map<string, number>();
    for (const t of closed) {
      channelPnl.set(
        t.channelUsername,
        (channelPnl.get(t.channelUsername) ?? 0) + t.realizedPnlUsdt
      );
    }
    let bestChannel: { name: string; pnl: number } | null = null;
    for (const [name, pnl] of channelPnl.entries()) {
      if (!bestChannel || pnl > bestChannel.pnl) {
        bestChannel = { name, pnl };
      }
    }

    return {
      closedCount: closed.length,
      openCount: open.length,
      winsCount: wins.length,
      lossesCount: losses.length,
      realizedTotal,
      winRate,
      bestChannel,
    };
  }, [data.trades]);

  return (
    <div className="space-y-6">
      {/* Evaluation Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block">إجمالي الصفقات المغلقة</span>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-semibold text-slate-100 font-mono-tabular">
              {evaluation.closedCount}
            </span>
            <span className="text-xs text-slate-500">
              + {evaluation.openCount} مفتوحة
            </span>
          </div>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block">الرابحة مقابل الخاسرة</span>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono-tabular text-xl font-semibold">
            <span className="text-emerald-400">{evaluation.winsCount}</span>
            <span className="text-slate-600 text-sm">/</span>
            <span className="text-rose-400">{evaluation.lossesCount}</span>
          </div>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block">نسبة النجاح (Win Rate)</span>
          <div className="mt-1.5 text-xl font-semibold text-slate-100 font-mono-tabular">
            {evaluation.winRate !== null ? `${evaluation.winRate}%` : '—'}
          </div>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 block">صافي الربح المحقق</span>
          <div
            dir="ltr"
            className={`mt-1.5 text-xl font-semibold font-mono-tabular ${
              evaluation.realizedTotal > 0
                ? 'text-emerald-400'
                : evaluation.realizedTotal < 0
                  ? 'text-rose-400'
                  : 'text-slate-100'
            }`}
          >
            {evaluation.realizedTotal >= 0 ? '+' : ''}
            {evaluation.realizedTotal.toFixed(2)} USDT
          </div>
          {evaluation.bestChannel && (
            <span className="text-[11px] text-slate-500 block mt-0.5" dir="ltr">
              أفضل قناة: @{evaluation.bestChannel.name}
            </span>
          )}
        </div>
      </div>

      <section className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              سجل الصفقات والأوامر ({data.trades.length})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              جميع الأوامر المنفذة آلياً أو يدوياً مع تتبع الربح والخسارة مقابل أسعار MEXC
            </p>
          </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالعملة أو القناة..."
            className="px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none w-48"
          />

          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
            {(
              [
                { id: 'ALL', label: 'الكل' },
                { id: 'OPEN', label: 'مفتوحة' },
                { id: 'CLOSED', label: 'مغلقة' },
                { id: 'PAPER', label: 'محاكاة' },
                { id: 'LIVE', label: 'حقيقي' },
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
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-medium text-slate-300">
            لا توجد صفقات مطابقة للفلتر الحالي
          </p>
          <p className="text-xs text-slate-500 mt-1">
            ستظهر الصفقات هنا فور تنفيذ أول توصية في وضع المحاكاة أو التداول الحقيقي.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400 bg-[#0B0F17]/60">
                <th className="py-3 px-4 font-medium">الزوج / القناة</th>
                <th className="py-3 px-4 font-medium">النوع / الوضع</th>
                <th className="py-3 px-4 font-medium text-left" dir="ltr">
                  Entry
                </th>
                <th className="py-3 px-4 font-medium text-left" dir="ltr">
                  Current
                </th>
                <th className="py-3 px-4 font-medium text-left" dir="ltr">
                  Size (USDT)
                </th>
                <th className="py-3 px-4 font-medium text-left" dir="ltr">
                  PnL
                </th>
                <th className="py-3 px-4 font-medium">الحالة</th>
                <th className="py-3 px-4 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filtered.map((trade) => {
                const totalPnl =
                  trade.status === 'OPEN'
                    ? trade.realizedPnlUsdt + trade.unrealizedPnlUsdt
                    : trade.realizedPnlUsdt;
                const statusMeta = tradeStatusText(trade.status);

                return (
                  <tr
                    key={trade.id}
                    className="h-11 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          dir="ltr"
                          className="font-semibold text-slate-100 font-mono-tabular"
                        >
                          {trade.symbol}
                        </span>
                        <span className="text-slate-500" dir="ltr">
                          @{trade.channelUsername}
                        </span>
                      </div>
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={
                          trade.side === 'BUY'
                            ? 'text-emerald-400 font-medium'
                            : 'text-rose-400 font-medium'
                        }
                      >
                        {trade.side === 'BUY' ? 'شراء' : 'بيع'}
                      </span>
                      <span className="text-slate-500">
                        {' '}
                        · {trade.marketType} ·{' '}
                        {trade.mode === 'LIVE' ? 'حقيقي' : 'محاكاة'}
                        {trade.leverage > 1 ? ` · ${trade.leverage}x` : ''}
                      </span>
                    </td>

                    <td
                      dir="ltr"
                      className="py-2.5 px-4 font-mono-tabular text-slate-200 text-left"
                    >
                      {formatPrice(trade.entryPrice)}
                    </td>

                    <td
                      dir="ltr"
                      className="py-2.5 px-4 font-mono-tabular text-slate-200 text-left"
                    >
                      {formatPrice(trade.currentPrice)}
                    </td>

                    <td
                      dir="ltr"
                      className="py-2.5 px-4 font-mono-tabular text-slate-300 text-left"
                    >
                      ${trade.marginUsdt.toFixed(2)}
                      {trade.capitalPercent ? ` (${trade.capitalPercent}%)` : ''}
                    </td>

                    <td
                      dir="ltr"
                      className={`py-2.5 px-4 font-mono-tabular font-medium text-left ${
                        totalPnl > 0
                          ? 'text-emerald-400'
                          : totalPnl < 0
                            ? 'text-rose-400'
                            : 'text-slate-300'
                      }`}
                    >
                      {totalPnl >= 0 ? '+' : ''}
                      {totalPnl.toFixed(2)} ({trade.pnlPercent >= 0 ? '+' : ''}
                      {trade.pnlPercent.toFixed(2)}%)
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className={statusMeta.tone}>{statusMeta.label}</span>
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {trade.status === 'OPEN' ? (
                        <button
                          disabled={busyId === trade.id}
                          onClick={() => onCloseTrade(trade.id)}
                          className="px-2.5 py-1 text-xs font-medium text-rose-300 hover:text-white border border-slate-700 hover:bg-rose-600/80 hover:border-rose-600 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          إغلاق
                        </button>
                      ) : (
                        <span
                          dir="ltr"
                          className="text-slate-500 font-mono-tabular"
                        >
                          {trade.mexcOrderId ?? '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
