/** the finance page: monthly buy / hold / sell suggestions. Decision support, not licensed investment advice. */
import "server-only";
import { MODEL, anthropic, parseJsonObject } from "./ai";
import { fmtDate, monthLong, today } from "./dates";
import { holdingsRows } from "./holdings";
import { State, num } from "./state";

export const RISKS = ["conservative", "moderate", "aggressive"] as const;

const SYSTEM = (d: string) =>
  `You are a careful, practical Indian-market investing coach for a salaried household (amounts in INR, ₹; NSE/BSE stocks, ETFs and mutual funds). Today is ${d}. ` +
  "Use web search to check CURRENT prices, recent results/news and the broad market (Nifty 50 / Sensex trend) before answering; if you cannot verify a price, say so rather than guess. " +
  "Respect the user's FACTS: only suggest buying with money listed as investable (never more), keep the emergency buffer untouched, and weigh that the household also pays loan interest " +
  "(a loan costing more than ~10-12% p.a. usually beats market returns, so say so when relevant). Prefer diversified, liquid, large/mid-cap names or index funds over speculation; " +
  "avoid penny stocks, F&O and tips. Every holding must get a clear action with a concrete trigger (price level or event) for when to sell or add. " +
  "Be honest about uncertainty; no guaranteed-return language.";

const SHAPE =
  "Reply with ONLY one JSON object, no prose, no markdown fences: " +
  '{"market_view": str (max 30 words), "mood": "bullish"|"neutral"|"cautious", ' +
  '"buy": [{"symbol": str, "name": str, "why": str (max 25 words), "entry_range": str, "target": str, "stop_loss": str, "amount": number (rupees, total of all buys <= investable), "horizon": str}] (0-4 items), ' +
  '"holdings": [{"symbol": str, "action": "HOLD"|"ADD"|"TRIM"|"SELL", "why": str (max 25 words), "sell_or_add_trigger": str (max 20 words), "price_checked": number|null}] (one per holding, same order), ' +
  '"risks": [str] (max 3, max 15 words each), "this_month_plan": [str] (2-4 short steps)}. No other keys. Plain text inside strings.';

export interface Review {
  market_view?: string; mood?: string; text?: string; risks?: string[]; this_month_plan?: string[];
  buy?: { symbol: string; name: string; why: string; entry_range: string; target: string; stop_loss: string; amount: number; horizon: string }[];
  holdings?: { symbol: string; action: string; why: string; sell_or_add_trigger: string; price_checked: number | null }[];
}

export function buildInvestContext(state: State, investable: number) {
  const hs = holdingsRows(state);
  const total = hs.reduce((s, h) => s + h.cost, 0) || 1;
  return {
    investable_this_month: Math.round(Math.max(investable, 0)), emergency_buffer: Math.round(num(state.settings.emergency_buffer)),
    risk_profile: state.settings.risk_profile || "moderate", horizon: state.settings.invest_horizon || "3-5 years",
    holdings: hs.map((h) => ({ symbol: h.symbol, name: h.name, qty: h.qty, avg_buy_price: h.avg_price, cost_value: Math.round(h.cost),
      weight_pct: Math.round((h.cost / total) * 1000) / 10, bought: String(h.buy_date) || null, my_target: h.target_price, my_stop_loss: h.stop_loss, note: h.note || null })),
    loans_cost: state.activeLoans().map((r) => ({ name: r.name, rate_pa: num(r.rate_pa), outstanding: Math.round(state.outstanding(r)) })),
  };
}

export async function advise(state: State, investable: number, question = ""): Promise<Review> {
  const facts = JSON.stringify(buildInvestContext(state, investable));
  const ask = question.trim() || `Review my holdings for ${monthLong(today())}: what (if anything) to buy now with the investable amount, and for each holding whether to hold, add, trim or sell and at what trigger.`;
  const messages: Parameters<ReturnType<typeof anthropic>["messages"]["create"]>[0]["messages"] = [
    { role: "user", content: `${SHAPE}\n\nFACTS (JSON):\n${facts}\n\nQUESTION:\n${ask}` }];
  let text = "";
  for (let i = 0; i < 4; i++) { // server-side web search may pause long turns; resume them
    const msg = await anthropic().messages.create({
      model: MODEL, max_tokens: 4000, system: SYSTEM(fmtDate(today())), messages,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    });
    text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return parseJsonObject<Review>(text, (d) => "buy" in d || "holdings" in d) ?? { text };
}
