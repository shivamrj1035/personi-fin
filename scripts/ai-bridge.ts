/**
 * Local AI bridge: lets the deployed site use the Claude CLI that is logged in on THIS computer.
 *   npm run ai-bridge          (keep it running while you use the site)
 * Listens on 127.0.0.1 only and answers just the origins in BRIDGE_ORIGINS.
 */
import http from "node:http";
import { handleAi, handleImage, handleInvest } from "../lib/ai-handlers";
import { findCli } from "../lib/llm";

const PORT = Number(process.env.BRIDGE_PORT || 8787);
const ORIGINS = (process.env.BRIDGE_ORIGINS || "https://personi-fin.vercel.app,http://localhost:3000").split(",").map((s) => s.trim());

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  const allowed = ORIGINS.includes(origin);
  const cors: Record<string, string> = allowed ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-private-network": "true", vary: "Origin" } : {};
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(body)); };

  if (!allowed && origin) return send(403, { error: "Origin not allowed" });
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/health") return send(200, { ok: true, cli: !!findCli() });
  if (req.method !== "POST") return send(404, { error: "Not found" });

  try {
    const r = path === "/api/import/image"
      ? await (async () => {
          const f = (await new Request("http://x/", { method: "POST", headers: req.headers as HeadersInit, body: req as never, duplex: "half" } as RequestInit).formData()).get("file");
          if (!(f instanceof File)) return { status: 400, body: { error: "No file" } };
          return handleImage(Buffer.from(await f.arrayBuffer()), f.type);
        })()
      : await (async () => {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (path === "/api/ai") return handleAi(body);
          if (path === "/api/invest") return handleInvest(body);
          return { status: 404, body: { error: "Not found" } };
        })();
    send(r.status, r.body);
  } catch (e) { send(500, { error: (e as Error).message }); }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI bridge on http://127.0.0.1:${PORT}  (CLI: ${findCli() ?? "NOT FOUND - install it or set EL_AI_BIN"})`);
  console.log(`Allowed origins: ${ORIGINS.join(", ")}`);
});
