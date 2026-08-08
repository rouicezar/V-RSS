import { AnalysisService } from './analysis.service';

const mockPrisma = {
  article: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tag: { findMany: jest.fn(), upsert: jest.fn() },
  articleTag: { deleteMany: jest.fn(), upsert: jest.fn() },
  skillRadar: { deleteMany: jest.fn(), create: jest.fn() },
  analysisReport: { create: jest.fn() },
  learningPlan: { create: jest.fn() },
  knowledgeBase: { create: jest.fn(), findMany: jest.fn() },
  feed: { findMany: jest.fn() },
  $transaction: jest
    .fn()
    .mockImplementation((ops: any[]) =>
      Promise.all(Array.isArray(ops) ? ops.map(() => ({})) : []),
    ),
};

describe('AnalysisService', () => {
  let service: AnalysisService;

  beforeEach(() => {
    service = new AnalysisService(mockPrisma as any);
    jest.clearAllMocks();
  });

  describe('computeRadar', () => {
    it('空文章时返回空数组', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([]);
      mockPrisma.skillRadar.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.$transaction.mockResolvedValueOnce([]);
      const radar = await service.computeRadar();
      expect(radar).toEqual([]);
    });

    it('根据标签 + 收藏权重计算得分并降序排列', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        {
          isFavorite: true,
          mpId: 'mp1',
          tags: [{ tag: { name: 'Python', category: '编程开发' } }],
        },
        {
          isFavorite: true,
          mpId: 'mp1',
          tags: [{ tag: { name: 'Python', category: '编程开发' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp2',
          tags: [{ tag: { name: '产品', category: '' } }],
        },
        {
          isFavorite: true,
          mpId: 'mp2',
          tags: [{ tag: { name: '产品', category: '' } }],
        },
      ]);
      mockPrisma.skillRadar.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.$transaction.mockImplementation(
        (ops: Array<Promise<unknown>>) => Promise.all(ops),
      );
      const radar = await service.computeRadar();
      expect(radar.length).toBeGreaterThan(0);
      expect(radar[0].score).toBeGreaterThanOrEqual(
        radar[radar.length - 1].score,
      );
      expect(radar[0]).toHaveProperty('dimension');
      expect(radar[0]).toHaveProperty('score');
      expect(radar[0]).toHaveProperty('articleCount');
    });

    it('收藏文章多的维度得分更高', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        {
          isFavorite: true,
          mpId: 'mp1',
          tags: [{ tag: { name: 'AI', category: '人工智能' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp1',
          tags: [{ tag: { name: 'AI', category: '人工智能' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp1',
          tags: [{ tag: { name: 'AI', category: '人工智能' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp1',
          tags: [{ tag: { name: 'AI', category: '人工智能' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp2',
          tags: [{ tag: { name: 'Design', category: '设计' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp2',
          tags: [{ tag: { name: 'Design', category: '设计' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp2',
          tags: [{ tag: { name: 'Design', category: '设计' } }],
        },
        {
          isFavorite: false,
          mpId: 'mp2',
          tags: [{ tag: { name: 'Design', category: '设计' } }],
        },
      ]);
      mockPrisma.skillRadar.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.$transaction.mockImplementation(
        (ops: Array<Promise<unknown>>) => Promise.all(ops),
      );
      const radar = await service.computeRadar();
      const ai = radar.find((r) => r.dimension === '人工智能');
      const design = radar.find((r) => r.dimension === '设计');
      expect(ai!.score).toBeGreaterThan(design!.score);
    });

    it('无标签文章归类为"未归类"', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        { isFavorite: false, mpId: 'mp1', tags: [] },
      ]);
      mockPrisma.skillRadar.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.$transaction.mockResolvedValueOnce([]);
      const radar = await service.computeRadar();
      expect(radar[0].dimension).toBe('未归类');
    });

    it('最多返回 Top 8', async () => {
      const articles = Array.from({ length: 20 }, (_, i) => ({
        isFavorite: false,
        mpId: `mp${i}`,
        tags: [{ tag: { name: `标签${i}`, category: '' } }],
      }));
      mockPrisma.article.findMany.mockResolvedValueOnce(articles);
      mockPrisma.skillRadar.deleteMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.$transaction.mockImplementation(
        (ops: Array<Promise<unknown>>) => Promise.all(ops),
      );
      const radar = await service.computeRadar();
      expect(radar.length).toBeLessThanOrEqual(8);
    });
  });

  describe('listKnowledgeBase', () => {
    it('返回知识沉淀列表', async () => {
      const items = [
        {
          id: 1,
          title: 'kb1',
          content: '...',
          articleCount: 5,
          imageCount: 2,
          createdAt: new Date(),
        },
      ];
      mockPrisma.knowledgeBase.findMany.mockResolvedValueOnce(items);
      const result = await service.listKnowledgeBase();
      expect(result).toBe(items);
    });
  });
});
