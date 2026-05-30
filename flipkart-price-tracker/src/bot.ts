/**
 * Telegram bot interface.
 *
 * Users interact with the tracker by sending messages to this bot:
 * - Send a Flipkart product URL → starts tracking it
 * - /list → shows all tracked products
 * - /remove <id> → stops tracking a product
 * - /status → shows current prices of all tracked products
 * - /help → shows available commands
 *
 * The bot also sends price drop alerts proactively.
 */

import { PriceStore } from "./store";
import { APIFetcher, IFetcher } from "./fetcher";
import { Product } from "./types";
import { searchProducts, SearchResult } from "./searcher";

const FLIPKART_URL_REGEX = /https?:\/\/(www\.)?flipkart\.com\/[^\s]+/i;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

export class TelegramBot {
  private token: string;
  private chatId: string;
  private store: PriceStore;
  private fetcher: IFetcher;
  private lastUpdateId: number = 0;
  private polling: boolean = false;
  private pendingSearch: SearchResult[] = [];

  constructor(token: string, chatId: string, store: PriceStore, fetcher: IFetcher) {
    this.token = token;
    this.chatId = chatId;
    this.store = store;
    this.fetcher = fetcher;
  }

  /**
   * Start listening for messages via long polling.
   */
  startListening(): void {
    this.polling = true;
    this.pollUpdates();
    console.log("[Bot] Listening for Telegram messages...");
  }

  stopListening(): void {
    this.polling = false;
  }

  private async pollUpdates(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          await this.handleUpdate(update);
          this.lastUpdateId = update.update_id + 1;
        }
      } catch (err: any) {
        console.error("[Bot] Poll error:", err.message);
      }
      // Small delay to avoid hammering the API
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId}&timeout=30`;
    const response = await fetch(url);
    const data = (await response.json()) as { ok: boolean; result: TelegramUpdate[] };
    return data.ok ? data.result : [];
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text) return;

    // Only respond to our authorized chat
    if (message.chat.id.toString() !== this.chatId) return;

    const text = message.text.trim();

    if (text.startsWith("/help") || text.startsWith("/start")) {
      await this.sendHelp();
    } else if (text.startsWith("/list")) {
      await this.sendList();
    } else if (text.startsWith("/remove")) {
      await this.handleRemove(text);
    } else if (text.startsWith("/status")) {
      await this.sendStatus();
    } else if (text.startsWith("/search")) {
      await this.handleSearch(text.replace(/^\/search\s*/, ""));
    } else if (FLIPKART_URL_REGEX.test(text)) {
      await this.handleAddProduct(text);
    } else if (/^\d+$/.test(text) && this.pendingSearch.length > 0) {
      await this.handleSearchSelection(parseInt(text, 10));
    } else if (text.startsWith("/")) {
      await this.sendMessage("Unknown command. Use /help to see available commands.");
    } else {
      // Treat any non-command text as a search query
      await this.handleSearch(text);
    }
  }

  /**
   * Handle a Flipkart URL — add it to tracking.
   */
  private async handleAddProduct(text: string): Promise<void> {
    const urlMatch = text.match(FLIPKART_URL_REGEX);
    if (!urlMatch) {
      await this.sendMessage("❌ Couldn't find a valid Flipkart URL in your message.");
      return;
    }

    const url = urlMatch[0];
    await this.sendMessage("🔍 Checking product...");

    // Generate an ID from the URL
    const id = this.generateProductId(url);

    // Check if already tracking
    const existing = this.store.getAllProducts();
    if (existing.find((p) => p.id === id)) {
      await this.sendMessage("ℹ️ Already tracking this product.");
      return;
    }

    // Try to fetch the price to validate the URL works
    const product: Product = { id, name: "Loading...", url };
    const result = await this.fetcher.fetchPrice(product);

    if (!result.success) {
      await this.sendMessage(`❌ Couldn't fetch price for this product: ${result.error}\n\nMake sure it's a valid Flipkart Grocery product link.`);
      return;
    }

    // Extract product name from URL
    const name = this.extractProductName(url);
    const finalProduct: Product = { id, name, url };

    // Add to database
    this.store.addProduct(finalProduct);
    this.store.recordPrice(id, result.price, result.currency);

    await this.sendMessage(
      `✅ Now tracking:\n\n` +
      `📦 ${name}\n` +
      `💰 Current price: ₹${result.price}\n` +
      `🆔 ID: ${id}\n\n` +
      `I'll alert you when the price hits a low point.`
    );
  }

  /**
   * Handle a search query — search Flipkart and show results.
   */
  private async handleSearch(query: string): Promise<void> {
    if (!query || query.length < 2) {
      await this.sendMessage("Type a product name to search. Example: amul milk");
      return;
    }

    await this.sendMessage(`🔍 Searching for "${query}"...`);

    try {
      const results = await searchProducts(query);

      if (results.length === 0) {
        this.pendingSearch = [];
        await this.sendMessage(`❌ No products found for "${query}". Try a different search term.`);
        return;
      }

      // Show top 8 results
      const top = results.slice(0, 8);
      this.pendingSearch = top;

      let msg = `📋 Found ${results.length} results for "${query}":\n\n`;
      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        const priceStr = r.price ? `₹${r.price}` : "price N/A";
        const stockStr = r.inStock ? "" : " (out of stock)";
        const subtitle = r.subtitle ? ` (${r.subtitle})` : "";
        msg += `${i + 1}. ${r.brand ? r.brand + " " : ""}${r.name}${subtitle}\n   ${priceStr}${stockStr}\n\n`;
      }
      msg += `Reply with a number (1-${top.length}) to start tracking that product.`;

      await this.sendMessage(msg);
    } catch (err: any) {
      this.pendingSearch = [];
      console.error("[Bot] Search error:", err.message);
      await this.sendMessage(`❌ Search failed: ${err.message}\n\nTry again in a moment.`);
    }
  }

  /**
   * Handle user selecting a product from search results.
   */
  private async handleSearchSelection(num: number): Promise<void> {
    if (num < 1 || num > this.pendingSearch.length) {
      await this.sendMessage(`Please pick a number between 1 and ${this.pendingSearch.length}.`);
      return;
    }

    const selected = this.pendingSearch[num - 1];
    this.pendingSearch = []; // Clear pending search

    await this.sendMessage(`🔍 Checking price for: ${selected.brand ? selected.brand + " " : ""}${selected.name}...`);

    // Use the product URL with the existing tracking flow
    const id = selected.productId.toLowerCase();
    const url = selected.fullUrl;

    // Check if already tracking
    const existing = this.store.getAllProducts();
    if (existing.find((p) => p.id === id)) {
      await this.sendMessage("ℹ️ Already tracking this product.");
      return;
    }

    // Try to fetch the price via rome API to validate
    const product: Product = { id, name: selected.name, url };
    const result = await this.fetcher.fetchPrice(product);

    let price: number;
    let name: string;

    if (result.success) {
      price = result.price;
      name = selected.brand ? `${selected.brand} ${selected.name}` : selected.name;
    } else if (selected.price) {
      // Fall back to the price from search results
      price = selected.price;
      name = selected.brand ? `${selected.brand} ${selected.name}` : selected.name;
      console.log(`[Bot] Rome API failed for ${name}, using search price ₹${price}`);
    } else {
      await this.sendMessage(
        `❌ Couldn't verify price for this product: ${result.error}\n\n` +
        `The product might not be available for delivery to your pincode.`
      );
      return;
    }

    const subtitle = selected.subtitle ? ` (${selected.subtitle})` : "";
    const finalProduct: Product = { id, name: `${name}${subtitle}`, url };

    // Add to database
    this.store.addProduct(finalProduct);
    this.store.recordPrice(id, price, "INR");

    await this.sendMessage(
      `✅ Now tracking:\n\n` +
      `📦 ${name}${subtitle}\n` +
      `💰 Current price: ₹${price}\n` +
      `🆔 ID: ${id}\n\n` +
      `I'll alert you when the price hits a low point.`
    );
  }

  /**
   * Handle /remove command.
   */
  private async handleRemove(text: string): Promise<void> {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await this.sendMessage("Usage: /remove <product-id>\n\nUse /list to see product IDs.");
      return;
    }

    const id = parts.slice(1).join(" ");
    const products = this.store.getAllProducts();
    const product = products.find((p) => p.id === id);

    if (!product) {
      await this.sendMessage(`❌ No product found with ID: ${id}\n\nUse /list to see tracked products.`);
      return;
    }

    this.store.removeProduct(id);
    await this.sendMessage(`🗑️ Stopped tracking: ${product.name}`);
  }

  /**
   * Send list of tracked products.
   */
  private async sendList(): Promise<void> {
    const products = this.store.getAllProducts();

    if (products.length === 0) {
      await this.sendMessage("📭 Not tracking any products yet.\n\nSend me a Flipkart product link to start!");
      return;
    }

    let msg = `📋 Tracking ${products.length} product(s):\n\n`;
    for (const p of products) {
      const price = this.store.getLatestPrice(p.id);
      const priceStr = price !== null ? `₹${price}` : "no data yet";
      msg += `• ${p.name}\n  💰 ${priceStr}\n  🆔 ${p.id}\n\n`;
    }
    msg += `Use /remove <id> to stop tracking.`;

    await this.sendMessage(msg);
  }

  /**
   * Send current status/prices.
   */
  private async sendStatus(): Promise<void> {
    const products = this.store.getAllProducts();

    if (products.length === 0) {
      await this.sendMessage("📭 Not tracking any products.");
      return;
    }

    let msg = `📊 Current prices:\n\n`;
    for (const p of products) {
      const price = this.store.getLatestPrice(p.id);
      const history = this.store.getRecentPrices(p.id, 5);
      const trend = this.getTrendEmoji(history);
      const priceStr = price !== null ? `₹${price}` : "—";
      msg += `${trend} ${p.name}: ${priceStr}\n`;
    }

    await this.sendMessage(msg);
  }

  /**
   * Send help message.
   */
  private async sendHelp(): Promise<void> {
    await this.sendMessage(
      `🛒 Flipkart Price Tracker\n\n` +
      `Just type a product name and I'll search Flipkart for you!\n\n` +
      `How to use:\n` +
      `• Type a product name (e.g. "amul milk") → I'll show results\n` +
      `• Reply with a number to start tracking\n` +
      `• Or paste a Flipkart URL directly\n\n` +
      `Commands:\n` +
      `/search <query> — Search for a product\n` +
      `/list — Show tracked products\n` +
      `/status — Show current prices\n` +
      `/remove <id> — Stop tracking a product\n` +
      `/help — Show this message\n\n` +
      `I'll alert you automatically when a price drops to a local minimum! 📉`
    );
  }

  /**
   * Send a message to the user.
   */
  async sendMessage(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
        }),
      });
    } catch (err: any) {
      console.error("[Bot] Failed to send message:", err.message);
    }
  }

  /**
   * Generate a short ID from a Flipkart URL.
   */
  private generateProductId(url: string): string {
    // Try to extract pid from URL
    const pidMatch = url.match(/pid=([A-Z0-9]+)/i);
    if (pidMatch) return pidMatch[1].toLowerCase();

    // Fallback: use the product slug from URL path
    const pathMatch = url.match(/flipkart\.com\/([^/]+)/);
    if (pathMatch) return pathMatch[1].substring(0, 30);

    // Last resort: hash
    return `product-${Date.now()}`;
  }

  /**
   * Extract a readable product name from the URL slug.
   */
  private extractProductName(url: string): string {
    try {
      const parsed = new URL(url);
      const slug = parsed.pathname.split("/")[1] || "Unknown Product";
      // Convert slug to readable name: "maggi-2-minute-noodles" → "Maggi 2 Minute Noodles"
      return slug
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
        .substring(0, 60);
    } catch {
      return "Unknown Product";
    }
  }

  /**
   * Get a trend emoji based on recent prices.
   */
  private getTrendEmoji(prices: number[]): string {
    if (prices.length < 2) return "➡️";
    const last = prices[prices.length - 1];
    const prev = prices[prices.length - 2];
    if (last < prev) return "📉";
    if (last > prev) return "📈";
    return "➡️";
  }
}
