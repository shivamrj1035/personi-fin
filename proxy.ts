import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, authConfigured, verifyToken } from "@/lib/auth";

/** Everything except the login page and its API needs a valid session cookie. */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (authConfigured() && (await verifyToken(req.cookies.get(COOKIE)?.value))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.*|.*\\.(?:png|svg|jpg|ico|webp)$).*)"] };
