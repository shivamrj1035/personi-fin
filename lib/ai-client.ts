/** Browser helper: AI calls go to this site first; if the server has no Claude CLI (e.g. on Vercel), they go to the local AI bridge. */
export const BRIDGE_URL = process.env.NEXT_PUBLIC_AI_BRIDGE_URL || "http://127.0.0.1:8787";

export async function aiFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (res.status !== 501) return res;
  try { return await fetch(BRIDGE_URL + path, init); } catch { return res; } // bridge not running: surface the server's explanation
}
