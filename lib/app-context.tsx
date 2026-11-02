"use client";
/** Client data layer: holds the workbook, the selected month, and the one way to change anything (`act`). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { ISODate, addMonths, firstOfMonth, monthKey, today } from "./dates";
import { State, Tabs } from "./state";

export type ToastTone = "good" | "bad" | "info" | "warn";
interface Toast { id: number; msg: string; tone: ToastTone }
export interface ActOpts { msg?: string; busy?: string; quiet?: boolean }

interface Ctx {
  state: State | null;
  tabs: Tabs | null;
  loading: boolean;
  error: string | null;
  /** First day of the month shown everywhere (the global month picker). */
  month: ISODate;
  mk: string;
  isCurrent: boolean;
  setMonth: (d: ISODate) => void;
  shiftMonth: (n: number) => void;
  /** Re-read the Sheet. quiet = background poll (no spinner/toast). */
  refresh: (quiet?: boolean) => Promise<void>;
  /** Run a server action (see lib/rpc.ts). Shows a busy overlay, refreshes the data, toasts `msg`. Returns the action's result, or undefined on failure. */
  act: <T = unknown>(name: string, args?: Record<string, unknown>, opts?: ActOpts) => Promise<T | undefined>;
  toast: (msg: string, tone?: ToastTone) => void;
  /** Overlay spinner around any async work (AI calls, uploads...). */
  busy: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  /** POST JSON to an API route that needs the data (AI): includes the current tabs. */
  ai: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = (): Ctx => { const c = useContext(AppCtx); if (!c) throw new Error("useApp outside AppProvider"); return c; };
/** For pages: state is guaranteed (the shell shows a skeleton until it loads). */
export const useData = (): Ctx & { state: State; tabs: Tabs } => { const c = useApp(); return c as Ctx & { state: State; tabs: Tabs }; };

async function json<T>(res: Response): Promise<T> {
  const d = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (res.status === 401) { window.location.assign("/login"); throw new Error("Signed out"); }
  if (!res.ok || d.error) throw new Error(d.error || `Server error (${res.status})`);
  return d as T;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tabs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonthState] = useState<ISODate>(() => firstOfMonth(today()));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const busyN = useRef(0);
  const inflight = useRef(false);
  const tabsRef = useRef<Tabs | null>(null);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const toast = useCallback((msg: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 3500);
  }, []);

  const busy = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    busyN.current++; setBusyLabel(label);
    try { return await fn(); } finally { if (--busyN.current <= 0) { busyN.current = 0; setBusyLabel(null); } }
  }, []);

  const setIfChanged = useCallback((next: Tabs) => setTabs((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next)), []);

  const refresh = useCallback(async (quiet = true) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const first = tabsRef.current === null;
      const d = await (quiet ? json<{ tabs: Tabs }>(await fetch("/api/state", { cache: "no-store" })) : busy("Syncing with your Google Sheet...", async () => json<{ tabs: Tabs }>(await fetch("/api/state", { cache: "no-store" }))));
      const changed = tabsRef.current !== null && JSON.stringify(tabsRef.current) !== JSON.stringify(d.tabs);
      setIfChanged(d.tabs); setError(null);
      if (!quiet) toast("Synced with your Sheet", "good"); else if (changed && !first) toast("Google Sheet changed - updated", "info");
    } catch (e) {
      if (tabsRef.current === null) setError((e as Error).message); else if (!quiet) toast((e as Error).message, "bad");
    } finally { inflight.current = false; setLoading(false); }
  }, [busy, setIfChanged, toast]);

  const act = useCallback(async <T,>(name: string, args: Record<string, unknown> = {}, opts: ActOpts = {}): Promise<T | undefined> => {
    try {
      const d = await busy(opts.busy || "Saving to your Google Sheet...", async () =>
        json<{ result: T; tabs: Tabs }>(await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) })));
      setIfChanged(d.tabs);
      if (opts.msg) toast(opts.msg, "good");
      return (d.result ?? (true as unknown)) as T;
    } catch (e) { toast(`Could not save: ${(e as Error).message}`.slice(0, 220), "bad"); return undefined; }
  }, [busy, setIfChanged, toast]);

  const ai = useCallback(async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> =>
    json<T>(await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, tabs: tabsRef.current }) })), []);

  // initial load from the server
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => { // pick up edits made in the Google Sheet: every 90s while visible, and when you come back to the tab
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 90_000);
    const v = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [refresh]);

  const state = useMemo(() => (tabs ? new State(tabs) : null), [tabs]);
  const setMonth = useCallback((d: ISODate) => setMonthState(firstOfMonth(d)), []);
  const shiftMonth = useCallback((n: number) => setMonthState((m) => addMonths(m, n)), []);
  const value = useMemo<Ctx>(() => ({ state, tabs, loading, error, month, mk: monthKey(month), isCurrent: month === firstOfMonth(today()), setMonth, shiftMonth, refresh, act, toast, busy, ai }),
    [state, tabs, loading, error, month, setMonth, shiftMonth, refresh, act, toast, busy, ai]);

  const Icon = { good: CheckCircle2, bad: AlertCircle, info: Info, warn: AlertCircle };
  const toneCls = { good: "text-good", bad: "text-bad", info: "text-primary", warn: "text-warn" };
  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => { const I = Icon[t.tone]; return (
          <div key={t.id} className="anim-pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm shadow-card">
            <I className={`mt-0.5 h-4 w-4 shrink-0 ${toneCls[t.tone]}`} /><span>{t.msg}</span></div>); })}
      </div>
      {busyLabel && (
        <div className="anim-fade fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 backdrop-blur-[2px]" role="alert" aria-busy="true">
          <div className="anim-pop flex min-w-64 flex-col items-center gap-3 rounded-2xl border border-line bg-card px-8 py-6 text-center shadow-2xl">
            <Loader2 className="h-9 w-9 animate-spin text-primary" /><div className="font-medium">{busyLabel}</div><div className="text-xs text-muted">Please wait - this can take a few seconds.</div></div>
        </div>)}
    </AppCtx.Provider>
  );
}
