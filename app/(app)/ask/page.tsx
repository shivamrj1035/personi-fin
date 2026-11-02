"use client";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Answer } from "@/components/answer";
import { Button, Card, Input, PageHeader, Spinner } from "@/components/ui";
import { useData } from "@/lib/app-context";
import type { VisualAnswer } from "@/lib/ai-types";

type Msg = { id: number; who: "me"; text: string } | { id: number; who: "ai"; ans?: VisualAnswer; error?: string };
const QUICK = ["Which loan should I clear first and why?", "Can I afford a prepayment this month?", "What are the biggest risks in my repayment plan?"];

export default function AskPage() {
  const { ai } = useData();
  const [log, setLog] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [waiting, setWaiting] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log]);

  const send = async (text: string) => {
    text = text.trim();
    if (!text || waiting) return;
    const id = ++seq.current;
    setQ(""); setWaiting(true);
    setLog((l) => [...l, { id, who: "me", text }, { id: id + 0.5, who: "ai" }]);
    let upd: Partial<Msg & { who: "ai" }>;
    try { upd = { ans: await ai<VisualAnswer>("/api/ai", { question: text }) }; } catch (e) { upd = { error: (e as Error).message || "Claude could not answer" }; }
    setLog((l) => l.map((m) => (m.id === id + 0.5 ? ({ ...m, ...upd } as Msg) : m)));
    setWaiting(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Ask Claude" subtitle="Answers come as short points and charts. Claude sees your loans, income and payoff comparison - not account numbers." />
      <div className="space-y-3" aria-live="polite">
        {log.length === 0 && (
          <Card className="flex flex-col items-center gap-2 py-8 text-center"><Sparkles className="h-8 w-8 text-primary" /><div className="font-semibold">Ask anything about your loans</div><div className="text-sm text-muted">Try one of the questions below.</div></Card>)}
        {log.map((m) => m.who === "me" ? (
          <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-fg">{m.text}</div></div>
        ) : (
          <Card key={m.id} className="max-w-[900px] rounded-bl-md">
            {m.ans ? <Answer a={m.ans} /> : m.error ? <div className="text-sm text-bad">{m.error}</div> : <div className="flex items-center gap-2 text-sm text-muted"><Spinner />Thinking...</div>}
          </Card>))}
        <div ref={end} />
      </div>

      <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-line bg-card/95 p-3 shadow-card backdrop-blur lg:bottom-4">
        <div className="flex flex-wrap gap-2">
          {QUICK.map((s) => <button key={s} disabled={waiting} onClick={() => void send(s)} className="min-h-9 rounded-full border border-line px-3 py-1.5 text-left text-xs hover:bg-soft disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary">{s}</button>)}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
          <Input aria-label="Your question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Should I prepay the home loan or clear the card EMIs first?" />
          <Button type="submit" disabled={!q.trim() || waiting} loading={waiting} icon={<Send className="h-4 w-4" />} aria-label="Send">Send</Button>
        </form>
      </div>
    </div>
  );
}
