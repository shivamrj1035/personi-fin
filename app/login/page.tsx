"use client";
import { useRef, useState } from "react";
import { Delete, TrendingDown } from "lucide-react";
import { Card, cn } from "@/components/ui";

export default function Login() {
  const [pin, setPin] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const submit = async (p: string) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setErr("");
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: p }) });
    if (res.ok) { window.location.assign("/"); return; }
    setErr((await res.json().catch(() => ({}))).error || "Could not sign in");
    setPin(""); setBusy(false); sending.current = false;
  };
  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next); setErr("");
    if (next.length === 4) void submit(next);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <main className="grid min-h-dvh place-items-center px-4" onKeyDown={(e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") setPin((p) => p.slice(0, -1)); }} tabIndex={-1}>
      <Card className="w-full max-w-xs space-y-6 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-fg"><TrendingDown className="h-6 w-6" /></div>
          <h1 className="text-xl font-bold">EL Smart Tracker</h1><p className="text-sm text-muted">Enter your PIN</p>
        </div>
        <div className="flex justify-center gap-3" aria-live="polite" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-3.5 w-3.5 rounded-full border-2 transition", i < pin.length ? "border-primary bg-primary" : "border-line", err && "border-bad bg-bad")} />)}
        </div>
        <p className={cn("h-4 text-center text-xs text-bad", !err && "invisible")} role="alert">{err || "."}</p>
        <div className="grid grid-cols-3 gap-3">
          {keys.map((k, i) => k === "" ? <span key={i} /> : (
            <button key={i} disabled={busy} aria-label={k === "del" ? "Delete" : k} onClick={() => (k === "del" ? setPin((p) => p.slice(0, -1)) : press(k))}
              className="grid h-14 place-items-center rounded-2xl border border-line bg-card text-xl font-semibold transition active:scale-95 hover:bg-soft disabled:opacity-50">
              {k === "del" ? <Delete className="h-5 w-5 text-muted" /> : k}</button>))}
        </div>
      </Card>
    </main>
  );
}
