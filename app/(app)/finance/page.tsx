"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Percent, Pencil, Plus, Sparkles, TrendingUp, Trash2, Wallet, LineChart } from "lucide-react";
import { Badge, Button, Card, Empty, Field, Input, Kpi, KpiGrid, NumberInput, PageHeader, Section, Select, Spinner, type Tone } from "@/components/ui";
import { HoldingDialog } from "@/components/holding-dialog";
import { ConfirmDialog, monthFigures } from "@/components/goal-dialogs";
import { useData } from "@/lib/app-context";
import { monthLong } from "@/lib/dates";
import { inr } from "@/lib/format";
import { holdingsRows } from "@/lib/holdings";
import type { Review } from "@/lib/invest-types";
import { Row, num } from "@/lib/state";

const RISKS = ["conservative", "moderate", "aggressive"];
const HORIZONS = ["< 1 year", "1-3 years", "3-5 years", "5+ years"];
const ACTION_TONE: Record<string, Tone> = { BUY: "good", ADD: "good", HOLD: "indigo", TRIM: "warn", SELL: "bad" };
const KEY = "el-invest-review";
const EVT = "el-invest-review-change";
const subscribe = (cb: () => void) => { window.addEventListener(EVT, cb); return () => window.removeEventListener(EVT, cb); };
const readRaw = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
interface Saved { review: Review; at: string; mk: string }

function ReviewView({ a, holdings, month }: { a: Review; holdings: Row[]; month: string }) {
  if (a.text) return <Card><p className="whitespace-pre-wrap text-sm">{a.text}</p></Card>;
  const mood = String(a.mood ?? "neutral").toLowerCase();
  const byTicker = new Map(holdings.map((h) => [String(h.symbol).toUpperCase(), h]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={mood === "bullish" ? "good" : mood === "cautious" ? "warn" : "indigo"}>Market: {mood}</Badge>
        <span className="text-sm text-muted">{a.market_view}</span>
      </div>
      {!!a.this_month_plan?.length && (
        <Card className="space-y-1">
          <h3 className="text-lg font-semibold">This month&apos;s plan - {month}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">{a.this_month_plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </Card>
      )}
      <Section title="Suggested to buy now">
        {!a.buy?.length ? <p className="text-sm text-muted">Nothing worth buying right now - keeping the money in reserve or against debt is fine.</p> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {a.buy.map((b, i) => (
              <Card key={i} className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 font-semibold">{b.symbol} - {b.name}</div>
                  <div className="shrink-0 font-semibold text-primary">{inr(num(b.amount))}</div>
                </div>
                <p className="text-sm">{b.why}</p>
                <dl className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <div><dt className="text-muted">Buy around</dt><dd className="font-medium">{b.entry_range || "-"}</dd></div>
                  <div><dt className="text-muted">Target</dt><dd className="font-medium text-good">{b.target || "-"}</dd></div>
                  <div><dt className="text-muted">Stop-loss</dt><dd className="font-medium text-bad">{b.stop_loss || "-"}</dd></div>
                </dl>
                {b.horizon && <p className="text-xs text-muted">Horizon: {b.horizon}</p>}
              </Card>
            ))}
          </div>
        )}
      </Section>
      {!!a.holdings?.length && (
        <Section title="What to do with what you hold">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {a.holdings.map((r, i) => {
              const act = String(r.action ?? "HOLD").toUpperCase();
              const mine = byTicker.get(String(r.symbol).toUpperCase());
              const px = typeof r.price_checked === "number" ? r.price_checked : 0;
              const pl = mine && px > 0 && mine.avg_price ? (px - mine.avg_price) * mine.qty : null;
              return (
                <Card key={i} className="space-y-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.symbol}</span><Badge tone={ACTION_TONE[act] ?? "indigo"}>{act}</Badge></div>
                  <p className="text-sm">{r.why}</p>
                  <p className="text-xs text-muted">Trigger: {r.sell_or_add_trigger || "-"}</p>
                  {pl != null && mine && (
                    <p className={`text-xs font-medium ${pl >= 0 ? "text-good" : "text-bad"}`}>
                      Price checked {inr(px)} vs your average {inr(mine.avg_price)}: {pl >= 0 ? "profit" : "loss"} {inr(Math.abs(pl))} ({((px / mine.avg_price - 1) * 100).toFixed(1)}%)
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      )}
      {!!a.risks?.length && (
        <div className="flex flex-wrap gap-2">{a.risks.map((x, i) => <Badge key={i} tone="warn" className="whitespace-normal"><AlertTriangle className="h-3 w-3 shrink-0" />{x}</Badge>)}</div>
      )}
    </div>
  );
}

export default function FinancePage() {
  const { state, month, mk, act, ai, toast } = useData();
  const hs = holdingsRows(state);
  const invested = hs.reduce((s, h) => s + h.cost, 0);
  const f = monthFigures(state, mk);
  const safe = Math.max(f.income - f.expenses - f.loans - f.extras - num(state.settings.emergency_buffer), 0);
  const costly = Math.max(0, ...state.activeLoans().map((l) => num(l.rate_pa)));
  const risk = state.settings.risk_profile || "moderate";
  const horizon = state.settings.invest_horizon || "3-5 years";

  const [amount, setAmount] = useState<number | null>(null); // null = follow safe-to-invest
  const [question, setQuestion] = useState("");
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const saved = useMemo<Saved | null>(() => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }, [raw]);
  const [loading, setLoading] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<{ h: Row | null } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const budget = amount ?? Math.round(safe);

  async function setPref(key: string, value: string) { await act("setSetting", { key, value }, { msg: "Preference saved", busy: "Saving preference..." }); }

  async function review() {
    if (!(budget > 0) && !hs.length) return toast("Add a holding or an amount to invest first", "warn");
    setError(""); setLoading(true); setSecs(0);
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    try {
      const r = await ai<Review & { error?: string }>("/api/invest", { investable: budget, question });
      const s: Saved = { review: r, at: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), mk };
      try { sessionStorage.setItem(KEY, JSON.stringify(s)); window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setLoading(false);
    }
  }

  const stage = secs < 20 ? "Reading your holdings and loans..." : secs < 70 ? "Checking current prices and news on the web..." : "Writing up your plan...";

  return (
    <div className="space-y-6">
      <PageHeader title="Claude in Finance" subtitle="Your holdings, plus a monthly review: what to buy now, what to hold, and when to sell. Claude checks current prices and news on the web."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ h: null })}>Add holding</Button>} />
      <KpiGrid className="lg:grid-cols-3">
        <Kpi label="Invested (at cost)" value={inr(invested)} sub={`${hs.length} holding${hs.length === 1 ? "" : "s"}`} icon={<TrendingUp />} />
        <Kpi label="Safe to invest" value={inr(safe)} sub={`${monthLong(month)}: after EMIs, expenses and buffer`} icon={<Wallet />} tone={safe > 0 ? "good" : "warn"} />
        <Kpi label="Costliest loan" value={costly ? `${+costly.toFixed(2)}% p.a.` : "-"} sub="investing only beats prepaying if returns beat this" icon={<Percent />} tone="warn" className="col-span-2 lg:col-span-1" />
      </KpiGrid>

      <Card className="space-y-4">
        <h2 className="font-semibold">Your preferences</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Amount to invest this month" hint={amount != null ? <button type="button" className="text-primary underline" onClick={() => setAmount(null)}>Use safe amount ({inr(safe)})</button> : "Defaults to what is safe to invest"}>
            <NumberInput value={budget} onChange={(v) => setAmount(v ?? 0)} prefix="₹" />
          </Field>
          <Field label="Risk appetite"><Select value={risk} onChange={(e) => void setPref("risk_profile", e.target.value)}>{RISKS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</Select></Field>
          <Field label="Horizon"><Select value={horizon} onChange={(e) => void setPref("invest_horizon", e.target.value)}>{HORIZONS.map((h) => <option key={h}>{h}</option>)}</Select></Field>
        </div>
        <Field label="Optional question"><Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Should I sell TCS now? Best index fund SIP?" /></Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Sparkles className="h-4 w-4" />} onClick={review} loading={loading}>Review this month</Button>
          {saved && !loading && <span className="text-xs text-muted">Reviewed {saved.at}{saved.mk !== mk ? ` (for ${saved.mk})` : ""}</span>}
        </div>
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">Decision support, not licensed investment advice. Markets can fall; do your own checking before acting.</p>
      </Card>

      {loading && (
        <Card className="flex items-center gap-3" role="status" aria-live="polite">
          <Spinner />
          <div><div className="font-medium">{stage}</div><div className="text-xs text-muted">This can take 1-3 minutes ({secs}s so far). Keep this page open.</div></div>
        </Card>
      )}
      {error && (
        <Card role="alert" className="border-bad/40 bg-bad-soft text-sm text-bad">
          <div className="font-semibold">The review failed</div>
          <p className="mt-1 break-words">{error}</p>
          {/ANTHROPIC_API_KEY/.test(error) && <p className="mt-1 text-xs">Set ANTHROPIC_API_KEY in the server environment, then try again.</p>}
        </Card>
      )}
      {!loading && saved && <ReviewView a={saved.review} holdings={hs} month={monthLong(month)} />}
      {!loading && !saved && !error && <p className="text-sm text-muted">No review yet. Press the button for this month&apos;s suggestions.</p>}

      <Section title="My holdings">
        {!hs.length ? (
          <Empty icon={<LineChart />} title="No holdings yet" action={<Button onClick={() => setEdit({ h: null })}>Add holding</Button>}>
            Add what you own (symbol, quantity, average price) to get hold / sell suggestions. You can still ask for buy ideas without any.
          </Empty>
        ) : (
          <Card className="divide-y divide-line p-0">
            {hs.map((h) => {
              const bits = [`${+h.qty.toFixed(4)} @ ${inr(h.avg_price)}`, `${Math.round((h.cost / (invested || 1)) * 100)}% of portfolio`];
              if (h.target_price) bits.push(`target ${inr(h.target_price)}`);
              if (h.stop_loss) bits.push(`stop ${inr(h.stop_loss)}`);
              return (
                <div key={h.row} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{h.symbol}{h.name ? ` - ${h.name}` : ""}</div>
                    <div className="text-xs text-muted">{bits.join(" · ")}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{inr(h.cost)}</div>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${h.symbol}`} onClick={() => setEdit({ h })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${h.symbol}`} onClick={() => setDel(h)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </Card>
        )}
      </Section>
      <HoldingDialog open={!!edit} onClose={() => setEdit(null)} holding={edit?.h ?? null} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Remove ${del?.symbol ?? ""} from your holdings?`} confirmLabel="Remove"
        onConfirm={() => del && void act("deleteFlat", { tab: "Holdings", row: Number(del.row) }, { msg: "Holding removed", busy: "Removing holding..." })}>
        This only removes it from your list here.
      </ConfirmDialog>
    </div>
  );
}
