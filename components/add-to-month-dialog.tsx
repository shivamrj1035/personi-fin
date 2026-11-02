"use client";
/** "Add to <month>" (app.py::expense_dialog): a quick expense, or tick EMIs paid / record an extra payment toward a loan. */
import { useMemo, useState } from "react";
import { Button, Checkbox, Dialog, Field, Input, NumberInput, Segmented, Select } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { monthLong } from "@/lib/dates";
import { inr } from "@/lib/format";
import { newId, usePayers } from "@/components/goal-dialogs";
import { EXPENSE_CATEGORIES } from "@/components/expense-edit-dialog";
import { Row, num, truthy } from "@/lib/state";

export function AddToMonthDialog({ open, onClose, mode = "expense" }: { open: boolean; onClose: () => void; mode?: "expense" | "loan" }) {
  return open ? <AddForm onClose={onClose} initial={mode} /> : null;
}

function AddForm({ onClose, initial }: { onClose: () => void; initial: "expense" | "loan" }) {
  const open = true;
  const { state, act, month, mk } = useData();
  const { people, payers } = usePayers();
  const [mode, setMode] = useState<"expense" | "loan">(initial);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("Household");
  const [cat, setCat] = useState("");
  const [amt, setAmt] = useState<number | null>(null);
  const [scope, setScope] = useState<"all" | "one">("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [exLoan, setExLoan] = useState("");
  const [exAmt, setExAmt] = useState<number | null>(null);
  const [exNote, setExNote] = useState("");
  const [payBy, setPayBy] = useState(payers[0]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const unpaid = useMemo(() => state.tabs.MonthItems.filter((i) => i.month === mk && i.kind === "loan" && !truthy(i.paid)), [state, mk]);
  const loanNames = state.activeLoans().map((l) => String(l.name));

  const key = (i: Row) => `${i.tab}|${i.row}`;
  async function save() {
    setErr("");
    if (mode === "expense") {
      if (!name.trim() || !(amt && amt > 0)) return setErr("Fill name and amount");
      setSaving(true);
      await act("append", { tab: "Expenses", row: { name: name.trim(), owner, category: cat, amount: amt, month: scope === "all" ? "" : mk, id: newId(), day: 1, note: "" } }, { msg: "Expense added", busy: "Adding expense..." });
    } else {
      const extra = exAmt ?? 0;
      if (!chosen.length && !(exLoan && extra > 0)) return setErr("Tick an EMI or enter an extra payment");
      setSaving(true);
      if (chosen.length) await act("setItemsPaid", { rows: chosen.map((k) => { const [t, r] = k.split("|"); return [t, Number(r)]; }), paid: true, paidBy: payBy }, { msg: "Payments saved", busy: "Saving payments to your Sheet..." });
      if (exLoan && extra > 0) await act("appendExtra", { month, loanName: exLoan, amount: extra, note: exNote, applied: false, paidBy: payBy }, { msg: "Extra payment recorded", busy: "Saving payment..." });
    }
    setSaving(false); onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Add to ${monthLong(month)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <div className="space-y-3 pb-2">
        <Segmented value={mode} onChange={setMode} options={[{ value: "expense", label: "Expense" }, { value: "loan", label: "Loan / EMI payment" }]} />
        {mode === "expense" ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="What (Rent, Groceries, School fees...)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Whose?"><Select value={owner} onChange={(e) => setOwner(e.target.value)}>{[...people, "Household"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Category (optional)"><Input list="exp-cats" value={cat} onChange={(e) => setCat(e.target.value)} /><datalist id="exp-cats">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Amount"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
            <Segmented value={scope} onChange={setScope} options={[{ value: "all", label: "Every month" }, { value: "one", label: `Only ${monthLong(month)}` }]} />
            <button type="submit" className="hidden" />
          </form>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">Mark this month&apos;s EMIs / payments as paid</div>
              {unpaid.length ? unpaid.map((i) => (
                <Checkbox key={key(i)} checked={chosen.includes(key(i))} onChange={(v) => setChosen((c) => (v ? [...c, key(i)] : c.filter((x) => x !== key(i))))}
                  label={`${i.loan} - ${i.label} (due ${i.due}) - ${inr(num(i.amount))}`} />
              )) : <p className="py-2 text-sm text-good">Everything due this month is already paid.</p>}
            </div>
            <hr className="border-line" />
            <div className="text-sm font-medium">Extra payment toward a loan (reduces what you owe)</div>
            <Field label="Loan"><Select value={exLoan} onChange={(e) => setExLoan(e.target.value)}><option value="">None</option>{loanNames.map((l) => <option key={l}>{l}</option>)}</Select></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Extra amount"><NumberInput value={exAmt} onChange={setExAmt} prefix="₹" /></Field>
              <Field label="Note (optional)"><Input value={exNote} onChange={(e) => setExNote(e.target.value)} /></Field>
            </div>
            <Field label="Paid by"><Select value={payBy} onChange={(e) => setPayBy(e.target.value)}>{payers.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          </div>
        )}
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      </div>
    </Dialog>
  );
}
