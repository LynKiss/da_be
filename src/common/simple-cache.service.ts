import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache service đơn giản với TTL.
 *
 * Dùng cho: product list, inventory valuation, profitability report.
 * KHÔNG dùng cho: dữ liệu nhạy cảm (user/permissions), cần distributed (multi-instance).
 *
 * Khi scale lên multi-instance, swap sang Redis bằng cách thay implementation
 * của 4 method get/set/del/clear.
 *
 * Tính năng:
 *   - TTL per-key (auto expire)
 *   - getOrCompute(): lazy load với cache-aside pattern
 *   - invalidatePrefix(): xóa các key có prefix (ví dụ "products:" để xóa toàn bộ product cache)
 *   - Auto cleanup expired entries mỗi 60s (tránh memory leak)
 */
@Injectable()
export class SimpleCacheService {
  private readonly logger = new Logger(SimpleCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor() {
    // Auto cleanup expired entries mỗi 60s
    setInterval(() => this.cleanupExpired(), 60_000).unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds = 300): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  /**
   * Xóa tất cả key có prefix. Dùng để invalidate cả nhóm.
   * Ví dụ: cacheService.invalidatePrefix('products:') xóa products:list, products:byId:1, ...
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Cache-aside pattern: nếu có cache → return, nếu không → compute + cache.
   * Ưu điểm: caller không cần check cache thủ công.
   */
  async getOrCompute<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const fresh = await compute();
    this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Cleanup: removed ${removed} expired cache entries`);
    }
  }
}
