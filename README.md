# EL Smart Tracker

A responsive web app (Next.js) that tracks EMIs, loans and borrowings in a Google Sheet and shows how to clear them sooner:
dashboard, loans with prepayment what-ifs, income, expenses, goals, a debt-payoff planner, AI advice and a monthly investing review.

## Stack
- Next.js (App Router) + Tailwind CSS, installable as a PWA
- Google Sheets as the database (service account), same workbook layout as before
- PIN sign-in (salted PBKDF2 hash in `lib/auth.ts`, signed httpOnly session cookie)
- Anthropic API for the AI features

## Run locally
```
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
npm test
```

## Environment variables
| Name | What |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole service-account key JSON (one line, or base64 of it). Share the Sheet (Editor) with its `client_email`. |
| `EL_SHEET_ID` | The Google Sheet id (optional, has a default). |
| `ANTHROPIC_API_KEY` | Key for the AI features. |
| `APP_SECRET` | Long random string that signs the session cookie (required in production): `openssl rand -hex 32` |
| `APP_TZ` | Optional, defaults to `Asia/Kolkata`. |

## Deploy on Vercel
Import the repo, add the variables above, deploy. API routes that talk to the Sheet or the AI run up to 2-5 minutes (`maxDuration`).
Changing the PIN: replace `PIN_HASH` in `lib/auth.ts` (see the comment there for how it is derived).
