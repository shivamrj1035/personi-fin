"use client";
/** Add / edit a holding (app.py::holding_dialog). */
import { useState } from "react";
import { Button, Dialog, Field, Input, NumberInput } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { newId } from "@/components/goal-dialogs";
import type { Row } from "@/lib/state";

export function HoldingDialog({ open, onClose, holding }: { open: boolean; onClose: () => void; holding: Row | null }) {
  return open ? <HoldingForm onClose={onClose} holding={holding} /> : null;
}

function HoldingForm({ onClose, holding }: { onClose: () => void; holding: Row | null }) {
  const open = true;
  const h = holding;
  const { act } = useData();
  const [sym, setSym] = useState(h?.symbol ?? "");
  const [name, setName] = useState(h?.name ?? "");
  const [qty, setQty] = useState<number | null>(h ? h.qty : null);
  const [avg, setAvg] = useState<number | null>(h ? h.avg_price : null);
  const [tgt, setTgt] = useState<number | null>(h?.target_price || null);
  const [stop, setStop] = useState<number | null>(h?.stop_loss || null);
  const [bought, setBought] = useState(h ? String(h.buy_date ?? "") : "");
  const [note, setNote] = useState(h?.note ?? "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!sym.trim() || !(qty && qty > 0) || !(avg && avg > 0)) return setErr("Fill symbol, quantity and average price");
    setErr(""); setSaving(true);
    const vals = { symbol: sym.trim().toUpperCase(), name, qty, avg_price: avg, buy_date: bought, target_price: tgt || "", stop_loss: stop || "", note,
      id: holding && String(holding.id ?? "").trim() ? String(holding.id) : newId() };
    if (holding) await act("updateFlat", { tab: "Holdings", row: Number(holding.row), vals }, { msg: "Holding updated", busy: "Saving holding..." });
    else await act("append", { tab: "Holdings", row: vals }, { msg: "Holding added", busy: "Adding holding..." });
    setSaving(false); onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={holding ? "Edit holding" : "Add holding"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Symbol (e.g. RELIANCE, TCS, NIFTYBEES)"><Input value={sym} onChange={(e) => setSym(e.target.value)} autoCapitalize="characters" /></Field>
        <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Quantity / units"><NumberInput value={qty} onChange={setQty} /></Field>
          <Field label="Average buy price"><NumberInput value={avg} onChange={setAvg} prefix="₹" /></Field>
          <Field label="Your target price (optional)"><NumberInput value={tgt} onChange={setTgt} prefix="₹" /></Field>
          <Field label="Your stop-loss (optional)"><NumberInput value={stop} onChange={setStop} prefix="₹" /></Field>
        </div>
        <Field label="Bought on (optional, e.g. 2026-03)"><Input value={bought} onChange={(e) => setBought(e.target.value)} /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
