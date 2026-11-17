import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Timer,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import type { DashboardStateResponse, MarketType, RiskConfig } from '../types';

interface SettingsTabProps {
  data: DashboardStateResponse;
  onStateChange: (next: DashboardStateResponse) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function SettingsTab({
  data,
  onStateChange,
  onNotify,
}: SettingsTabProps) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [savingMexc, setSavingMexc] = useState(false);
  const [testingMexc, setTestingMexc] = useState(false);

  const [risk, setRisk] = useState<RiskConfig>(data.risk);
  const [savingRisk, setSavingRisk] = useState(false);
  const [testingTick, setTestingTick] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cronUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/cron/tick`
      : '/api/cron/tick';

  useEffect(() => {
    setRisk(data.risk);
  }, [data.risk]);

  const capitalBaseUsdt = (() => {
    if (risk.executionMode === 'LIVE') {
      const usdt = data.mexc.spotBalances.find((b) => b.asset === 'USDT');
      return (usdt?.free ?? 0) + (usdt?.locked ?? 0);
    }
    const lockedPaper = data.trades
      .filter((t) => t.status === 'OPEN' && t.mode === 'PAPER')
      .reduce((sum, t) => sum + t.marginUsdt, 0);
    return data.engine.paperBalanceUsdt + lockedPaper;
  })();

  const estimatedTradeUsdt = (capitalBaseUsdt * risk.capitalPercentPerTrade) / 100;

  async function handleSaveMexc(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim()) return;
    setSavingMexc(true);
    try {
      const next = await api.saveMexcCredentials(apiKey.trim(), apiSecret.trim());
      onStateChange(next);
      setApiKey('');
      setApiSecret('');
      onNotify('تم حفظ مفاتيح MEXC على الخادم. اضغط فحص الاتصال للتحقق من الرصيد.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'فشل حفظ مفاتيح MEXC.',
        'error'
      );
    } finally {
      setSavingMexc(false);
    }
  }

  async function handleTestMexc() {
    setTestingMexc(true);
    try {
      const next = await api.testMexcConnection();
      onStateChange(next);
      onNotify('تم التحقق من حساب MEXC وجلب الأرصدة الحية بنجاح.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'فشل الاتصال بحساب MEXC.',
        'error'
      );
    } finally {
      setTestingMexc(false);
    }
  }

  async function handleSaveRisk(e: FormEvent) {
    e.preventDefault();
    setSavingRisk(true);
    try {
      const next = await api.updateRisk(risk);
      onStateChange(next);
      onNotify('تم حفظ إعدادات إدارة المخاطر والتنفيذ بنجاح.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'تعذر حفظ إعدادات المخاطر.',
        'error'
      );
    } finally {
      setSavingRisk(false);
    }
  }

  async function handleResetPaper() {
    try {
      const next = await api.resetPaperWallet();
      onStateChange(next);
      onNotify('تمت إعادة ضبط محفظة المحاكاة إلى 1,000 USDT.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'فشلت إعادة الضبط.',
        'error'
      );
    }
  }

  async function handleCopyCronUrl() {
    try {
      await navigator.clipboard.writeText(cronUrl);
      onNotify('تم نسخ رابط التشغيل التلقائي بنجاح.', 'success');
    } catch {
      onNotify('تعذر النسخ التلقائي — حدد الرابط وانسخه يدوياً.', 'error');
    }
  }

  async function handleTestTick() {
    setTestingTick(true);
    try {
      const res = await api.triggerCronTick();
      onNotify(
        `النبضة تعمل بنجاح — القنوات المفحوصة: ${res.scannedChannels} · منشورات جديدة: ${res.newMessages}`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'فشل اختبار رابط التشغيل التلقائي.',
        'error'
      );
    } finally {
      setTestingTick(false);
    }
  }

  async function handleRestoreBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const next = await api.restoreBackup(parsed);
      onStateChange(next);
      onNotify('تمت استعادة القنوات والإعدادات وسجل الصفقات بنجاح.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'فشل قراءة ملف النسخة الاحتياطية.',
        'error'
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* MEXC API Connection */}
      <section className="xl:col-span-5 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-400" />
            <span>ربط حساب منصة MEXC</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            تُحفظ مفاتيح MEXC على الخادم فقط ولا تُرسل أبداً إلى المتصفح. فعّل صلاحية التداول (Spot / Futures Trade) بدون تفعيل السحب (Withdraw).
          </p>
        </div>

        {/* Account Verification State */}
        <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">حالة الربط</span>
            <span
              className={
                data.mexc.accountStatus === 'VERIFIED'
                  ? 'text-emerald-400 font-medium inline-flex items-center gap-1'
                  : data.mexc.accountStatus === 'ERROR'
                    ? 'text-rose-400 font-medium'
                    : 'text-slate-400'
              }
            >
              {data.mexc.accountStatus === 'VERIFIED' && (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              {data.mexc.accountStatus === 'VERIFIED'
                ? 'متصل وموثق'
                : data.mexc.accountStatus === 'ERROR'
                  ? 'فشل المصادقة'
                  : data.mexc.hasApiKey
                    ? 'محفوظ — بانتظار الفحص'
                    : 'غير مضبوط'}
            </span>
          </div>

          {data.mexc.hasApiKey && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400">المفتاح المحفوظ</span>
              <span dir="ltr" className="font-mono-tabular text-slate-200">
                {data.mexc.apiKeyMasked}
              </span>
            </div>
          )}

          {data.mexc.lastError && (
            <p className="text-rose-400 pt-1">{data.mexc.lastError}</p>
          )}
        </div>

        <form onSubmit={handleSaveMexc} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              MEXC API Key
            </label>
            <input
              type="text"
              dir="ltr"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="mx0vgl..."
              className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none font-mono-tabular"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              MEXC Secret Key
            </label>
            <input
              type="password"
              dir="ltr"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="••••••••••••••••••••"
              className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none font-mono-tabular"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={savingMexc || !apiKey.trim() || !apiSecret.trim()}
              className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {savingMexc ? 'جارٍ الحفظ...' : 'حفظ المفاتيح'}
            </button>

            <button
              type="button"
              disabled={testingMexc || !data.mexc.hasApiKey}
              onClick={handleTestMexc}
              className="px-4 py-2 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {testingMexc ? 'جارٍ الفحص...' : 'فحص الاتصال وجلب الرصيد'}
            </button>
          </div>
        </form>

        {/* Real MEXC Spot Balances */}
        {data.mexc.spotBalances.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <h3 className="text-xs font-medium text-slate-300">
              أرصدة MEXC Spot الحقيقية
            </h3>
            <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden">
              {data.mexc.spotBalances.map((bal) => (
                <div
                  key={bal.asset}
                  className="px-3.5 py-2 flex items-center justify-between text-xs bg-[#0B0F17]"
                >
                  <span
                    dir="ltr"
                    className="font-mono-tabular font-medium text-slate-200"
                  >
                    {bal.asset}
                  </span>
                  <span
                    dir="ltr"
                    className="font-mono-tabular text-slate-300"
                  >
                    {bal.free.toLocaleString('en-US', {
                      maximumFractionDigits: 6,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Paper Reset */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            رصيد المحاكاة الحالي:{' '}
            <span dir="ltr" className="font-mono-tabular text-slate-200">
              ${data.engine.paperBalanceUsdt.toFixed(2)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetPaper}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة ضبط المحاكاة</span>
          </button>
        </div>
      </section>

      {/* Risk Management & Execution Rules */}
      <section className="xl:col-span-7 bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>قواعد التنفيذ وإدارة المخاطر</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            تحمي هذه الضوابط رأس مالك تلقائياً من التوصيات عالية الخطورة أو الخسائر المتتالية.
          </p>
        </div>

        <form onSubmit={handleSaveRisk} className="space-y-5">
          {/* Execution Mode Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              وضع التنفيذ
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setRisk({ ...risk, executionMode: 'PAPER' })}
                className={`py-2.5 px-3 text-xs font-medium rounded-md transition-colors text-center cursor-pointer ${
                  risk.executionMode === 'PAPER'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                وضع المحاكاة (Paper Trading بأسعار MEXC الحية)
              </button>
              <button
                type="button"
                onClick={() => setRisk({ ...risk, executionMode: 'LIVE' })}
                className={`py-2.5 px-3 text-xs font-medium rounded-md transition-colors text-center cursor-pointer ${
                  risk.executionMode === 'LIVE'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                التنفيذ الحقيقي المباشر (Live MEXC API)
              </button>
            </div>
            {risk.executionMode === 'PAPER' && (
              <p className="mt-2 text-xs text-slate-400">
                في التداول الافتراضي: تُنفَّذ الصفقات كـ <span className="text-slate-200 font-medium">Spot شراء فقط بدون رافعة مالية</span>، وتُتجاهل توصيات البيع/الشورت تلقائياً.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                نسبة الدخول من رأس المال (%)
              </label>
              <input
                type="number"
                min={1}
                max={100}
                step={0.5}
                dir="ltr"
                value={risk.capitalPercentPerTrade}
                onChange={(e) =>
                  setRisk({
                    ...risk,
                    capitalPercentPerTrade: Math.min(100, Math.max(1, Number(e.target.value))),
                  })
                }
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 font-mono-tabular focus:outline-none"
              />
              <span className="mt-1.5 block text-[11px] text-slate-400 font-mono-tabular">
                ≈ ${estimatedTradeUsdt.toFixed(2)} USDT من رأس المال (${capitalBaseUsdt.toFixed(2)})
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                هدف البيع الكامل (%)
              </label>
              <input
                type="number"
                min={0.5}
                max={500}
                step={0.5}
                dir="ltr"
                value={risk.takeProfitPercent}
                onChange={(e) =>
                  setRisk({
                    ...risk,
                    takeProfitPercent: Math.min(500, Math.max(0.5, Number(e.target.value))),
                  })
                }
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 font-mono-tabular focus:outline-none"
              />
              <span className="mt-1.5 block text-[11px] text-slate-400">
                يتم بيع كامل الكمية (100%) تلقائياً عند تحقيق هذه النسبة من سعر الدخول.
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-slate-200 block">
                وقف الخسارة (Stop Loss)
              </span>
              <span className="text-xs text-slate-400 mt-0.5 block">
                يُؤخذ سعر وقف الخسارة تلقائياً من التوصية نفسها وتُغلق الصفقة بالكامل عند كسره.
              </span>
            </div>
            <span className="text-xs font-medium text-emerald-400 whitespace-nowrap shrink-0">
              من التوصية نفسها
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-800">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <label className="inline-flex items-center gap-2">
                <span>فحص القنوات كل (ثانية):</span>
                <input
                  type="number"
                  min={10}
                  max={300}
                  dir="ltr"
                  value={risk.pollIntervalSeconds}
                  onChange={(e) =>
                    setRisk({
                      ...risk,
                      pollIntervalSeconds: Number(e.target.value),
                    })
                  }
                  className="w-20 px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 font-mono-tabular focus:outline-none"
                />
              </label>

              <label className="inline-flex items-center gap-2">
                <span>السوق الافتراضي:</span>
                <select
                  value={risk.defaultMarketType}
                  onChange={(e) =>
                    setRisk({
                      ...risk,
                      defaultMarketType: e.target.value as MarketType,
                    })
                  }
                  className="px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 focus:outline-none"
                >
                  <option value="SPOT">SPOT</option>
                  <option value="FUTURES">FUTURES</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={savingRisk}
              className="px-5 py-2.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {savingRisk ? 'جارٍ الحفظ...' : 'حفظ قواعد المخاطر'}
            </button>
          </div>
        </form>
      </section>
    </div>

    {/* 24/7 Cloud Keep-Alive & Backup Panel */}
    <section className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Timer className="w-4 h-4 text-emerald-400" />
            <span>التشغيل المستمر 24/7 وحفظ البيانات بدون برمجة</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-3xl">
            بعد نشر التطبيق عبر زر <strong className="text-slate-200">Deploy</strong> في أعلى المنصة، استخدم هذا الرابط المجاني لإبقاء البوت مستيقظاً يفحص تليجرام ويغلق الصفقات على مدار الساعة حتى عند إغلاق المتصفح.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="/api/project-zip"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تحميل ملفات المشروع (ZIP)</span>
          </a>

          <a
            href="/api/backup"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تحميل نسخة احتياطية</span>
          </a>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleRestoreBackup}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>استعادة نسخة</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            readOnly
            dir="ltr"
            value={cronUrl}
            className="flex-1 px-3.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 font-mono-tabular focus:outline-none"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyCronUrl}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ الرابط</span>
            </button>
            <button
              type="button"
              disabled={testingTick}
              onClick={handleTestTick}
              className="px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {testingTick ? 'جارٍ الاختبار...' : 'اختبار النبضة'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-4 text-xs text-slate-400 leading-relaxed">
          الخطوات: افتح موقع <span dir="ltr" className="text-slate-200 font-mono-tabular">cron-job.org</span> (مجاني) ← أنشئ Cronjob ← الصق الرابط أعلاه ← اختر كل <strong className="text-slate-200">1 دقيقة</strong>.
        </div>
      </div>
    </section>
    </div>
  );
}
