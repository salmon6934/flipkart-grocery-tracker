/**
 * Main entry point — runs two things in parallel:
 *
 * 1. Telegram bot listener — accepts product links, responds to commands
 * 2. Price polling loop — fetches prices on interval, detects minima, sends alerts
 */

import "dotenv/config";
import http from "http";
import { Config } from "./types";
import { PriceStore } from "./store";
import { APIFetcher, IFetcher } from "./fetcher";
import { detectMinima } from "./detector";
import { TelegramBot } from "./bot";
import fs from "fs";
import path from "path";

function loadConfig(): Config {
  const configPath = path.resolve(__dirname, "../config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as Config;
}

async function pollAllProducts(
  store: PriceStore,
  fetcher: IFetcher,
  bot: TelegramBot,
  config: Config
): Promise<void> {
  const products = store.getAllProducts();

  if (products.length === 0) {
    console.log(`[${new Date().toISOString()}] No products to poll.`);
    return;
  }

  console.log(`\n[${new Date().toISOString()}] Polling ${products.length} product(s)...`);

  for (const product of products) {
    try {
      const result = await fetcher.fetchPrice(product);

      if (!result.success) {
        console.error(`  ❌ ${product.name}: ${result.error}`);
        continue;
      }

      console.log(`  ✅ ${product.name}: ₹${result.price}`);
      store.recordPrice(product.id, result.price, result.currency);

      // Run minima detection
      const recentPrices = store.getRecentPrices(product.id, config.detection.windowSize + 2);
      const alert = detectMinima(product.id, product.name, recentPrices, config.detection);

      if (alert) {
        const msg =
          `📉 Price Drop Alert!\n\n` +
          `📦 ${alert.productName}\n` +
          `💰 Current: ₹${alert.currentPrice}\n` +
          `📈 Recent high: ₹${alert.recentHigh}\n` +
          `⬇️ Drop: ${alert.dropPercent}%\n\n` +
          `Now might be a good time to buy!`;

        await bot.sendMessage(msg);
        console.log(`  🔔 ALERT sent for ${product.name}`);
      }
    } catch (err: any) {
      console.error(`  ❌ ${product.name}: ${err.message}`);
    }

    // Delay between products to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main(): Promise<void> {
  console.log("🛒 Flipkart Grocery Price Tracker");
  console.log("==================================\n");

  // Load config
  const config = loadConfig();

  // Validate Telegram credentials
  const botToken = process.env[config.telegram.botTokenEnv];
  const chatId = process.env[config.telegram.chatIdEnv];

  if (!botToken || !chatId) {
    console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment.");
    console.error("   Set them in .env file and restart.");
    process.exit(1);
  }

  console.log(`Polling interval: ${config.pollingIntervalMinutes} minutes`);
  console.log(`Detection window: ${config.detection.windowSize} readings`);
  console.log(`Alert threshold: ${config.detection.thresholdPercent}% drop\n`);

  // Initialize components
  const store = new PriceStore(config.database.path);
  await store.init();

  const fetcher: IFetcher = new APIFetcher();
  const bot = new TelegramBot(botToken, chatId, store, fetcher);

  // Start the Telegram bot listener
  bot.startListening();

  // Run first poll immediately
  await pollAllProducts(store, fetcher, bot, config);

  // Schedule subsequent polls
  const intervalMs = config.pollingIntervalMinutes * 60 * 1000;
  const timer = setInterval(
    () => pollAllProducts(store, fetcher, bot, config),
    intervalMs
  );

  console.log(`\n⏰ Polling every ${config.pollingIntervalMinutes} minutes.`);
  console.log(`💬 Send a Flipkart link to the bot to start tracking.`);
  console.log(`   Press Ctrl+C to stop.\n`);

  // Start a simple HTTP server to keep Render happy
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    const products = store.getAllProducts();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "running",
      uptime: process.uptime(),
      tracking: products.length,
    }));
  });

  server.listen(PORT, () => {
    console.log(`🌐 Health server listening on port ${PORT}`);
  });

  // Self-ping every 13 minutes to prevent Render from spinning down
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    setInterval(() => {
      fetch(RENDER_URL).catch(() => {});
    }, 13 * 60 * 1000);
    console.log(`🏓 Self-ping enabled: ${RENDER_URL}`);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down...");
    clearInterval(timer);
    bot.stopListening();
    server.close();
    await fetcher.close();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
