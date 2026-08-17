import { ArticleService } from './article.service';

const mockArticleFindUnique = jest.fn();

const mockPrisma = {
  article: {
    findUnique: mockArticleFindUnique,
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

// 阻止实际网络请求
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn().mockRejectedValue(new Error('no network')) },
}));

describe('ArticleService', () => {
  let service: ArticleService;

  beforeEach(() => {
    service = new ArticleService(mockPrisma as any, { emit: jest.fn() } as any);
    jest.clearAllMocks();
    mockArticleFindUnique.mockResolvedValue(null);
  });

  describe('cleanArticleHtml', () => {
    it('提取 rich_media_content 区域并清洗 data-src/opacity/visibility', () => {
      const html =
        '<html><body><div class="rich_media_content"><p>正文内容</p><img data-src="https://img.xx" style="opacity: 0 !important;"></div></body></html>';
      const result = service.cleanArticleHtml(html);
      expect(result).toContain('正文内容');
      expect(result).toContain('src=');
      expect(result).not.toContain('data-src=');
      expect(result).not.toContain('opacity: 0 !important');
    });

    it('空字符串时 minify 不抛异常', () => {
      const result = service.cleanArticleHtml('');
      expect(typeof result).toBe('string');
    });

    it('移除 visibility:hidden', () => {
      const html =
        '<div class="rich_media_content"><p style="visibility: hidden;">隐藏</p></div>';
      const result = service.cleanArticleHtml(html);
      expect(result).not.toContain('visibility: hidden');
    });
  });

  describe('htmlToText', () => {
    it('提取 HTML 为纯文本', () => {
      const text = service.htmlToText(
        '<html><body><p>第一段</p><p>第二段</p></body></html>',
      );
      expect(text).toContain('第一段');
      expect(text).toContain('第二段');
    });

    it('空字符串返回空', () => {
      expect(service.htmlToText('')).toBe('');
    });

    it('HTML 标签被移除', () => {
      const text = service.htmlToText('<div><span>clean</span></div>');
      expect(text).toContain('clean');
      expect(text).not.toContain('<span>');
    });

    it('超过 6000 字符截断', () => {
      const long = `<html><body>${'x'.repeat(7000)}</body></html>`;
      const text = service.htmlToText(long);
      expect(text.length).toBeLessThanOrEqual(6000);
    });
  });

  describe('fetchArticleContent', () => {
    it('命中数据库缓存时直接返回', async () => {
      const cached = '<p>已缓存的正文</p>';
      mockPrisma.article.findUnique.mockResolvedValueOnce({ content: cached });
      const result = await service.fetchArticleContent('test-id');
      expect(result).toBe(cached);
    });

    it('数据库无记录时尝试抓取（网络不可达返回空）', async () => {
      mockPrisma.article.findUnique.mockResolvedValueOnce(null);
      const result = await service.fetchArticleContent('no-cache-id');
      expect(result).toBe('');
    });
  });

  describe('backfillMissingContent', () => {
    it('无缺失正文时返回 total=0', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([]);
      const result = await service.backfillMissingContent(5, 0);
      expect(result.total).toBe(0);
      expect(result.filled).toBe(0);
    });

    it('有缺失但网络不可达时 total>0 filled=0', async () => {
      mockPrisma.article.findMany.mockResolvedValueOnce([
        { id: 'a1', url: null },
      ]);
      const result = await service.backfillMissingContent(1, 0);
      expect(result.total).toBe(1);
      expect(result.filled).toBe(0);
    });
  });
});
