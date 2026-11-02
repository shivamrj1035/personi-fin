"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CandlestickChart, ChevronLeft, ChevronRight, Flag, Home, Landmark, LogOut, MoreHorizontal, Plus, ReceiptText, RefreshCw, Settings, Sparkles, Table2, TrendingDown, Wallet, ArrowLeftRight, Lightbulb, AlertTriangle } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { MONTHS_SHORT, firstOfMonth, parts, today, addMonths } from "@/lib/dates";
import { SHEET_ID } from "@/lib/config";
import { AddLoanDialog } from "./add-loan-dialog";
import { ExtrasPrompt } from "./extras-prompt";
import { SettingsDialog } from "./settings-dialog";
import { Button, Dialog, Select, Skeleton, cn } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/loans", label: "Loans", icon: Landmark },
  { href: "/income", label: "Income", icon: Wallet },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/goals", label: "Goals & Savings", icon: Flag },
  { href: "/flow", label: "Income ↔ Outgo", icon: ArrowLeftRight },
  { href: "/planner", label: "Planner", icon: Lightbulb },
  { href: "/ask", label: "Ask Claude", icon: Sparkles },
  { href: "/finance", label: "Claude in Finance", icon: CandlestickChart },
];
const BOTTOM = ["/", "/loans", "/expenses", "/income"];

function MonthPicker({ compact }: { compact?: boolean }) {
  const { month, setMonth, shiftMonth, isCurrent } = useApp();
  const t = firstOfMonth(today()), p = parts(month);
  const years = [...new Set([...Array.from({ length: 11 }, (_, i) => parts(t).y - 5 + i), p.y])].sort();
  const tag = isCurrent ? "Current" : month < t ? "Past month" : "Planning ahead";
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-5 w-5" /></Button>
      <Select aria-label="Month" value={p.m} onChange={(e) => setMonth(`${p.y}-${String(e.target.value).padStart(2, "0")}-01`)} className="h-10 w-[4.6rem] px-2 text-sm">
        {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
      <Select aria-label="Year" value={p.y} onChange={(e) => setMonth(`${e.target.value}-${String(p.m).padStart(2, "0")}-01`)} className="h-10 w-[5.2rem] px-2 text-sm">
        {years.map((y) => <option key={y}>{y}</option>)}</Select>
      <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight className="h-5 w-5" /></Button>
      {!compact && <span className={cn("ml-1 hidden rounded-full px-2.5 py-0.5 text-xs font-semibold md:inline", isCurrent ? "bg-primary-soft text-primary" : "bg-warn-soft text-warn")}>{tag}</span>}
      {!isCurrent && <Button variant="soft" size="sm" onClick={() => setMonth(addMonths(t, 0))}>Today</Button>}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { state, error, loading, refresh, toast } = useApp();
  const [more, setMore] = useState(false);
  const [addLoan, setAddLoan] = useState(false);
  const [settings, setSettings] = useState(false);
  const current = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  const logout = async () => { await fetch("/api/logout", { method: "POST" }); window.location.assign("/login"); };
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-card lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-fg"><TrendingDown className="h-5 w-5" /></div>
          <div className="font-bold leading-tight">EL Smart<br /><span className="text-muted text-xs font-medium">Tracker</span></div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
          {NAV.map(({ href, label, icon: I }) => { const on = current?.href === href; return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition", on ? "bg-primary text-primary-fg shadow-sm" : "text-muted hover:bg-soft hover:text-fg")}>
              <I className="h-[18px] w-[18px]" />{label}</Link>); })}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <Button variant="primary" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={() => setAddLoan(true)}>Add loan</Button>
          <div className="flex gap-1 pt-1">
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSettings(true)}><Settings className="h-[18px] w-[18px]" /></Button>
            <a href={sheetUrl} target="_blank" rel="noreferrer" aria-label="Open Google Sheet" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-soft hover:text-fg"><Table2 className="h-[18px] w-[18px]" /></a>
            <Button variant="ghost" size="icon" aria-label="Sync" onClick={() => refresh(false)}><RefreshCw className="h-[18px] w-[18px]" /></Button>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={logout}><LogOut className="h-[18px] w-[18px]" /></Button>
          </div>
        </div>
      </aside>

      {/* top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-card/85 px-3 py-2 backdrop-blur sm:px-5" style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}>
        <div className="flex items-center gap-2 lg:hidden"><div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-fg"><TrendingDown className="h-4 w-4" /></div>
          <span className="hidden font-bold min-[420px]:inline">{current?.label ?? "EL Smart Tracker"}</span></div>
        <div className="hidden text-sm font-semibold text-muted lg:block">{current?.label}</div>
        <MonthPicker compact />
        <div className="hidden items-center gap-1 lg:flex"><Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refresh(false)}>Sync</Button></div>
        <Button className="lg:hidden" variant="soft" size="icon" aria-label="Add loan" onClick={() => setAddLoan(true)}><Plus className="h-5 w-5" /></Button>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-3 pb-28 pt-4 sm:px-5 lg:pb-10">
        {state ? children : error ? (
          <div className="mx-auto mt-16 max-w-md space-y-3 rounded-2xl border border-line bg-card p-6 text-center shadow-card">
            <AlertTriangle className="mx-auto h-9 w-9 text-warn" /><div className="font-semibold">Couldn&apos;t load your Sheet</div>
            <p className="text-sm text-muted break-words">{error}</p>
            <Button onClick={() => { void refresh(false).catch(() => toast("Still failing", "bad")); }}>Try again</Button></div>
        ) : (
          <div className="space-y-4" aria-busy={loading}><Skeleton className="h-9 w-56" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /><Skeleton className="h-48" /></div>
        )}
      </main>

      {/* mobile bottom nav */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/95 backdrop-blur lg:hidden" aria-label="Main">
        {NAV.filter((n) => BOTTOM.includes(n.href)).map(({ href, label, icon: I }) => { const on = current?.href === href; return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on ? "text-primary" : "text-muted")}>
            <I className="h-5 w-5" />{label.split(" ")[0]}</Link>); })}
        <button onClick={() => setMore(true)} className={cn("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", current && !BOTTOM.includes(current.href) ? "text-primary" : "text-muted")}>
          <MoreHorizontal className="h-5 w-5" />More</button>
      </nav>

      <Dialog open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {NAV.filter((n) => !BOTTOM.includes(n.href)).map(({ href, label, icon: I }) => (
            <Link key={href} href={href} onClick={() => setMore(false)} className="flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium hover:bg-soft"><I className="h-5 w-5 text-primary" />{label}</Link>))}
          <button onClick={() => { setMore(false); setSettings(true); }} className="flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium hover:bg-soft"><Settings className="h-5 w-5 text-primary" />Settings</button>
          <button onClick={() => { setMore(false); void refresh(false); }} className="flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium hover:bg-soft"><RefreshCw className="h-5 w-5 text-primary" />Sync</button>
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium hover:bg-soft"><Table2 className="h-5 w-5 text-primary" />Open Sheet</a>
          <button onClick={logout} className="flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium hover:bg-soft"><LogOut className="h-5 w-5 text-primary" />Sign out</button>
        </div>
      </Dialog>

      <AddLoanDialog open={addLoan} onClose={() => setAddLoan(false)} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      {state && <ExtrasPrompt />}
    </div>
  );
}

