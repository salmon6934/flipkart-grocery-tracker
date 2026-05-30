/**
 * Price fetcher — responsible for getting the current price of a product.
 *
 * Two implementations:
 * 1. APIFetcher — calls Flipkart's internal page/fetch API directly
 * 2. PlaywrightFetcher — loads the page in a headless browser (fallback)
 *
 * The API approach is preferred: faster, lighter, more reliable.
 * Falls back to Playwright if the API call fails (e.g., cookies expired).
 */

import { FetchResult, Product } from "./types";

/**
 * Abstract base interface for fetchers.
 */
export interface IFetcher {
  fetchPrice(product: Product): Promise<FetchResult>;
  close(): Promise<void>;
}

/**
 * Extracts the product page path from a full Flipkart URL.
 * e.g., "https://www.flipkart.com/maggi-noodles/p/itm123?pid=XYZ" → "/maggi-noodles/p/itm123?pid=XYZ"
 */
function extractPagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    // If URL parsing fails, assume it's already a path
    return url;
  }
}

/**
 * API-based fetcher.
 * Calls Flipkart's internal page/fetch endpoint directly.
 *
 * Requires a session cookie from Flipkart. On first run (or when cookies expire),
 * uses Playwright to visit Flipkart once and grab the cookies.
 */
export class APIFetcher implements IFetcher {
  private cookies: string = "";
  private cookieExpiry: number = 0;
  private browser: any = null;

  private readonly API_URL = "https://2.rome.api.flipkart.com/api/4/page/fetch";
  private readonly USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile";

  /**
   * Get a fresh session cookie by visiting Flipkart in a headless browser.
   */
  private async refreshCookies(): Promise<void> {
    console.log("[APIFetcher] Refreshing session cookies...");

    const { chromium } = await import("playwright");
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const context = await this.browser.newContext({
      userAgent: this.USER_AGENT,
    });

    const page = await context.newPage();

    try {
      await page.goto("https://www.flipkart.com/grocery-supermart-store", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Wait a moment for cookies to be set
      await page.waitForTimeout(3000);

      // Extract cookies
      const cookies = await context.cookies();
      this.cookies = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");

      // Set expiry to 1 hour from now (conservative — actual expiry may be longer)
      this.cookieExpiry = Date.now() + 60 * 60 * 1000;

      console.log(`[APIFetcher] Got ${cookies.length} cookies. Valid for 1 hour.`);
    } finally {
      await context.close();
    }
  }

  /**
   * Ensure we have valid cookies.
   */
  private async ensureCookies(): Promise<void> {
    if (!this.cookies || Date.now() > this.cookieExpiry) {
      await this.refreshCookies();
    }
  }

  async fetchPrice(product: Product): Promise<FetchResult> {
    try {
      await this.ensureCookies();

      const pagePath = extractPagePath(product.url);

      const response = await fetch(`${this.API_URL}?cacheFirst=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-agent": this.USER_AGENT,
          Cookie: this.cookies,
          Accept: "*/*",
          Origin: "https://www.flipkart.com",
          Referer: "https://www.flipkart.com/",
        },
        body: JSON.stringify({
          pageUri: pagePath,
          locationContext: {
            pincode: "522237",
            changed: false,
          },
          pageContext: {
            trackingContext: {
              context: {
                eVar51: "personalisedRecommendation/smartBasket",
                eVar61: "reco",
              },
            },
            networkSpeed: 0,
          },
        }),
      });

      if (!response.ok) {
        // If 401/403, cookies might be expired — force refresh next time
        if (response.status === 401 || response.status === 403) {
          this.cookieExpiry = 0;
        }
        return {
          price: 0,
          currency: "INR",
          success: false,
          error: `API returned ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.text();

      // Search for price in the response
      const price = this.extractPrice(data);

      if (price === null) {
        return {
          price: 0,
          currency: "INR",
          success: false,
          error: "Could not find price in API response",
        };
      }

      return { price, currency: "INR", success: true };
    } catch (err: any) {
      return {
        price: 0,
        currency: "INR",
        success: false,
        error: `API fetch failed: ${err.message}`,
      };
    }
  }

  /**
   * Extract price from the API response JSON.
   * Looks for kilosPrice (selling price) or fsp fields.
   */
  private extractPrice(responseText: string): number | null {
    try {
      const data = JSON.parse(responseText);
      // Deep search for price fields in the response
      const price = this.findPriceInObject(data);
      return price;
    } catch {
      // If JSON parse fails, try regex extraction
      return this.extractPriceRegex(responseText);
    }
  }

  /**
   * Recursively search for price fields in the response object.
   * Prioritizes: kilosPrice > fsp > sellingPrice > sp
   */
  private findPriceInObject(obj: any, depth: number = 0): number | null {
    if (depth > 15 || obj === null || obj === undefined) return null;

    // Direct price fields
    if (typeof obj === "object" && !Array.isArray(obj)) {
      // kilosPrice is the selling price we saw in the response
      if ("kilosPrice" in obj && typeof obj.kilosPrice === "number") {
        return obj.kilosPrice;
      }
      // fsp = final selling price
      if ("fsp" in obj && typeof obj.fsp === "number") {
        return obj.fsp;
      }
      if ("sellingPrice" in obj && typeof obj.sellingPrice === "number") {
        return obj.sellingPrice;
      }

      // Look in price_description or pricing sections first
      for (const key of Object.keys(obj)) {
        if (key.includes("price") || key.includes("pricing") || key.includes("kilos")) {
          const result = this.findPriceInObject(obj[key], depth + 1);
          if (result !== null) return result;
        }
      }

      // Then search everything else
      for (const key of Object.keys(obj)) {
        if (!key.includes("price") && !key.includes("pricing") && !key.includes("kilos")) {
          const result = this.findPriceInObject(obj[key], depth + 1);
          if (result !== null) return result;
        }
      }
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const result = this.findPriceInObject(item, depth + 1);
        if (result !== null) return result;
      }
    }

    return null;
  }

  /**
   * Fallback: extract price using regex if JSON parsing fails.
   */
  private extractPriceRegex(text: string): number | null {
    // Look for "kilosPrice":150 pattern
    const kilosMatch = text.match(/"kilosPrice"\s*:\s*(\d+(?:\.\d+)?)/);
    if (kilosMatch) return parseFloat(kilosMatch[1]);

    // Look for "fsp":"150" or "fsp":150
    const fspMatch = text.match(/"fsp"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
    if (fspMatch) return parseFloat(fspMatch[1]);

    // Look for "sellingPrice":150
    const spMatch = text.match(/"sellingPrice"\s*:\s*(\d+(?:\.\d+)?)/);
    if (spMatch) return parseFloat(spMatch[1]);

    return null;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/**
 * Playwright-based fetcher (fallback).
 * Loads the Flipkart product page in a headless Chromium browser
 * and extracts the price from the rendered DOM.
 */
export class PlaywrightFetcher implements IFetcher {
  private browser: any = null;

  async init(): Promise<void> {
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });
  }

  async fetchPrice(product: Product): Promise<FetchResult> {
    if (!this.browser) {
      await this.init();
    }

    const context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    try {
      await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for price element to appear
      const priceSelectors = [
        '[class*="price"] [class*="selling"]',
        '[class*="sellingPrice"]',
        '[class*="kilosPrice"]',
        'div[class*="price"] span',
        '[data-testid="price"]',
      ];

      let priceText: string | null = null;

      for (const selector of priceSelectors) {
        try {
          const el = await page.waitForSelector(selector, { timeout: 5000 });
          if (el) {
            priceText = await el.textContent();
            if (priceText && /\d/.test(priceText)) break;
          }
        } catch {
          // Selector not found, try next
        }
      }

      if (!priceText) {
        return {
          price: 0,
          currency: "INR",
          success: false,
          error: "Could not find price element on page",
        };
      }

      // Parse price: remove ₹, commas, spaces
      const cleaned = priceText.replace(/[₹,\s]/g, "");
      const price = parseFloat(cleaned);

      if (isNaN(price)) {
        return {
          price: 0,
          currency: "INR",
          success: false,
          error: `Could not parse price from text: "${priceText}"`,
        };
      }

      return { price, currency: "INR", success: true };
    } catch (err: any) {
      return {
        price: 0,
        currency: "INR",
        success: false,
        error: `Fetch failed: ${err.message}`,
      };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
