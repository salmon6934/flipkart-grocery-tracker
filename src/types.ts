/**
 * Core type definitions for the price tracker.
 */

export interface Product {
  id: string;
  name: string;
  url: string;
}

export interface PriceReading {
  productId: string;
  price: number;
  currency: string;
  recordedAt: string; // ISO timestamp
}

export interface Config {
  pollingIntervalMinutes: number;
  pincode: string;
  detection: DetectionConfig;
  telegram: TelegramConfig;
  database: DatabaseConfig;
}

export interface DetectionConfig {
  windowSize: number;
  thresholdPercent: number;
  cooldownMinutes: number;
}

export interface TelegramConfig {
  botTokenEnv: string;
  chatIdEnv: string;
}

export interface DatabaseConfig {
  path: string;
}

export interface MinimaAlert {
  productId: string;
  productName: string;
  currentPrice: number;
  recentHigh: number;
  dropPercent: number;
  detectedAt: string;
}

export interface FetchResult {
  price: number;
  currency: string;
  success: boolean;
  error?: string;
}
