# Waga Maga — HARTI Backend (Step 1)

This is the first backend layer for Waga Maga. It keeps the old HTML app separate and exposes a small API for HARTI market-price records.

## What it provides
- `GET /api/health`
- `GET /api/markets`
- `GET /api/prices?crop=Chili&market=Dambulla&from=2026-01-01&to=2026-12-31`
- `POST /api/sync` — attempts to discover the newest HARTI Daily Food Commodities Bulletin and extract conservative price rows.
- SQLite database: `waga_maga_prices.db`

## Run
1. Install Node.js 20+.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Run `npm start`.
5. Test `http://localhost:8787/api/health`.
6. Run `POST http://localhost:8787/api/sync`.

## Important
HARTI officially publishes daily bulletins. The exact PDF table structure has not been reliably exposed by the public page fetch used during development, so the parser is deliberately conservative and fails closed instead of inventing prices. The parser must be validated against an actual HARTI bulletin before it is treated as production-grade live data.

Source: https://www.harti.gov.lk/daily-price.php
