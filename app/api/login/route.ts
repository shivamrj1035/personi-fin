import { NextResponse } from "next/server";
import { COOKIE, authConfigured, cookieOptions, makeToken, pinOk } from "@/lib/auth";

// Best-effort brute-force guard (per server instance): 5 wrong PINs lock that address out for 15 minutes.
const fails = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "APP_SECRET is not set on the server." }, { status: 500 });
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const f = fails.get(ip);
  if (f && f.until > Date.now()) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });

  const { pin } = await req.json().catch(() => ({ pin: "" }));
  if (!(await pinOk(String(pin || "")))) {
    const n = (f && f.until <= Date.now() && f.n < 5 ? f.n : f?.n ?? 0) + 1;
    fails.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await makeToken(), cookieOptions);
  return res;
}
