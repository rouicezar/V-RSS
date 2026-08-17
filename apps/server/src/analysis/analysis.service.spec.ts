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
    service = new AnalysisService(mockPrisma as any, { emit: jest.fn() } as any);
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

  describe('collectHotTopics', () => {
    const now = Math.floor(Date.now() / 1e3);
    const mk = (
      id: string,
      mpId: string,
      tags: string[],
      publishTime = now - 100,
    ) => ({
      id,
      mpId,
      title: `文章${id}`,
      publishTime,
      url: `https://mp.weixin.qq.com/s/${id}`,
      tags: tags.map((name) => ({ tag: { name } })),
    });

    beforeEach(() => {
      mockPrisma.feed.findMany.mockResolvedValue([
        { id: 'mpA', mpName: '公众号A' },
        { id: 'mpB', mpName: '公众号B' },
        { id: 'mpC', mpName: '公众号C' },
      ]);
    });

    it('多公众号同标签 → 热点主题', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        mk('a1', 'mpA', ['AI Agent']),
        mk('a2', 'mpB', ['AI Agent']),
        mk('a3', 'mpC', ['其他']),
      ]);
      const topics = await service.collectHotTopics();
      expect(topics).toHaveLength(1);
      expect(topics[0].tag).toBe('AI Agent');
      expect(topics[0].mpCount).toBe(2);
      expect(topics[0].articleCount).toBe(2);
      expect(topics[0].mpNames).toEqual(expect.arrayContaining(['公众号A', '公众号B']));
    });

    it('同源 ≥3 篇同标签 → 热点主题（深耕信号）', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        mk('b1', 'mpA', ['知识库']),
        mk('b2', 'mpA', ['知识库']),
        mk('b3', 'mpA', ['知识库']),
        mk('b4', 'mpB', ['其他']),
      ]);
      const topics = await service.collectHotTopics();
      expect(topics).toHaveLength(1);
      expect(topics[0].tag).toBe('知识库');
      expect(topics[0].mpCount).toBe(1);
      expect(topics[0].articleCount).toBe(3);
    });

    it('单篇标签 / 同源仅 1-2 篇 → 不入选', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        mk('c1', 'mpA', ['冷门']),
        mk('c2', 'mpA', ['冷门']),
        mk('c3', 'mpB', ['另一个']),
      ]);
      const topics = await service.collectHotTopics();
      expect(topics).toHaveLength(0);
    });

    it('多源主题优先排序（源数×3 + 文章数）', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        mk('d1', 'mpA', ['主题X']),
        mk('d2', 'mpB', ['主题X']),
        mk('d3', 'mpC', ['主题X']),
        mk('e1', 'mpA', ['主题Y']),
        mk('e2', 'mpB', ['主题Y']),
      ]);
      const topics = await service.collectHotTopics();
      expect(topics[0].tag).toBe('主题X');
      expect(topics[1].tag).toBe('主题Y');
    });
  });
});
