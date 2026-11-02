/** Shapes returned by /api/ai and /api/invest (kept in a client-safe file; lib/ai.ts is server-only). */
export interface VisualAnswer {
  headline?: string; bullets?: string[]; actions?: string[]; text?: string;
  charts?: { type: "bar" | "line" | "pie"; title?: string; labels: string[]; series: { name?: string; values: number[] }[] }[];
}
export type { Review } from "./invest-types";
