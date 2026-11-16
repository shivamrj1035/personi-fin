# EL Smart Tracker

A responsive web app (Next.js) that tracks EMIs, loans and borrowings in a Google Sheet and shows how to clear them sooner:
dashboard, loans with prepayment what-ifs, income, expenses, goals, a debt-payoff planner, AI advice and a monthly investing review.

## Stack
- Next.js (App Router) + Tailwind CSS, installable as a PWA
- Google Sheets as the database (service account), same workbook layout as before
- PIN sign-in (salted PBKDF2 hash in `lib/auth.ts`, signed httpOnly session cookie)
- AI features run through the command-line AI tool installed and logged in on your computer (no API key)
- Activity log with one-click undo for every change

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
| `APP_SECRET` | Long random string that signs the session cookie (required in production): `openssl rand -hex 32` |
| `APP_TZ` | Optional, defaults to `Asia/Kolkata`. |

## AI features
They call the command-line AI tool on the machine that runs them:
- **Running locally** (`npm run dev` / `npm start`): works out of the box if the tool is installed and logged in (set `EL_AI_BIN` if it is not on PATH).
- **Deployed on Vercel**: the server has no such tool, so the site talks to a small bridge on your own computer. Start it with `npm run ai-bridge` and keep it running
  while you use the site (it listens on 127.0.0.1 only and answers just the site's origin, see `BRIDGE_ORIGINS`). Use Chrome, Edge or Firefox on that computer.

## Activity log
Every change (ticking an EMI, adding an expense, applying a prepayment, ...) is written to the `Activity Log` tab with the values it replaced.
The Activity page shows them newest first, each with an Undo button. Undo refuses if the same cells were changed again afterwards.

## Deploy on Vercel
Import the repo, add the variables above, deploy. API routes that talk to the Sheet or the AI run up to 2-5 minutes (`maxDuration`).
Changing the PIN: replace `PIN_HASH` in `lib/auth.ts` (see the comment there for how it is derived).
