/**
 * Test: Set pincode first, then search for products.
 */

import "dotenv/config";
import fs from "fs";

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false }); // visible for debugging
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile";

  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 390, height: 844 },
  });

  const page = await context.newPage();

  // Capture API responses with product data
  let productData: string | null = null;

  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (url.includes("page/fetch") || url.includes("rome.api")) {
        const body = await res.text();
        if (body.includes("kilosPrice") || (body.includes("productCard") && body.length > 10000)) {
          console.log(`  ✅ Product API: ${url.substring(0, 60)} (${body.length}B)`);
          if (!productData || body.length > productData.length) {
            productData = body;
          }
        }
      }
    } catch {}
  });

  // First go to grocery store
  console.log("Loading grocery store...");
  await page.goto("https://www.flipkart.com/grocery-supermart-store", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  // Try to set pincode via cookie/localStorage
  await page.evaluate(`
    localStorage.setItem('pincode', '522237');
    document.cookie = 'vw=522237; path=/; domain=.flipkart.com';
  `);

  // Also try to find and fill pincode input
  const pincodeInput = await page.$('input[placeholder*="pincode"], input[placeholder*="Pincode"], input[type="tel"]');
  if (pincodeInput) {
    console.log("Found pincode input, filling...");
    await pincodeInput.fill("522237");
    await page.waitForTimeout(500);
    // Look for submit button
    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Apply"), button:has-text("Check")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    } else {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }
  }

  // Now navigate to search
  console.log("\nNavigating to search...");
  await page.goto(
    "https://www.flipkart.com/search?q=amul+milk&otracker=search&otracker1=search&marketplace=GROCERY&as-show=on&as=off",
    { waitUntil: "networkidle", timeout: 60000 }
  );
  await page.waitForTimeout(8000);

  // Check if pincode prompt appears again
  const bodyText = await page.evaluate(`document.body.innerText`) as string;
  
  if (bodyText.includes("Verify Delivery Pincode") || bodyText.includes("Change pincode")) {
    console.log("Pincode prompt detected, trying to dismiss...");
    // Try clicking continue or entering pincode
    const continueBtn = await page.$('button:has-text("CONTINUE"), button:has-text("Continue")');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(5000);
    }
  }

  // Wait for products
  await page.waitForTimeout(5000);

  const finalText = await page.evaluate(`document.body.innerText.substring(0, 3000)`) as string;
  console.log("\nPage content:");
  console.log(finalText.substring(0, 2000));

  // Get product links
  const links = await page.evaluate(`
    (() => {
      return Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && (a.href.includes('/p/itm') || a.href.includes('pid=')))
        .map(a => ({
          href: a.href,
          text: a.textContent.trim().substring(0, 100)
        }))
        .filter(a => a.text.length > 5)
        .slice(0, 15);
    })()
  `) as any[];

  console.log(`\nProduct links: ${links.length}`);
  links.forEach((l: any, i: number) => {
    console.log(`  ${i + 1}. ${l.text.substring(0, 60)} → ${l.href.substring(0, 100)}`);
  });

  if (productData) {
    fs.writeFileSync("search-final-products.json", productData);
    console.log("\n✅ Product data saved!");
  }

  await page.waitForTimeout(2000);
  await context.close();
  await browser.close();
}

main().catch(console.error);
