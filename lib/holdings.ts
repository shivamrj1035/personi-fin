import { Row, State, num } from "./state";

/** Holdings with typed numbers and cost value; `row` is the sheet row for edit/delete. Pure: usable in the browser. */
export function holdingsRows(state: State): Row[] {
  return state.tabs.Holdings.map((h) => { const qty = num(h.qty), avg = num(h.avg_price);
    return { ...h, qty, avg_price: avg, cost: qty * avg, target_price: num(h.target_price) || null, stop_loss: num(h.stop_loss) || null }; });
}
