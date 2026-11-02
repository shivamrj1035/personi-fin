/** PIN sign-in with a signed, httpOnly session cookie. Web Crypto only, so it runs in the proxy and in route handlers. */
export const COOKIE = "el_session";
const MAX_AGE = 60 * 60 * 24 * 30;

// The PIN is never stored, only its salted PBKDF2-SHA256 hash.
// To change it: node -e 'console.log(require("crypto").pbkdf2Sync("NEWPIN","el-smart-tracker/pin/v1",150000,32,"sha256").toString("hex"))'
const PIN_SALT = "el-smart-tracker/pin/v1";
const PIN_ITERATIONS = 150_000;
const PIN_HASH = "7a0f67ca7c014c6af4565c0d8277601e8938d0510366cc53f807ab1fc9ca560a";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Secret that signs the session cookie. Required in production so cookies cannot be forged from the source code. */
const secret = () => process.env.APP_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-only-secret");
export const authConfigured = () => !!secret();

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function pinOk(pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(PIN_SALT), iterations: PIN_ITERATIONS }, key, 256);
  return same(hex(bits), PIN_HASH);
}

export async function makeToken(): Promise<string> {
  const exp = Date.now() + MAX_AGE * 1000;
  return `${exp}.${await sign(String(exp))}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token || !authConfigured()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(await sign(exp), sig);
}

export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: MAX_AGE };
