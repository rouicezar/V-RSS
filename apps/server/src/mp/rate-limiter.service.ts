import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@server/prisma/prisma.service';

/**
 * 公众号后台接口限流器
 *
 * 职责：
 * - 熔断冷却（200013 → 60min 熔断）
 * - 请求速率控制（文章间隔 30s、搜索间隔 15s）
 * - 日配额（当日 100 次上限）
 * - 风控倒计时（24h 总时长 - 已过去）
 * - 多账号 per-account 限流/日配额
 * - 状态持久化（跨重启恢复）
 */

const RATE_LIMIT_BREAK_MS = 60 * 60 * 1e3;
const ARTICLE_MIN_INTERVAL = 30 * 1e3;
const SEARCH_MIN_INTERVAL = 15 * 1e3;
const DAILY_LIMIT = 100;
const RATE_LIMIT_TOTAL_MS = 24 * 60 * 60 * 1e3;

export interface RateLimitStatus {
  limited: boolean;
  retryAfterSec: number;
  rateLimitRemainHours: number;
  dailyCount: number;
  dailyLimit: number;
  throttledSec: number;
  minIntervalSec: number;
}

export type PipelineId = 1 | 2;

@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  private rateLimitedUntil = 0;
  private rateLimitStartedAt = 0;
  private tripDate = '';
  private tripCountToday = 0;
  private lastArticleReqAt = 0;
  private lastSearchReqAt = 0;
  private dailyReqDate = '';
  private dailyReqCount = 0;
  private accountRateLimitMap = new Map<string, number>();
  private accountDailyCountMap = new Map<string, number>();
  private lastSyncAllAt = 0;
  private activePipeline: PipelineId = 1;

  constructor(private readonly prismaService: PrismaService) {}

  // ========== 状态恢复 / 持久化 ==========

  async restore(): Promise<void> {
    try {
      const state = await this.prismaService.mpState.findUnique({
        where: { id: 'daily' },
      });
      if (!state) return;

      const today = new Date().toISOString().slice(0, 10);
      this.rateLimitedUntil = Number(state.rateLimitedUntil ?? 0);
      this.rateLimitStartedAt = Number(state.rateLimitStartedAt ?? 0);
      this.activePipeline = state.activePipeline === 2 ? 2 : 1;

      if (this.rateLimitedUntil > Date.now()) {
        const remainMin = Math.ceil((this.rateLimitedUntil - Date.now()) / 6e4);
        this.logger.warn(`熔断恢复：剩余冷却 ${remainMin} 分钟`);
      }

      this.dailyReqDate = state.dailyReqDate ?? '';
      if (this.dailyReqDate === today) {
        this.dailyReqCount = state.dailyReqCount ?? 0;
      }
      this.lastArticleReqAt = Number(state.lastArticleReq ?? 0);
      this.lastSearchReqAt = Number(state.lastSearchReq ?? 0);

      this.tripDate = state.tripDate;
      if (state.tripDate === today) {
        this.tripCountToday = state.tripCount;
      }
      if (Number(state.lastSyncAllAt) > 0) {
        this.lastSyncAllAt = Number(state.lastSyncAllAt);
      }

      this.logger.log(
        `MpState 恢复：今日请求 ${this.dailyReqCount}/100` +
          ` 限流 ${this.tripCountToday} 次` +
          (this.rateLimitedUntil > Date.now() ? ' | 熔断中' : ''),
      );
    } catch (e) {
      this.logger.warn(`恢复 MpState 失败: ${(e as Error).message}`);
    }
  }

  async persist(): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await this.prismaService.mpState.upsert({
        where: { id: 'daily' },
        update: {
          rateLimitedUntil: BigInt(this.rateLimitedUntil),
          rateLimitStartedAt: BigInt(this.rateLimitStartedAt),
          dailyReqDate: this.dailyReqDate,
          dailyReqCount: this.dailyReqCount,
          lastArticleReq: BigInt(this.lastArticleReqAt),
          lastSearchReq: BigInt(this.lastSearchReqAt),
          tripCount: this.tripCountToday,
          tripDate: this.tripDate,
          activePipeline: this.activePipeline,
        },
        create: {
          id: 'daily',
          rateLimitedUntil: BigInt(this.rateLimitedUntil),
          dailyReqDate: this.dailyReqDate,
          dailyReqCount: this.dailyReqCount,
          lastArticleReq: BigInt(this.lastArticleReqAt),
          lastSearchReq: BigInt(this.lastSearchReqAt),
          tripCount: this.tripCountToday,
          tripDate: this.tripDate,
          rateLimitStartedAt: BigInt(this.rateLimitStartedAt),
          activePipeline: this.activePipeline,
        },
      });
    } catch (e) {
      this.logger.warn(`持久化限流状态失败: ${(e as Error).message}`);
    }
  }

  // ========== 同步时间 ==========

  getLastSyncAll(): number {
    return this.lastSyncAllAt;
  }

  async setLastSyncAll(ts: number): Promise<void> {
    this.lastSyncAllAt = ts;
    try {
      await this.prismaService.mpState.upsert({
        where: { id: 'daily' },
        update: { lastSyncAllAt: BigInt(ts) },
        create: { id: 'daily', lastSyncAllAt: BigInt(ts) },
      });
    } catch (e) {
      this.logger.warn(`保存 lastSyncAllAt 失败: ${(e as Error).message}`);
    }
  }

  getActivePipeline(): PipelineId {
    return this.activePipeline;
  }

  async setActivePipeline(pipeline: PipelineId): Promise<void> {
    this.activePipeline = pipeline;
    await this.prismaService.mpState.upsert({
      where: { id: 'daily' },
      update: { activePipeline: pipeline },
      create: { id: 'daily', activePipeline: pipeline },
    });
  }

  // ========== 请求门控 ==========

  isRateLimited(accountId = ''): boolean {
    // 全局熔断（日配额耗尽等）对所有账号生效
    if (Date.now() < this.rateLimitedUntil) return true;
    // 指定账号时：检查该账号是否被单独熔断
    if (
      accountId &&
      Date.now() < (this.accountRateLimitMap.get(accountId) || 0)
    ) {
      return true;
    }
    return false;
  }

  async canRequest(
    key: 'article' | 'search',
    accountId = '',
  ): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyReqDate !== today) {
      this.dailyReqDate = today;
      this.dailyReqCount = 0;
    }

    if (this.dailyReqCount >= DAILY_LIMIT) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      this.rateLimitedUntil = Math.max(
        this.rateLimitedUntil,
        tomorrow.getTime(),
      );
      this.logger.warn(`当日后台请求已达 ${DAILY_LIMIT} 次上限，熔断至次日`);
      await this.persist();
      return false;
    }

    const last =
      key === 'article' ? this.lastArticleReqAt : this.lastSearchReqAt;
    const minInt =
      key === 'article' ? ARTICLE_MIN_INTERVAL : SEARCH_MIN_INTERVAL;
    if (last + minInt > Date.now()) return false;

    if (key === 'article') this.lastArticleReqAt = Date.now();
    else this.lastSearchReqAt = Date.now();
    this.dailyReqCount += 1;

    if (accountId) {
      const count = (this.accountDailyCountMap.get(accountId) || 0) + 1;
      this.accountDailyCountMap.set(accountId, count);
    }
    if (this.dailyReqCount % 10 === 0) {
      this.persist().catch(() => {});
    }
    return true;
  }

  // ========== 熔断 ==========

  async trip(accountId = ''): Promise<void> {
    const cooldownUntil = Date.now() + RATE_LIMIT_BREAK_MS;
    // 200013 是账号级限频：只熔断触发它的账号，绝不全局连坐（新账号无需等旧账号）
    // 全局熔断 rateLimitedUntil 仅由日配额耗尽等全局场景设置
    if (accountId) {
      this.accountRateLimitMap.set(accountId, cooldownUntil);
      this.logger.warn(
        `账号 ${accountId} 触发限流，熔断 ${RATE_LIMIT_BREAK_MS / 1e3}s，多账号模式下将自动切换`,
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    if (this.tripDate !== today) {
      this.tripDate = today;
      this.tripCountToday = 0;
    }
    this.tripCountToday += 1;

    if (this.rateLimitStartedAt <= 0) {
      this.rateLimitStartedAt = Date.now();
    }
    this.logger.warn(
      `公众号接口触发频率限制（今日第 ${this.tripCountToday} 次），风控剩余约 ${Math.ceil(
        this.getRemainingMs() / 3600e3,
      )} 小时`,
    );
    await this.persist();
  }

  // ========== 仪表盘查询 ==========

  getStatus(accountId = ''): RateLimitStatus {
    // 生效的熔断截止时间 = 全局熔断 与 该账号熔断 取较晚者
    const acctUntil = accountId
      ? this.accountRateLimitMap.get(accountId) || 0
      : 0;
    const until = Math.max(this.rateLimitedUntil, acctUntil);
    const remaining = until - Date.now();
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyReqDate !== today) {
      this.dailyReqDate = today;
      this.dailyReqCount = 0;
    }
    const articleLeft = Math.ceil(
      (this.lastArticleReqAt + ARTICLE_MIN_INTERVAL - Date.now()) / 1e3,
    );
    const searchLeft = Math.ceil(
      (this.lastSearchReqAt + SEARCH_MIN_INTERVAL - Date.now()) / 1e3,
    );
    return {
      limited: remaining > 0,
      retryAfterSec: remaining > 0 ? Math.ceil(remaining / 1e3) : 0,
      rateLimitRemainHours: Math.ceil(this.getRemainingMs() / 3600e3),
      dailyCount: this.dailyReqCount,
      dailyLimit: DAILY_LIMIT,
      throttledSec: Math.max(articleLeft, searchLeft, 0),
      minIntervalSec: Math.max(articleLeft, searchLeft, 0),
    };
  }

  getRemainingMs(): number {
    if (this.rateLimitStartedAt <= 0) return 0;
    const elapsed = Date.now() - this.rateLimitStartedAt;
    return Math.max(0, RATE_LIMIT_TOTAL_MS - elapsed);
  }

  getTodayTripCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.tripDate !== today) {
      this.tripDate = today;
      this.tripCountToday = 0;
    }
    return this.tripCountToday;
  }

  // ========== 多账号查询 ==========

  isAccountAvailable(accountId: string): boolean {
    const limitedUntil = this.accountRateLimitMap.get(accountId) || 0;
    if (Date.now() < limitedUntil) return false;
    const daily = this.accountDailyCountMap.get(accountId) || 0;
    return daily < DAILY_LIMIT;
  }

  getAccountDailyCount(accountId: string): number {
    return this.accountDailyCountMap.get(accountId) || 0;
  }
}
