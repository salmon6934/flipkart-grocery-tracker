/**
 * Database layer for storing price history.
 *
 * Uses sql.js (SQLite compiled to WASM) — no native build tools required.
 * Data is persisted to disk manually after writes.
 */

import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";
import { Product, PriceReading } from "./types";

export class PriceStore {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;

  constructor(dbPath: string = "db/prices.db") {
    this.dbPath = dbPath;
  }

  /**
   * Must be called before using the store. Initializes sql.js and loads/creates the DB.
   */
  async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    // Load existing DB from disk if it exists
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.initTables();
  }

  private initTables(): void {
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_prices_product_time
      ON prices(product_id, recorded_at)
    `);

    this.persist();
  }

  /**
   * Write the in-memory database to disk.
   */
  private persist(): void {
    const data = this.db!.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  /**
   * Register a product to track. Upserts if already exists.
   */
  addProduct(product: Product): void {
    this.db!.run(
      `INSERT INTO products (id, name, url) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url`,
      [product.id, product.name, product.url]
    );
    this.persist();
  }

  /**
   * Store a price reading with current timestamp.
   */
  recordPrice(productId: string, price: number, currency: string = "INR"): void {
    this.db!.run(
      `INSERT INTO prices (product_id, price, currency) VALUES (?, ?, ?)`,
      [productId, price, currency]
    );
    this.persist();
  }

  /**
   * Get price history for a product within the last N hours.
   * Returns oldest-first (chronological order).
   */
  getPriceHistory(productId: string, hours: number = 24): PriceReading[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const stmt = this.db!.prepare(
      `SELECT product_id, price, currency, recorded_at
       FROM prices
       WHERE product_id = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC`
    );
    stmt.bind([productId, cutoff]);

    const results: PriceReading[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      results.push({
        productId: row.product_id,
        price: row.price,
        currency: row.currency,
        recordedAt: row.recorded_at,
      });
    }
    stmt.free();
    return results;
  }

  /**
   * Get the last N price readings for a product (chronological order).
   */
  getRecentPrices(productId: string, count: number = 10): number[] {
    const stmt = this.db!.prepare(
      `SELECT price FROM prices
       WHERE product_id = ?
       ORDER BY recorded_at DESC
       LIMIT ?`
    );
    stmt.bind([productId, count]);

    const prices: number[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      prices.push(row.price);
    }
    stmt.free();

    // Reverse to get chronological order (oldest first)
    return prices.reverse();
  }

  /**
   * Get the most recent price for a product.
   */
  getLatestPrice(productId: string): number | null {
    const stmt = this.db!.prepare(
      `SELECT price FROM prices
       WHERE product_id = ?
       ORDER BY recorded_at DESC
       LIMIT 1`
    );
    stmt.bind([productId]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.price;
    }
    stmt.free();
    return null;
  }

  /**
   * Remove a product and all its price history.
   */
  removeProduct(productId: string): void {
    this.db!.run(`DELETE FROM prices WHERE product_id = ?`, [productId]);
    this.db!.run(`DELETE FROM products WHERE id = ?`, [productId]);
    this.persist();
  }

  /**
   * List all tracked products.
   */
  getAllProducts(): Product[] {
    const stmt = this.db!.prepare("SELECT id, name, url FROM products");
    const products: Product[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      products.push({ id: row.id, name: row.name, url: row.url });
    }
    stmt.free();
    return products;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
