/**
 * Test the search URL with pincode set first.
 */

import "dotenv/config";
import fs from "fs";

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile";

  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Capture API responses with product data
  let productData: string | null = null;

  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (url.includes("page/fetch") || url.includes("rome.api")) {
        const body = await res.text();
        if (body.includes("kilosPrice") || (body.includes("productCard") && body.length > 10000)) {
          console.log(`  ✅ API hit: ${url.substring(0, 80)} (${body.length} bytes)`);
          if (!productData || body.length > productData.length) {
            productData = body;
          }
        }
      }
    } catch {}
  });

  // First go to grocery store and set pincode
  console.log("Loading grocery store to set pincode...");
  await page.goto("https://www.flipkart.com/grocery-supermart-store", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  // Try to set pincode - look for pincode input
  console.log("Setting pincode 522237...");
  
  // Look for pincode input or "Change pincode" button
  const pincodeInput = await page.$('input[placeholder*="pincode"], input[placeholder*="Pincode"], input[type="tel"], input[name="pincode"]');
  if (pincodeInput) {
    await pincodeInput.fill("522237");
    await page.waitForTimeout(500);
    // Press submit/enter
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    console.log("  Pincode submitted via input.");
  } else {
    // Try setting pincode via cookie/localStorage
    console.log("  No pincode input found. Setting via cookie...");
    await context.addCookies([
      {
        name: "vw",
        value: "522237",
        domain: ".flipkart.com",
        path: "/",
      },
      {
        name: "gpv",
        value: "522237",
        domain: ".flipkart.com",
        path: "/",
      },
    ]);
    
    // Also try localStorage
    await page.evaluate(`
      localStorage.setItem('pincode', '522237');
      localStorage.setItem('grocery_pincode', '522237');
    `);
  }

  // Now navigate to search
  console.log("\nNavigating to search...");
  await page.goto(
    "https://www.flipkart.com/search?q=amul%20milk&otracker=search&otracker1=search&marketplace=GROCERY&as-show=on&as=off",
    { waitUntil: "networkidle", timeout: 60000 }
  );
  await page.waitForTimeout(8000);

  // Check if pincode prompt still shows
  const bodyText = await page.evaluate(`document.body.innerText`) as string;
  
  if (bodyText.includes("Verify Delivery Pincode") || bodyText.includes("Change pincode")) {
    console.log("  Still showing pincode prompt. Trying to fill it...");
    
    // Find and fill the pincode input on this page
    const inputs = await page.$$('input');
    for (const input of inputs) {
      const placeholder = await input.getAttribute("placeholder");
      const type = await input.getAttribute("type");
      console.log(`    Found input: type=${type}, placeholder=${placeholder}`);
      if (type === "tel" || (placeholder && placeholder.toLowerCase().includes("pin"))) {
        await input.fill("522237");
        await page.waitForTimeout(500);
        break;
      }
    }
    
    // Look for submit button
    const buttons = await page.$$('button, [role="button"]');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && (text.includes("Submit") || text.includes("Apply") || text.includes("Check"))) {
        console.log(`    Clicking: ${text.trim()}`);
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
    }
  }

  // Wait for products to load
  await page.waitForTimeout(5000);

  // Check page content now
  const finalText = await page.evaluate(`document.body.innerText.substring(0, 3000)`) as string;
  console.log("\nPage content (first 2000 chars):");
  console.log(finalText.substring(0, 2000));

  // Try to find product links
  const links = await page.evaluate(`
    (() => {
      return Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && (a.href.includes('/p/itm') || a.href.includes('pid=')))
        .map(a => ({
          href: a.href,
          text: a.textContent.trim().substring(0, 100)
        }))
        .slice(0, 10);
    })()
  `) as any[];

  console.log(`\nProduct links: ${links.length}`);
  links.forEach((l: any, i: number) => {
    console.log(`  ${i + 1}. ${l.text.substring(0, 60)} → ${l.href.substring(0, 100)}`);
  });

  if (productData) {
    fs.writeFileSync("search-product-data.json", productData);
    console.log("\n✅ Product API data saved!");
    const prices = [...(productData as string).matchAll(/"kilosPrice"\s*:\s*(\d+)/g)];
    console.log(`Prices found: ${prices.length}`);
    prices.slice(0, 5).forEach(m => console.log(`  ₹${m[1]}`));
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
