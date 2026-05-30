/**
 * Tests for the minima detection algorithm using synthetic price data.
 */

import { detectMinima, resetAllCooldowns } from "../src/detector";
import { DetectionConfig } from "../src/types";

const defaultConfig: DetectionConfig = {
  windowSize: 8,
  thresholdPercent: 5.0,
  cooldownMinutes: 120,
};

beforeEach(() => {
  resetAllCooldowns();
});

describe("detectMinima", () => {
  it("should return null when not enough data points", () => {
    const prices = [100, 99, 98];
    const result = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(result).toBeNull();
  });

  it("should detect a clear price drop exceeding threshold", () => {
    // Price goes from ~100 down to 90 (10% drop)
    const prices = [100, 101, 100, 99, 98, 95, 93, 90];
    const result = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.dropPercent).toBeGreaterThanOrEqual(5);
    expect(result!.currentPrice).toBe(90);
  });

  it("should NOT alert on small fluctuations below threshold", () => {
    // Price drops only ~3% (below 5% threshold)
    const prices = [100, 100, 99, 99, 98, 98, 97, 97];
    const result = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(result).toBeNull();
  });

  it("should NOT alert when price is flat", () => {
    const prices = [100, 100, 100, 100, 100, 100, 100, 100];
    const result = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(result).toBeNull();
  });

  it("should NOT alert when price is rising", () => {
    const prices = [90, 91, 92, 93, 94, 95, 96, 97];
    const result = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(result).toBeNull();
  });

  it("should respect cooldown period", () => {
    const prices = [100, 101, 100, 99, 98, 95, 93, 90];

    // First detection should work
    const first = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(first).not.toBeNull();

    // Second detection immediately after should be blocked by cooldown
    const second = detectMinima("test-1", "Test Product", prices, defaultConfig);
    expect(second).toBeNull();
  });

  it("should detect minima for different products independently", () => {
    const prices = [100, 101, 100, 99, 98, 95, 93, 90];

    const alert1 = detectMinima("product-a", "Product A", prices, defaultConfig);
    const alert2 = detectMinima("product-b", "Product B", prices, defaultConfig);

    // Both should trigger since they're different products
    expect(alert1).not.toBeNull();
    expect(alert2).not.toBeNull();
  });

  it("should handle realistic grocery price patterns", () => {
    // Simulates a product that was ₹245, drops to ₹219 over several readings
    const prices = [245, 245, 239, 235, 229, 225, 222, 219];
    const result = detectMinima("atta-5kg", "Aashirvaad Atta 5kg", prices, defaultConfig);
    expect(result).not.toBeNull();
    expect(result!.currentPrice).toBe(219);
    expect(result!.recentHigh).toBe(245);
    expect(result!.dropPercent).toBeGreaterThan(10);
  });

  it("should work with custom config", () => {
    const strictConfig: DetectionConfig = {
      windowSize: 6,
      thresholdPercent: 10.0, // Only alert on 10%+ drops
      cooldownMinutes: 60,
    };

    // 8% drop — should NOT trigger with 10% threshold
    const prices = [100, 99, 97, 95, 93, 92];
    const result = detectMinima("test-1", "Test Product", prices, strictConfig);
    expect(result).toBeNull();
  });
});
