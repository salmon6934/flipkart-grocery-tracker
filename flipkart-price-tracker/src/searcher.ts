/**
 * Product search module.
 *
 * Searches Flipkart by fetching the regular search page HTML and parsing
 * the embedded __INITIAL_STATE__ JSON. No headless browser needed.
 *
 * This works because regular Flipkart search (without marketplace=GROCERY)
 * still returns grocery products (milk, noodles, salt, etc.) with their
 * product URLs — which can then be used with the rome API for price tracking.
 */

export interface SearchResult {
  name: string;
  subtitle: string;
  brand: string;
  price: number | null;
  originalPrice: number | null;
  productId: string;
  listingId: string;
  pageUri: string;
  fullUrl: string;
  inStock: boolean;
  thumbnail: string | null;
  category: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/**
 * Search Flipkart for products matching the query.
 * Returns parsed product results from the page's embedded JSON state.
 */
export async function searchProducts(query: string): Promise<SearchResult[]> {
  const url = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (res.status !== 200) {
    throw new Error(`Flipkart search returned HTTP ${res.status}`);
  }

  const html = await res.text();

  // Extract __INITIAL_STATE__ JSON from the page
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (!match) {
    throw new Error("Could not find product data in search page");
  }

  let state: any;
  try {
    state = JSON.parse(match[1]);
  } catch {
    throw new Error("Failed to parse search page data");
  }

  const pageData = state?.pageDataV4?.page?.data;
  if (!pageData) {
    throw new Error("No page data found in search results");
  }

  // Extract products from PRODUCT_SUMMARY widgets
  const allSlots = Object.values(pageData).flat() as any[];
  const productWidgets = allSlots.filter(
    (s: any) => s?.widget?.type === "PRODUCT_SUMMARY"
  );

  const results: SearchResult[] = [];

  for (const widget of productWidgets) {
    const products = widget?.widget?.data?.products || [];
    for (const p of products) {
      const value = p?.productInfo?.value;
      if (!value) continue;

      const prices = value.pricing?.prices || [];
      const sellingPrice = prices.find((pr: any) => !pr.strikeOff)?.value ?? null;
      const originalPrice = prices.find((pr: any) => pr.strikeOff)?.value ?? null;

      const pageUri =
        value.baseUrl || p?.productInfo?.action?.url || "";

      // Skip items without a valid product page URI
      if (!pageUri || !pageUri.includes("/p/")) continue;

      const thumbnail = value.media?.images?.[0]?.url
        ?.replace("{@width}", "128")
        .replace("{@height}", "128")
        .replace("{@quality}", "70") || null;

      results.push({
        name: value.titles?.title || "Unknown",
        subtitle: value.titles?.subtitle || "",
        brand: value.titles?.superTitle || "",
        price: sellingPrice,
        originalPrice,
        productId: value.id || "",
        listingId: value.listingId || "",
        pageUri,
        fullUrl: `https://www.flipkart.com${pageUri}`,
        inStock: value.availability?.displayState === "IN_STOCK",
        thumbnail,
        category: value.analyticsData?.superCategory || null,
      });
    }
  }

  return results;
}
