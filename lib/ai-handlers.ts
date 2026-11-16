/** The AI endpoints as plain functions, shared by the Next routes and the local AI bridge. */
import "server-only";
import { VisualAnswer, askVisual } from "./ai";
import { advise, Review } from "./invest";
import { Parsed, parseImage } from "./importers";
import { AiUnavailable } from "./llm";
import { State, Tabs } from "./state";

export type HandlerResult = { status: number; body: unknown };

async function guard<T>(fn: () => Promise<T>, ok = 200): Promise<HandlerResult> {
  try { return { status: ok, body: await fn() }; } catch (e) {
    if (e instanceof AiUnavailable) return { status: 501, body: { error: e.message, code: e.code } };
    return { status: 500, body: { error: (e as Error).message } };
  }
}

export const handleAi = (b: { tabs: Tabs; question?: string }) => guard<VisualAnswer>(() => askVisual(new State(b.tabs), b.question || ""));
export const handleInvest = (b: { tabs: Tabs; investable: number; question?: string }) =>
  guard<Review>(() => advise(new State(b.tabs), Number(b.investable) || 0, b.question || ""));
export const handleImage = (data: Buffer, type: string) =>
  guard<{ parsed: Parsed }>(async () => ({ parsed: await parseImage(data, (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type) ? type : "image/png") as "image/png") }));
