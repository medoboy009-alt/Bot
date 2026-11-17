import { useState, type FormEvent } from 'react';
import {
  Eye,
  FlaskConical,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DashboardStateResponse,
  MarketType,
  ScrapedPostPreview,
  SignalRecord,
} from '../types';
import { api } from '../lib/api';

interface ChannelsTabProps {
  data: DashboardStateResponse;
  onStateChange: (next: DashboardStateResponse) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

const SAMPLE_ARABIC_SPOT = `🟢 توصية شراء فوري (Spot)
العملة: #SOL / USDT
سعر الدخول: بسعر السوق الحالي
الأهداف:
🎯 الهدف الأول: 225
🎯 الهدف الثاني: 238
🎯 الهدف الثالث: 255
🛑 وقف الخسارة: 195`;

const SAMPLE_ENGLISH_FUTURES = `⚡ #BTCUSDT LONG (Futures 5x)
Entry Zone: 90500 - 91200
TP1: 92400
TP2: 94000
TP3: 96500
SL: 88900`;

export function ChannelsTab({
  data,
  onStateChange,
  onNotify,
}: ChannelsTabProps) {
  const [username, setUsername] = useState('');
  const [marketType, setMarketType] = useState<MarketType>(
    data.risk.defaultMarketType
  );
  const [autoExecute, setAutoExecute] = useState(true);
  const [adding, setAdding] = useState(false);

  const [previewChannel, setPreviewChannel] = useState<{
    username: string;
    title: string;
    posts: ScrapedPostPreview[];
  } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const [testText, setTestText] = useState(SAMPLE_ARABIC_SPOT);
  const [testMarket, setTestMarket] = useState<MarketType>('SPOT');
  const [testingSignal, setTestingSignal] = useState(false);
  const [lastTestedSignal, setLastTestedSignal] = useState<SignalRecord | null>(
    null
  );

  async function handleAddChannel(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setAdding(true);
    try {
      const res = await api.addChannel({
        username: username.trim(),
        marketType,
        autoExecute,
      });
      onStateChange(res.state);
      setUsername('');
      onNotify('تم ربط قناة التليجرام وجلب آخر المنشورات بنجاح.', 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'تعذر إضافة القناة.',
        'error'
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleChannel(
    id: string,
    patch: Partial<{ enabled: boolean; autoExecute: boolean; marketType: MarketType }>
  ) {
    try {
      const next = await api.updateChannel(id, patch);
      onStateChange(next);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر التحديث.', 'error');
    }
  }

  async function handleDeleteChannel(id: string) {
    try {
      const next = await api.deleteChannel(id);
      onStateChange(next);
      onNotify('تم حذف القناة من قائمة المراقبة.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر الحذف.', 'error');
    }
  }

  async function handlePreview(id: string) {
    setPreviewLoadingId(id);
    try {
      const res = await api.previewChannel(id);
      setPreviewChannel(res);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'تعذر معاينة منشورات القناة.',
        'error'
      );
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleTestSignal(execute: boolean) {
    if (!testText.trim()) return;
    setTestingSignal(true);
    try {
      const res = await api.testSignal({
        rawText: testText,
        marketType: testMarket,
        execute,
      });
      setLastTestedSignal(res.signal);
      onStateChange(res.state);
      onNotify(
        execute
          ? 'تم تحليل التوصية وتنفيذها حسب قواعد إدارة المخاطر.'
          : 'تم تحليل التوصية بالذكاء الاصطناعي بنجاح.',
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'تعذر تحليل التوصية.',
        'error'
      );
    } finally {
      setTestingSignal(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Add Public Telegram Channel */}
      <section className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-slate-100">
            ربط قناة تليجرام عامة
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            أدخل معرف القناة العامة (مثل <span dir="ltr" className="font-mono-tabular text-slate-300">@channel_name</span> أو رابط <span dir="ltr" className="font-mono-tabular text-slate-300">t.me/channel_name</span>). يقرأ النظام المنشورات الجديدة مباشرة دون الحاجة لتسجيل دخول حسابك الشخصي.
          </p>
        </div>

        <form
          onSubmit={handleAddChannel}
          className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              معرف القناة أو الرابط
            </label>
            <input
              type="text"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@crypto_signals or https://t.me/channel"
              className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none font-mono-tabular"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              نوع السوق الافتراضي
            </label>
            <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
              {(['SPOT', 'FUTURES'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMarketType(m)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    marketType === m
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'SPOT' ? 'Spot (فوري)' : 'Futures (عقود)'}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 flex items-center h-[42px]">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoExecute}
                onChange={(e) => setAutoExecute(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-[#0B0F17] accent-emerald-500"
              />
              <span>تنفيذ تلقائي</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding || !username.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{adding ? 'جارٍ الفحص...' : 'إضافة القناة'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Monitored Channels List */}
      <section className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              القنوات المراقبة ({data.channels.length})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              يتم فحص القنوات المفعّلة كل {data.risk.pollIntervalSeconds} ثانية عند تشغيل الأتمتة
            </p>
          </div>
        </div>

        {data.channels.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-300">
              لم تقم بإضافة أي قناة تليجرام عامة حتى الآن
            </p>
            <p className="text-xs text-slate-500 mt-1">
              استخدم النموذج أعلاه لإضافة قناة عامة، أو اختبر المحلل الذكي في القسم أدناه.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {data.channels.map((ch) => (
              <div
                key={ch.id}
                className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">
                      {ch.title}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span
                      dir="ltr"
                      className="text-xs text-slate-400 font-mono-tabular"
                    >
                      @{ch.username}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span
                      className={`text-xs ${
                        ch.enabled ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {ch.enabled ? 'مفعّلة' : 'متوقفة'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>المنشورات المرصودة: {ch.messagesFound}</span>
                    <span aria-hidden="true">·</span>
                    <span>التوصيات الصالحة: {ch.signalsFound}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      آخر فحص:{' '}
                      <span className="font-mono-tabular">
                        {ch.lastCheckedAt
                          ? new Date(ch.lastCheckedAt).toLocaleTimeString('ar-EG')
                          : '—'}
                      </span>
                    </span>
                  </div>

                  {ch.lastError && (
                    <p className="text-xs text-rose-400 mt-1">{ch.lastError}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <select
                    value={ch.marketType}
                    onChange={(e) =>
                      handleToggleChannel(ch.id, {
                        marketType: e.target.value as MarketType,
                      })
                    }
                    className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 focus:outline-none"
                  >
                    <option value="SPOT">Spot</option>
                    <option value="FUTURES">Futures</option>
                  </select>

                  <button
                    onClick={() =>
                      handleToggleChannel(ch.id, { autoExecute: !ch.autoExecute })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      ch.autoExecute
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#0B0F17] border-slate-800 text-slate-400'
                    }`}
                  >
                    {ch.autoExecute ? 'تنفيذ تلقائي: مفعل' : 'تنفيذ تلقائي: معطل'}
                  </button>

                  <button
                    onClick={() =>
                      handleToggleChannel(ch.id, { enabled: !ch.enabled })
                    }
                    className="px-3 py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {ch.enabled ? 'إيقاف المراقبة' : 'تفعيل المراقبة'}
                  </button>

                  <button
                    disabled={previewLoadingId === ch.id}
                    onClick={() => handlePreview(ch.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>
                      {previewLoadingId === ch.id
                        ? 'جارٍ الجلب...'
                        : 'معاينة المنشورات'}
                    </span>
                  </button>

                  <button
                    onClick={() => handleDeleteChannel(ch.id)}
                    aria-label="حذف القناة"
                    className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Channel Preview Drawer */}
      {previewChannel && (
        <section className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                آخر منشورات {previewChannel.title} (@{previewChannel.username})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                جلب حي من المعاينة العامة على تليجرام
              </p>
            </div>
            <button
              onClick={() => setPreviewChannel(null)}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto">
            {previewChannel.posts.map((post) => (
              <div key={post.messageId} className="px-5 py-3.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span dir="ltr" className="font-mono-tabular">
                    #{post.messageId}
                  </span>
                  <span className="font-mono-tabular">
                    {new Date(post.postedAt).toLocaleString('ar-EG')}
                  </span>
                </div>
                <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {post.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Signal Parser Sandbox */}
      <section className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-emerald-400" />
              <span>مختبر اختبار وتحليل التوصيات بالذكاء الاصطناعي</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              الصق أي رسالة توصية (بالعربية أو الإنجليزية) لاختبار دقة استخراج العملة والأهداف ووقف الخسارة قبل الاعتماد التلقائي.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTestText(SAMPLE_ARABIC_SPOT);
                setTestMarket('SPOT');
              }}
              className="px-3 py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              نموذج سبوت عربي
            </button>
            <button
              type="button"
              onClick={() => {
                setTestText(SAMPLE_ENGLISH_FUTURES);
                setTestMarket('FUTURES');
              }}
              className="px-3 py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              نموذج فيوتشر إنجليزي
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 space-y-3">
            <textarea
              rows={7}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="الصق نص التوصية هنا..."
              className="w-full p-3.5 text-sm bg-[#0B0F17] border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
                {(['SPOT', 'FUTURES'] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setTestMarket(m)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      testMarket === m
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testingSignal || !testText.trim()}
                  onClick={() => handleTestSignal(false)}
                  className="px-4 py-2 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {testingSignal ? 'جارٍ التحليل...' : 'تحليل فقط'}
                </button>
                <button
                  type="button"
                  disabled={testingSignal || !testText.trim()}
                  onClick={() => handleTestSignal(true)}
                  className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  تحليل وتنفيذ الآن
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 bg-[#0B0F17] border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-2.5 border-b border-slate-800">
              <span>نتيجة التحليل المهيكلة</span>
              <span dir="ltr" className="font-mono-tabular">
                {lastTestedSignal?.parsed.parserSource ?? 'Gemini AI'}
              </span>
            </div>

            {!lastTestedSignal ? (
              <div className="py-12 text-center text-xs text-slate-500">
                اضغط «تحليل فقط» أو «تحليل وتنفيذ الآن» لمعاينة البيانات المستخرجة من النص.
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 block">التصنيف</span>
                    <span
                      className={`font-medium mt-0.5 block ${
                        lastTestedSignal.parsed.isSignal
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {lastTestedSignal.parsed.isSignal
                        ? 'توصية صالحة'
                        : 'ليست توصية'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">الزوج</span>
                    <span
                      dir="ltr"
                      className="text-slate-100 font-mono-tabular font-medium mt-0.5 block"
                    >
                      {lastTestedSignal.parsed.symbol || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">الاتجاه والسوق</span>
                    <span className="text-slate-200 mt-0.5 block">
                      {lastTestedSignal.parsed.side === 'BUY' ? 'شراء' : 'بيع'} ·{' '}
                      {lastTestedSignal.parsed.marketType}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">الدخول</span>
                    <span
                      dir="ltr"
                      className="text-slate-200 font-mono-tabular mt-0.5 block"
                    >
                      {lastTestedSignal.parsed.entryMin
                        ? `${lastTestedSignal.parsed.entryMin}${
                            lastTestedSignal.parsed.entryMax &&
                            lastTestedSignal.parsed.entryMax !==
                              lastTestedSignal.parsed.entryMin
                              ? ` - ${lastTestedSignal.parsed.entryMax}`
                              : ''
                          }`
                        : 'سعر السوق'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">الأهداف</span>
                    <span
                      dir="ltr"
                      className="text-emerald-400 font-mono-tabular mt-0.5 block"
                    >
                      {lastTestedSignal.parsed.takeProfits.join(' · ') || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">وقف الخسارة</span>
                    <span
                      dir="ltr"
                      className="text-rose-400 font-mono-tabular mt-0.5 block"
                    >
                      {lastTestedSignal.parsed.stopLoss ?? '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-800/80 text-slate-300 leading-relaxed">
                  {lastTestedSignal.parsed.reasoning}
                </div>
                <div className="text-slate-400">
                  حالة الأمر: <span className="text-slate-200">{lastTestedSignal.statusReason}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
