import { RateLimiter, RateLimitStatus } from './rate-limiter.service';

const mockPrisma = {
  mpState: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.mpState.findUnique.mockResolvedValue(null);
    mockPrisma.mpState.upsert.mockResolvedValue({});
    limiter = new RateLimiter(mockPrisma as any);
  });

  describe('restore', () => {
    it('无历史状态时不报错', async () => {
      mockPrisma.mpState.findUnique.mockResolvedValueOnce(null);
      await expect(limiter.restore()).resolves.toBeUndefined();
    });

    it('有未来到期时间则 isRateLimited=true', async () => {
      const future = BigInt(Date.now() + 3600e3);
      mockPrisma.mpState.findUnique.mockResolvedValueOnce({
        rateLimitedUntil: future,
        rateLimitStartedAt: BigInt(0),
        dailyReqDate: '',
        dailyReqCount: 0,
        lastArticleReq: BigInt(0),
        lastSearchReq: BigInt(0),
        tripDate: '',
        tripCount: 0,
        lastSyncAllAt: BigInt(0),
      });
      await limiter.restore();
      expect(limiter.isRateLimited()).toBe(true);
    });
  });

  describe('isRateLimited', () => {
    it('初始状态不是限流', () => {
      expect(limiter.isRateLimited()).toBe(false);
    });
  });

  describe('canRequest', () => {
    it('首次请求允许通过', async () => {
      expect(await limiter.canRequest('search')).toBe(true);
    });

    it('同类型请求间隔不足时拒绝', async () => {
      await limiter.canRequest('article');
      expect(await limiter.canRequest('article')).toBe(false);
    });

    it('不同类型请求各自独立', async () => {
      await limiter.canRequest('article');
      expect(await limiter.canRequest('search')).toBe(true);
    });

    it('per-account 日计数递增（跨类型请求各自过速率控制）', async () => {
      await limiter.canRequest('article', 'acc-1');
      await limiter.canRequest('search', 'acc-1');
      expect(limiter.getAccountDailyCount('acc-1')).toBe(2);
    });
  });

  describe('trip', () => {
    it('熔断后 isRateLimited 返回 true', async () => {
      await limiter.trip('acc-1');
      expect(limiter.isRateLimited('acc-1')).toBe(true);
    });

    it('熔断账号不可用，其他账号不受影响', async () => {
      await limiter.trip('acc-1');
      expect(limiter.isAccountAvailable('acc-1')).toBe(false);
      expect(limiter.isAccountAvailable('acc-2')).toBe(true);
    });

    it('连续熔断计数递增', async () => {
      await limiter.trip();
      expect(limiter.getTodayTripCount()).toBe(1);
      await limiter.trip();
      expect(limiter.getTodayTripCount()).toBe(2);
    });

    it('风控倒计时 > 0', async () => {
      await limiter.trip();
      expect(limiter.getRemainingMs()).toBeGreaterThan(0);
    });
  });

  describe('getStatus', () => {
    it('初始状态 limited=false dailyCount=0', () => {
      const s: RateLimitStatus = limiter.getStatus();
      expect(s.limited).toBe(false);
      expect(s.dailyCount).toBe(0);
      expect(s.dailyLimit).toBe(100);
    });

    it('账号熔断后该账号 limited=true', async () => {
      await limiter.trip('acc-1');
      const s = limiter.getStatus('acc-1');
      expect(s.limited).toBe(true);
      expect(s.retryAfterSec).toBeGreaterThan(0);
    });
  });

  describe('isAccountAvailable', () => {
    it('新鲜账号可用', () => {
      expect(limiter.isAccountAvailable('new')).toBe(true);
    });

    it('熔断后不可用', async () => {
      await limiter.trip('heavy');
      expect(limiter.isAccountAvailable('heavy')).toBe(false);
    });
  });

  describe('persist', () => {
    it('调用 prisma upsert', async () => {
      await limiter.persist();
      expect(mockPrisma.mpState.upsert).toHaveBeenCalled();
    });
  });

  describe('sync time', () => {
    it('setLastSyncAll 写入并返回', async () => {
      const ts = Date.now();
      await limiter.setLastSyncAll(ts);
      expect(limiter.getLastSyncAll()).toBe(ts);
    });
  });

  describe('pipeline', () => {
    it('默认使用方案1并可持久化切换到方案2', async () => {
      expect(limiter.getActivePipeline()).toBe(1);
      await limiter.setActivePipeline(2);
      expect(limiter.getActivePipeline()).toBe(2);
      expect(mockPrisma.mpState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { activePipeline: 2 },
        }),
      );
    });

    it('从数据库恢复方案2', async () => {
      mockPrisma.mpState.findUnique.mockResolvedValueOnce({
        rateLimitedUntil: BigInt(0),
        rateLimitStartedAt: BigInt(0),
        dailyReqDate: '',
        dailyReqCount: 0,
        lastArticleReq: BigInt(0),
        lastSearchReq: BigInt(0),
        tripDate: '',
        tripCount: 0,
        lastSyncAllAt: BigInt(0),
        activePipeline: 2,
      });
      await limiter.restore();
      expect(limiter.getActivePipeline()).toBe(2);
    });
  });
});
