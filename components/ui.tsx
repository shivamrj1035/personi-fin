"use client";
/** Shared UI kit. Mobile-first: 44px touch targets, dialogs become bottom sheets on phones, everything respects dark mode via tokens. */
import dynamic from "next/dynamic";
import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useState } from "react";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- buttons
type BtnProps = Omit<ComponentProps<"button">, "ref"> & { variant?: "primary" | "outline" | "ghost" | "danger" | "soft"; size?: "sm" | "md" | "icon"; loading?: boolean; icon?: ReactNode };
export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: "bg-primary text-primary-fg hover:opacity-90 shadow-sm",
    soft: "bg-primary-soft text-primary hover:opacity-80",
    outline: "border border-line bg-card text-fg hover:bg-soft",
    ghost: "text-muted hover:bg-soft hover:text-fg",
    danger: "bg-bad text-white hover:opacity-90",
  }[variant];
  const s = { sm: "h-9 px-3 text-sm gap-1.5", md: "h-11 px-4 text-sm gap-2", icon: "h-10 w-10 justify-center" }[size];
  return (
    <button {...p} disabled={disabled || loading}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-xl font-medium transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", v, s, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
    </button>
  );
}

// ---------------------------------------------------------------- surfaces
export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cn("rounded-2xl border border-line bg-card p-4 shadow-card", className)}>{children}</div>;
}

const TONES = { indigo: "text-primary bg-primary-soft", good: "text-good bg-good-soft", warn: "text-warn bg-warn-soft", bad: "text-bad bg-bad-soft", slate: "text-muted bg-soft" } as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = "slate", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function Kpi({ label, value, sub, icon, tone = "indigo", className }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="line-clamp-2 text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted">{label}</span>
        {icon && <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", TONES[tone])}>{icon}</span>}
      </div>
      <div className="truncate text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Progress({ value, tone = "good", className }: { value: number; tone?: "good" | "indigo" | "warn" | "bad"; className?: string }) {
  const c = { good: "bg-good", indigo: "bg-primary", warn: "bg-warn", bad: "bg-bad" }[tone];
  return <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-soft", className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
    <div className={cn("h-full rounded-full transition-all", c)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary [&_svg]:h-6 [&_svg]:w-6">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn("h-5 w-5 animate-spin text-primary", className)} aria-label="Loading" />; }
export function Skeleton({ className }: { className?: string }) { return <div className={cn("animate-pulse rounded-xl bg-soft", className)} />; }

// ---------------------------------------------------------------- dialog (centered on desktop, bottom sheet on phones)
export function Dialog({ open, onClose, title, children, footer, wide, persistent }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; persistent?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !persistent) onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, onClose, persistent]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="anim-fade absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={persistent ? undefined : onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} tabIndex={-1}
        className={cn("anim-sheet sm:anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-card shadow-2xl outline-none sm:max-h-[88dvh] sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" />
        {title && <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5"><h2 id={id} className="text-lg font-bold">{title}</h2>
          {!persistent && <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-soft"><X className="h-5 w-5" /></button>}</div>}
        <div className="flex-1 overflow-y-auto px-5 py-2">{children}</div>
        {footer && <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>, document.body);
}

// ---------------------------------------------------------------- form fields
export function Field({ label, hint, error, children, className }: { label?: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      {label && <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
const control = "h-11 w-full rounded-xl border border-line bg-card px-3 text-fg placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-60";
export function Input({ className, ...p }: ComponentProps<"input">) { return <input {...p} className={cn(control, className)} />; }
export function Textarea({ className, ...p }: ComponentProps<"textarea">) { return <textarea {...p} className={cn(control, "h-auto min-h-20 py-2", className)} />; }
export function Select({ className, children, ...p }: ComponentProps<"select">) { return <select {...p} className={cn(control, "appearance-none bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2394a3b8' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right .7rem center" }}>{children}</select>; }

/** Number input that keeps what you type (string state) and reports a number | null. */
export function NumberInput({ value, onChange, prefix, suffix, className, ...p }: Omit<ComponentProps<"input">, "value" | "onChange" | "prefix"> & { value: number | null | undefined; onChange: (v: number | null) => void; prefix?: string; suffix?: string }) {
  const [txt, setTxt] = useState(value == null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current && Number(txt) !== value) setTxt(value == null ? "" : String(value)); last.current = value; }, [value, txt]);
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{prefix}</span>}
      <input {...p} inputMode="decimal" value={txt} className={cn(control, prefix && "pl-8", suffix && "pr-10", "tabular-nums", className)}
        onChange={(e) => { const t = e.target.value.replace(/[^0-9.\-]/g, ""); setTxt(t); const n = t === "" || t === "-" || t === "." ? null : Number(t); last.current = n; onChange(n != null && Number.isFinite(n) ? n : null); }} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex w-full rounded-xl bg-soft p-1 sm:w-auto", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn("h-9 flex-1 rounded-lg px-3 text-sm font-medium transition sm:flex-none", value === o.value ? "bg-card text-fg shadow-sm" : "text-muted hover:text-fg")}>{o.label}</button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3", disabled && "opacity-60", className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--primary)]" />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- charts
const EChart = dynamic(() => import("echarts-for-react"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });
export const CHART_COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#64748b"];
export function Chart({ option, height = 260, className }: { option: Record<string, unknown>; height?: number; className?: string }) {
  return <div className={cn("w-full", className)} style={{ height }}><EChart option={{ color: CHART_COLORS, textStyle: { fontFamily: "inherit" }, ...option }} style={{ height: "100%", width: "100%" }} notMerge opts={{ renderer: "svg" }} /></div>;
}

// ---------------------------------------------------------------- misc
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn("space-y-3", className)}><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{action}</div>{children}</section>;
}
/** Responsive grid of KPI tiles: 2 columns on phones, 4 on desktop. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) { return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>; }
