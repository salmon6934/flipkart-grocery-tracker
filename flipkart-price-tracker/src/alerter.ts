/**
 * Alert service — sends notifications when a price minimum is detected.
 *
 * Primary channel: Telegram bot.
 * Fallback: Console logging (when Telegram is not configured).
 */

import { MinimaAlert, TelegramConfig } from "./types";

export class Alerter {
  private botToken: string | null;
  private chatId: string | null;

  constructor(config: TelegramConfig) {
    this.botToken = process.env[config.botTokenEnv] || null;
    this.chatId = process.env[config.chatIdEnv] || null;

    if (!this.botToken || !this.chatId) {
      console.warn(
        "[Alerter] Telegram not configured. Set environment variables:",
        config.botTokenEnv,
        config.chatIdEnv
      );
      console.warn("[Alerter] Falling back to console-only alerts.");
    }
  }

  /**
   * Send an alert for a detected price minimum.
   */
  async sendAlert(alert: MinimaAlert): Promise<void> {
    const message = this.formatMessage(alert);

    // Always log to console
    console.log("\n🔔 PRICE ALERT:", message, "\n");

    // Send via Telegram if configured
    if (this.botToken && this.chatId) {
      await this.sendTelegram(message);
    }
  }

  private formatMessage(alert: MinimaAlert): string {
    return [
      `📉 Price Drop Alert!`,
      ``,
      `Product: ${alert.productName}`,
      `Current Price: ₹${alert.currentPrice}`,
      `Recent High: ₹${alert.recentHigh}`,
      `Drop: ${alert.dropPercent}%`,
      ``,
      `⏰ ${new Date(alert.detectedAt).toLocaleString("en-IN")}`,
    ].join("\n");
  }

  private async sendTelegram(message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("[Alerter] Telegram API error:", response.status, body);
      }
    } catch (err) {
      console.error("[Alerter] Failed to send Telegram message:", err);
    }
  }
}
