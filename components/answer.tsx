"use client";
import { Bolt, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useData } from "@/lib/app-context";
import type { VisualAnswer } from "@/lib/ai-types";
import { Badge, Button, Card, Chart, Dialog, Spinner } from "./ui";

type ChartSpec = NonNullable<VisualAnswer["charts"]>[number];

/** Turns one chart spec from the AI into an echarts option; null when it is unusable. */
function chartOption(c: ChartSpec): Record<string, unknown> | null {
  const labels = (c.labels ?? []).map(String);
  const series = c.series ?? [];
  if (!labels.length || !series.length) return null;
  if (c.type === "pie") {
    const vals = series[0].values ?? [];
    return { tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 },
      series: [{ type: "pie", radius: ["40%", "66%"], center: ["50%", "44%"], label: { formatter: "{b}" }, data: labels.map((n, i) => ({ name: n, value: vals[i] ?? 0 })) }] };
  }
  const kind = c.type === "line" ? "line" : "bar";
  return { tooltip: { trigger: "axis" }, legend: series.length > 1 ? { top: 0 } : { show: false },
    grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: labels, axisLabel: { interval: 0, rotate: labels.length > 4 ? 30 : 0 } }, yAxis: { type: "value" },
    series: series.map((s) => ({ name: s.name ?? "", type: kind, smooth: kind === "line", data: s.values ?? [] })) };
}

/** the AI's structured answer: headline, short bullets, up to two charts, next-step chips. */
export function Answer({ a }: { a: VisualAnswer }) {
  if (a.text && !a.headline && !a.bullets?.length) return <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.text}</p>;
  const charts = (a.charts ?? []).slice(0, 2).map((c) => ({ c, opt: chartOption(c) })).filter((x) => x.opt);
  return (
    <div className="space-y-3">
      {a.headline && <h3 className="text-lg font-semibold leading-snug">{a.headline}</h3>}
      {!!a.bullets?.length && (
        <ul className="space-y-1.5">
          {a.bullets.map((b, i) => <li key={i} className="flex items-start gap-2 text-sm"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{String(b)}</li>)}
        </ul>
      )}
      {charts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {charts.map(({ c, opt }, i) => (
            <Card key={i} className="p-3 shadow-none">
              {c.title && <div className="mb-1 text-sm font-medium">{c.title}</div>}
              <Chart option={opt!} height={240} />
            </Card>
          ))}
        </div>
      )}
      {!!a.actions?.length && (
        <div className="flex flex-wrap gap-2" aria-label="Next steps">
          {a.actions.map((x, i) => <Badge key={i} tone="indigo" className="whitespace-normal py-1"><Bolt className="h-3 w-3 shrink-0" />{String(x)}</Badge>)}
        </div>
      )}
    </div>
  );
}

/** Asks the AI (default: this month's plan) and shows the answer in a dialog. */
export function ClaudeDialog({ open, onClose, question, title = "This month's plan from Claude" }: { open: boolean; onClose: () => void; question?: string; title?: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />{title}</span>} wide
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <ClaudeBody question={question} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening asks afresh. */
function ClaudeBody({ question }: { question?: string }) {
  const { ai } = useData();
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<{ attempt: number; ans?: VisualAnswer; err?: string } | null>(null);
  useEffect(() => {
    let live = true;
    ai<VisualAnswer>("/api/ai", { question: question ?? "" })
      .then((ans) => { if (live) setRes({ attempt, ans }); })
      .catch((e: Error) => { if (live) setRes({ attempt, err: e.message || "Claude could not answer" }); });
    return () => { live = false; };
  }, [ai, question, attempt]);
  const done = res?.attempt === attempt ? res : null;
  return (
    <div className="min-h-24 pb-2" aria-live="polite">
      {done?.err ? (
        <div className="space-y-3 rounded-xl bg-bad-soft p-4 text-sm text-bad"><div>{done.err}</div><Button size="sm" variant="outline" onClick={() => setAttempt((t) => t + 1)}>Try again</Button></div>
      ) : done?.ans ? <Answer a={done.ans} /> : (
        <div className="flex items-center gap-3 py-6 text-muted"><Spinner />Claude is working it out...</div>
      )}
    </div>
  );
}
