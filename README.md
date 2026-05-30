# Flipkart Grocery Price Tracker

A personal tool that monitors prices of specific Flipkart Grocery products and alerts you via Telegram when a price hits a local minimum (best time to buy).

## Current Status

| Feature | Status |
|---------|--------|
| Price fetching (single product) | ✅ Working |
| Telegram bot (send link → track) | ✅ Working |
| Price storage (SQLite) | ✅ Working |
| Minima detection | ✅ Working (9/9 tests) |
| Telegram alerts | ✅ Working |
| Search by product name | ✅ Working |

## How It Works

1. Type a product name (e.g. "amul milk") in the Telegram bot
2. Bot searches Flipkart and shows matching products with prices
3. Reply with a number to start tracking that product
4. Every 15 minutes, it polls all tracked products
5. When a price drops significantly (5%+ from recent high), you get a Telegram alert

You can also paste a Flipkart product URL directly to start tracking.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Telegram Bot                     │
│  Send link → track, /list, /status, /remove  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Price Store (SQLite)             │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Polling Loop (every 15 min)        │
│  fetch → store → detect minima → alert      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              API Fetcher                      │
│  Flipkart rome API + auto cookie refresh     │
└─────────────────────────────────────────────┘
```

## Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
cd flipkart-price-tracker
npm install
npx playwright install chromium
```

### Configuration

Create a `.env` file:
```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

Edit `config.json` to set your pincode and detection parameters.

### Running

```bash
npm run dev
```

### Bot Commands

- **Type a product name** (e.g. "amul milk") → searches and shows results
- **Reply with a number** → starts tracking that product
- **Send a Flipkart URL** → starts tracking that product directly
- `/search <query>` → explicit search command
- `/list` → shows all tracked products with prices
- `/status` → shows current prices with trend arrows
- `/remove <id>` → stops tracking a product
- `/help` → shows available commands

## Tech Stack

- **TypeScript** / Node.js 18+
- **sql.js** — SQLite compiled to WASM (no native build tools needed)
- **Playwright** — headless browser for cookie refresh
- **Telegram Bot API** — native fetch, no library needed
- **Jest** — testing

## Project Structure

```
├── src/
│   ├── index.ts        # Entry point (bot + polling loop)
│   ├── bot.ts          # Telegram bot interface
│   ├── searcher.ts     # Product search (HTML fetch + parse)
│   ├── fetcher.ts      # API fetcher + Playwright fallback
│   ├── store.ts        # SQLite storage layer
│   ├── detector.ts     # Minima detection algorithm
│   └── types.ts        # TypeScript interfaces
├── tests/
│   └── detector.test.ts
├── config.json         # Runtime configuration
├── .env                # Secrets (not committed)
├── PROGRESS.md         # Detailed session log
└── package.json
```

## Development Notes

See `PROGRESS.md` for detailed session logs, API discoveries, and next steps.
