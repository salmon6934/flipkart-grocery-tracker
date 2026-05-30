/**
 * Local minima detection algorithm.
 *
 * Strategy: Sliding window valley detection.
 * A local minimum is when the price has been falling, hits a low point,
 * then starts rising again — AND the drop from the recent high exceeds
 * a configurable threshold.
 *
 * This avoids alerting on tiny ₹1-2 fluctuations.
 */

import { DetectionConfig, MinimaAlert } from "./types";

// Track cooldowns per product to avoid spamming alerts
const lastAlertTime: Map<string, number> = new Map();

/**
 * Detect if the latest price reading represents a local minimum.
 *
 * @param productId - Product identifier
 * @param productName - Human-readable product name
 * @param prices - Recent prices in chronological order (oldest first)
 * @param config - Detection configuration
 * @returns MinimaAlert if a minimum is detected, null otherwise
 */
export function detectMinima(
  productId: string,
  productName: string,
  prices: number[],
  config: DetectionConfig
): MinimaAlert | null {
  const { windowSize, thresholdPercent, cooldownMinutes } = config;

  // Need at least windowSize + 1 readings to detect a valley
  if (prices.length < windowSize) {
    return null;
  }

  // Check cooldown — don't alert again too soon for the same product
  const lastAlert = lastAlertTime.get(productId);
  if (lastAlert) {
    const elapsed = (Date.now() - lastAlert) / (1000 * 60);
    if (elapsed < cooldownMinutes) {
      return null;
    }
  }

  // Take the last windowSize prices
  const window = prices.slice(-windowSize);
  const currentPrice = window[window.length - 1];

  // Find the recent high (max in the window excluding the last value)
  const precedingPrices = window.slice(0, -1);
  const recentHigh = Math.max(...precedingPrices);

  // Calculate drop percentage
  const dropPercent = ((recentHigh - currentPrice) / recentHigh) * 100;

  // Check if drop exceeds threshold
  if (dropPercent < thresholdPercent) {
    return null;
  }

  // Check for valley shape: prices should have been falling then the current
  // price is at or near the bottom. We verify by checking that the current
  // price is the minimum of the window.
  const windowMin = Math.min(...window);
  if (currentPrice > windowMin * 1.01) {
    // Current price is more than 1% above the window minimum — not at the bottom
    return null;
  }

  // Check that there's a downward trend leading to this point
  // At least half the preceding prices should be higher than current
  const higherCount = precedingPrices.filter((p) => p > currentPrice).length;
  if (higherCount < precedingPrices.length * 0.5) {
    return null;
  }

  // We have a valid local minimum!
  lastAlertTime.set(productId, Date.now());

  return {
    productId,
    productName,
    currentPrice,
    recentHigh,
    dropPercent: Math.round(dropPercent * 100) / 100,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Reset cooldown for a product (useful for testing).
 */
export function resetCooldown(productId: string): void {
  lastAlertTime.delete(productId);
}

/**
 * Reset all cooldowns.
 */
export function resetAllCooldowns(): void {
  lastAlertTime.clear();
}
