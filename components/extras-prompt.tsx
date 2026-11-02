"use client";
/** Offers extra payments typed into a month tab in the Sheet (app.py::extras_dialog + the logic in reload()). */
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useData } from "@/lib/app-context";
import { inr, monthsLabel } from "@/lib/format";
import { prepaymentEffect } from "@/lib/loans";
import { num, type Row } from "@/lib/state";
import { Button, Card, Dialog } from "./ui";

// Rows already offered in this browser session, so "Not now" is respected until the next visit.
const OFFERED = new Set<string>();
const keyOf = (e: Row) => `${e.tab}|${e.row}`;

export function ExtrasPrompt() {
  const { state, act } = useData();
  const [shown, setShown] = useState<string[]>([]);

  const pending = state.pendingExtras().filter((e) => e.loan_id && state.loans.some((l) => l.id === e.loan_id));
  const pendingKey = pending.map(keyOf).join(",");

  useEffect(() => {
    const fresh = pending.map(keyOf).filter((k) => !OFFERED.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => OFFERED.add(k));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown((s) => [...s, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const visible = pending.filter((e) => shown.includes(keyOf(e)));
  if (!visible.length) return null;
  const keep = state.settings.prepay_mode !== "lower";
  const dismiss = () => setShown([]);

  const apply = async (e: Row) => {
    const loan = state.loans.find((l) => l.id === e.loan_id)!;
    const amount = num(e.amount);
    const extra = { tab: e.tab, row: e.row };
    const hasSchedule = state.schedule(loan.id).length > 0;
    await (hasSchedule
      ? act("applyPrepayment", { loanId: loan.id, amount, keepEmi: keep, extra }, { msg: `Applied ${inr(amount)} to ${loan.name}` })
      : act("applySimpleExtra", { extra }, { msg: `Recorded ${inr(amount)} on ${loan.name}` }));
  };

  return (
    <Dialog open persistent onClose={dismiss} title="Extra payments found in your Sheet"
      footer={<Button variant="outline" onClick={dismiss}>Not now</Button>}>
      <p className="mb-3 text-sm text-muted">Apply them to reduce what you owe? The schedule is rebuilt and the finish date moves closer.</p>
      <ul className="space-y-3 pb-2">
        {visible.map((e) => {
          const loan = state.loans.find((l) => l.id === e.loan_id)!;
          const amount = num(e.amount);
          let benefit = "";
          if (loan.type === "bullet") {
            const [base, withx] = state.bulletEffect(loan, amount);
            benefit = `Principal drops by ${inr(amount)}; saves about ${inr(base - withx)} interest until the due date.`;
          } else if (state.schedule(loan.id).length) {
            const r = prepaymentEffect(state.outstanding(loan), num(loan.rate_pa), num(loan.emi), amount, keep);
            benefit = keep ? `Finish ${monthsLabel(r.months_saved)} sooner, save about ${inr(r.interest_saved)} interest.`
              : `EMI drops to ${inr(r.new_emi ?? 0)}; saves about ${inr(r.interest_saved)} interest.`;
          }
          return (
            <li key={keyOf(e)}>
              <Card className="space-y-2 p-3">
                <div className="font-medium">{inr(amount)} <span className="text-muted">to</span> {loan.name}</div>
                <div className="text-xs text-muted">{e.month}{e.note ? `, ${e.note}` : ""}</div>
                {benefit && <div className="flex items-start gap-1.5 text-sm text-good"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />{benefit}</div>}
                <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => apply(e)} className="w-full sm:w-auto">Apply</Button>
              </Card>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
