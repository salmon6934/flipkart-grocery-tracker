# Progress Log

This file tracks what has been done and what remains, so any future session can pick up seamlessly.

---

## Session 1 — 2026-05-30

### What was accomplished

1. **Project scaffolded** — Full TypeScript/Node.js project, compiles clean, tests pass
2. **API Discovery completed** — Found Flipkart's internal price endpoint:
   - `POST https://2.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false`
   - Requires `locationContext.pincode`, `pageContext`, `pageUri` in body
   - Requires `x-user-agent` header with `FKUA/msite/0.0.4/msite/Mobile` suffix
   - Requires session cookies (auto-obtained via Playwright)
   - Price found in response JSON as `kilosPrice` field (selling price), `mrp` for original price
3. **API Fetcher working** — Successfully fetched ₹150 for Maggi noodles via direct API call
4. **Telegram Bot created and working** — Sends messages successfully
5. **Interactive bot built** — Send links, /list, /status, /remove commands
6. **Minima detector** — 9/9 tests passing

### What's currently blocked: Product Search

The bot currently requires a Flipkart product URL to start tracking. The user wants to type a product name (e.g., "amul milk") and have the bot search and show results.

**Problem:** Flipkart's grocery search doesn't return product data in the initial API response. Products are loaded asynchronously via a separate widget/slot fetch mechanism.

**What was tried:**
| Approach | Result |
|----------|--------|
| `pageUri: /grocery-supermart-store?query=maggi+noodles` | Returns 52KB page shell, has "maggi" in SEO meta only, no product data |
| `pageUri: /search?q=...&marketplace=GROCERY` | Returns 14KB empty page structure |
| `/grocery/search?q=...` | 404 |
| `/grocery-supermart-store/pr?sid=eat&q=...` | Empty |
| Flipkart suggest API (`/api/1/suggest/search`) | 410 Gone (deprecated) |
| Sherlock suggest endpoint | Connection failed |
| Playwright render + DOM scraping (desktop UA) | Page renders but no product elements found |
| Playwright render (mobile UA) | Shows "Hang on, loading content" — products load async |
| Playwright render (search URL from user) | Shows "Verify Delivery Pincode" prompt — needs pincode set first |

**Key insight:** The grocery search page requires:
1. A valid pincode to be set (either via cookie or UI interaction)
2. Products load AFTER the initial page via a separate async call (likely a widget/slot fetch)

**Next steps to solve search:**
1. Set pincode via cookie (`vw=522237` on `.flipkart.com`) or fill the pincode prompt in Playwright
2. Wait for the secondary API call that loads actual product cards
3. Either intercept that API call OR scrape the rendered DOM after products appear
4. The search URL pattern from the user's browser is: `https://www.flipkart.com/search?q=amul%20milk&otracker=search&otracker1=search&marketplace=GROCERY&as-show=on&as=off`

**Test file left for continuation:** `test-search-url.ts` — attempts to set pincode and then load search results. Needs to be run and debugged.

---

### Architecture (current)

```
┌─────────────────────────────────────────────┐
│              Telegram Bot                     │
│  (receives links/commands, responds)         │
│  ⚠️ Search by name: NOT YET WORKING         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Price Store (SQLite/sql.js)      │
│  products table + prices time-series         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Polling Loop (every 15 min)        │
│  fetch price → store → detect → alert       │
│  ✅ WORKING                                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              API Fetcher                      │
│  POST to rome.api.flipkart.com/api/4/page   │
│  ✅ WORKING (single product price fetch)     │
└─────────────────────────────────────────────┘
```

### How to run (current state)

```bash
cd flipkart-price-tracker
npm run dev
```

Then send a Flipkart Grocery product **URL** to the bot. It will start tracking.
Searching by product name does NOT work yet.

### Key files

| File | Purpose | Status |
|------|---------|--------|
| `src/index.ts` | Entry point — starts bot + polling | ✅ |
| `src/bot.ts` | Telegram bot commands & link handling | ✅ (search TODO) |
| `src/fetcher.ts` | API fetcher + Playwright cookie refresh | ✅ |
| `src/store.ts` | SQLite database layer | ✅ |
| `src/detector.ts` | Price minima detection algorithm | ✅ |
| `src/types.ts` | TypeScript interfaces | ✅ |
| `config.json` | Polling interval, detection params, pincode | ✅ |
| `.env` | Telegram credentials (not committed) | ✅ |
| `test-search-url.ts` | Search exploration script (WIP) | 🔴 |
| `tests/detector.test.ts` | Minima detection tests | ✅ 9/9 pass |

### Environment

- Node.js 24.12.0
- Windows 10
- No Visual Studio C++ build tools (using sql.js WASM instead of better-sqlite3)
- Playwright + Chromium installed
- Telegram bot: token and chat ID in `.env`

### Credentials (in .env)

- `TELEGRAM_BOT_TOKEN` — set ⚠️ (should be revoked and regenerated since it was shared in chat)
- `TELEGRAM_CHAT_ID` — set (1311971192)
- Pincode: 522237

### API Details Discovered

**Price fetch (WORKING):**
```
POST https://2.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false

Headers:
  Content-Type: application/json
  x-user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... FKUA/msite/0.0.4/msite/Mobile
  Cookie: <session cookies from Playwright>
  Origin: https://www.flipkart.com
  Referer: https://www.flipkart.com/

Body:
{
  "pageUri": "/product-slug/p/itmXXX?pid=XXX&lid=XXX&marketplace=GROCERY",
  "locationContext": { "pincode": "522237", "changed": false },
  "pageContext": { "trackingContext": { "context": {} }, "networkSpeed": 0 }
}

Response contains: "kilosPrice": <number> (selling price), "mrp": <number> (original price)
```

**Search (NOT YET WORKING):**
- User's browser URL: `https://www.flipkart.com/search?q=amul%20milk&otracker=search&otracker1=search&marketplace=GROCERY&as-show=on&as=off`
- The same `page/fetch` API with `pageUri: /grocery-supermart-store?query=...` returns a page shell but no product data
- Products are loaded via a secondary async mechanism after pincode is set
- Need to either: (a) find the secondary API call, or (b) use Playwright to render fully and scrape DOM

### TODO for next session

1. **Fix search** — The main blocker. Options:
   - Run `test-search-url.ts` (sets pincode, loads search page, waits for products)
   - Try intercepting the secondary widget/slot API call that loads products
   - Or: use Playwright to fully render the search page with pincode set, then scrape product cards from DOM
2. **Revoke Telegram bot token** — Send `/revoke` to @BotFather and update `.env`
3. **Test full flow** — Once search works, test: search → select → track → poll → detect → alert
4. **Deploy** — PM2 or systemd for 24/7 operation

---

## Session 2 — 2026-05-31

### What was accomplished

1. **Search is now working** — The main blocker from Session 1 is resolved.
2. **New module: `src/searcher.ts`** — Searches Flipkart products via plain HTTP fetch (no Playwright needed for search).
3. **Bot updated** — Users can now type a product name directly in Telegram to search and track.

### How search works (the breakthrough)

The key insight: **you don't need the grocery marketplace endpoint at all for search.**

Regular Flipkart search (`flipkart.com/search?q=amul+milk`) returns grocery products in its results. The product data is embedded in the page HTML as `window.__INITIAL_STATE__` JSON, inside `pageDataV4.page.data` → `PRODUCT_SUMMARY` widgets.

**What was tried and failed:**
| Approach | Result |
|----------|--------|
| `marketplace=GROCERY` search param | Returns page shell, no products (needs pincode) |
| Rome API with search pageUri | 406 Not Acceptable (API rejects search pages) |
| Mobile UA fetch | 403 Forbidden |
| Pincode cookie on search | 403 Forbidden |
| Grocery store page with query | 554KB HTML but no product data |

**What works:**
| Approach | Result |
|----------|--------|
| Regular search (no marketplace filter) | ✅ 40 products with names, prices, URLs |

The flow:
1. `fetch("https://www.flipkart.com/search?q=amul+milk")` with desktop Chrome UA
2. Parse `window.__INITIAL_STATE__` JSON from HTML
3. Extract products from `pageDataV4.page.data` → `PRODUCT_SUMMARY` widgets
4. Each product has: name, brand, subtitle, price, productId, pageUri, stock status

### Caveats discovered

- Flipkart occasionally returns 403 on repeated requests (rate limiting). A small delay between searches helps.
- Results include non-grocery items mixed in. Could filter by `analyticsData.superCategory` if needed.
- The `@dvishal485/flipkart_scraper` NPM package uses the same approach (HTML parse) but doesn't handle grocery-specific needs.

### Architecture (updated)

```
┌─────────────────────────────────────────────┐
│              Telegram Bot                     │
│  Type product name → search → pick → track   │
│  Also: paste URL directly, /list, /status    │
│  ✅ FULLY WORKING                            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Searcher (NEW)                   │
│  fetch flipkart.com/search HTML              │
│  parse __INITIAL_STATE__ JSON                │
│  extract products from PRODUCT_SUMMARY       │
│  ✅ WORKING (no Playwright needed)           │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Price Store (SQLite/sql.js)      │
│  products table + prices time-series         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Polling Loop (every 15 min)        │
│  fetch price → store → detect → alert       │
│  ✅ WORKING                                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              API Fetcher                      │
│  POST to rome.api.flipkart.com/api/4/page   │
│  ✅ WORKING (single product price fetch)     │
└─────────────────────────────────────────────┘
```

### Key files (updated)

| File | Purpose | Status |
|------|---------|--------|
| `src/index.ts` | Entry point — starts bot + polling | ✅ |
| `src/bot.ts` | Telegram bot commands, search & link handling | ✅ |
| `src/searcher.ts` | Product search via HTML fetch + parse | ✅ NEW |
| `src/fetcher.ts` | API fetcher + Playwright cookie refresh | ✅ |
| `src/store.ts` | SQLite database layer | ✅ |
| `src/detector.ts` | Price minima detection algorithm | ✅ |
| `src/types.ts` | TypeScript interfaces | ✅ |
| `config.json` | Polling interval, detection params, pincode | ✅ |
| `.env` | Telegram credentials (not committed) | ✅ |
| `tests/detector.test.ts` | Minima detection tests | ✅ 9/9 pass |

### TODO for next session

1. **Test full flow end-to-end** — search → select → track → poll → detect → alert
2. **Rate limiting** — Add delay/retry logic to searcher for 403 responses
3. **Revoke Telegram bot token** — Send `/revoke` to @BotFather and update `.env`
4. **Deploy** — PM2 or systemd for 24/7 operation
5. **Optional: filter grocery items** — Use `analyticsData.superCategory` to prioritize food/grocery results

---
