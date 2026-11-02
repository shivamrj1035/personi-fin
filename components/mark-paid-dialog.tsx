"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { useData } from "@/lib/app-context";
import { inr } from "@/lib/format";
import { num, type Row } from "@/lib/state";
import { Button, Dialog, Field, NumberInput, Select } from "./ui";

/** "How much did you pay?" for one MonthItems row. Overpaying a loan records the extra so it can be offered for prepayment. */
export function MarkPaidDialog({ item, onClose }: { item: Row | null; onClose: () => void }) {
  return item ? <PaidForm key={`${item.tab}|${item.row}`} item={item} onClose={onClose} /> : null;
}

function PaidForm({ item, onClose }: { item: Row; onClose: () => void }) {
  const { state, act, toast } = useData();
  const [amt, setAmt] = useState<number | null>(num(item.amount));
  const [payer, setPayer] = useState(() => {
    const people = state.persons(), guess = String(item.paid_by || item.owner || "").trim();
    return guess === "Joint" || people.includes(guess) ? guess : people[0] ?? "Joint";
  });
  const due = num(item.amount), a = amt ?? 0, isExp = item.kind === "expense";
  const options = [...state.persons(), "Joint"];
  if (payer && !options.includes(payer)) options.unshift(payer);

  let hint = "Exactly the amount due.", tone = "text-muted";
  if (isExp) hint = Math.abs(a - due) > 0.5 ? "Recorded as the amount actually paid for this month." : "Same as planned.";
  else if (a > due + 0.5) { hint = `${inr(a - due)} more than due - the extra goes toward reducing what you owe on this loan.`; tone = "text-good"; }
  else if (a < due - 0.5) { hint = `${inr(due - a)} less than due - it will still be marked paid.`; tone = "text-warn"; }

  const confirm = async () => {
    if (a <= 0) { toast("Enter the amount you paid", "warn"); return; }
    const over = !isExp && a > due + 0.5;
    const month = String(item.month);
    onClose();
    const ok = await act("setItemPaid", { tab: item.tab, row: item.row, paid: true, paidBy: payer, ...(isExp ? { amount: a } : {}) },
      { msg: "Marked as paid" + (over ? ` - extra ${inr(a - due)} will be offered to apply` : ""), busy: "Saving payment..." });
    if (ok !== undefined && over) {
      await act("appendExtra", { month: `${month}-01`, loanName: item.loan, amount: Math.round((a - due) * 100) / 100, note: `paid more on ${item.label}`, applied: false, paidBy: payer }, { quiet: true });
    }
  };

  return (
    <Dialog open onClose={onClose} title="Mark as paid"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Check className="h-4 w-4" />} onClick={confirm}>Confirm</Button></>}>
      <div className="space-y-4 pb-2">
        <p className="text-sm text-muted">{item.loan} - {item.label} (due {item.due}) - {inr(due)}</p>
        <Field label="How much did you pay?"><NumberInput value={amt} onChange={setAmt} prefix="₹" autoFocus onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }} /></Field>
        <Field label="Paid by"><Select value={payer} onChange={(e) => setPayer(e.target.value)}>{options.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <p className={`text-sm ${tone}`} aria-live="polite">{hint}</p>
      </div>
    </Dialog>
  );
}
