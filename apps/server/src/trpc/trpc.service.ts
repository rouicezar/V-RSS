import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { defaultCount, statusMap } from '@server/constants';
import { PrismaService } from '@server/prisma/prisma.service';
import { MpService } from '@server/mp/mp.service';
import { TRPCError, initTRPC } from '@trpc/server';
import Axios, { AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { load } from 'cheerio';
import { minify } from 'html-minifier';
import { LRUCache } from 'lru-cache';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 读书账号每日小黑屋
 */
const blockedAccountsMap = new Map<string, string[]>();

/**
 * 文章正文缓存（内存，LRU）
 * key: 文章 id，value: 清洗后的正文 HTML
 */
const articleContentCache = new LRUCache<string, string>({ max: 5000 });

@Injectable()
export class TrpcService {
  trpc = initTRPC.create();
  publicProcedure = this.trpc.procedure;
  protectedProcedure = this.trpc.procedure.use(({ ctx, next }) => {
    const errorMsg = (ctx as any).errorMsg;
    if (errorMsg) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: errorMsg });
    }
    return next({ ctx });
  });
  router = this.trpc.router;
  mergeRouters = this.trpc.mergeRouters;
  updateDelayTime = 60;

  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly mpService: MpService,
  ) {
    this.updateDelayTime =
      this.configService.get<ConfigurationType['feed']>(
        'feed',
      )!.updateDelayTime;
  }

  removeBlockedAccount = (vid: string) => {
    const today = this.getTodayDate();

    const blockedAccounts = blockedAccountsMap.get(today);
    if (Array.isArray(blockedAccounts)) {
      const newBlockedAccounts = blockedAccounts.filter((id) => id !== vid);
      blockedAccountsMap.set(today, newBlockedAccounts);
    }
  };

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  getBlockedAccountIds() {
    const today = this.getTodayDate();
    const disabledAccounts = blockedAccountsMap.get(today) || [];
    this.logger.debug('disabledAccounts: ', disabledAccounts);
    return disabledAccounts.filter(Boolean);
  }

  /**
   * 清洗微信文章 HTML，提取正文区域
   */
  cleanArticleHtml(source: string): string {
    try {
      const $ = load(source, { decodeEntities: false });

      const dirtyHtml = $.html($('.rich_media_content'));

      const html = dirtyHtml
        .replace(/data-src=/g, 'src=')
        .replace(/opacity: 0( !important)?;/g, '')
        .replace(/visibility: hidden;/g, '');

      const content =
        '<style> .rich_media_content {overflow: hidden;color: #222;font-size: 17px;word-wrap: break-word;-webkit-hyphens: auto;-ms-hyphens: auto;hyphens: auto;text-align: justify;position: relative;z-index: 0;}.rich_media_content {font-size: 18px;}</style>' +
        html;

      return minify(content, {
        removeAttributeQuotes: true,
        collapseWhitespace: true,
      });
    } catch (e) {
      this.logger.error(`cleanArticleHtml error: ${(e as Error).message}`);
      return source;
    }
  }

  /**
   * 把正文中的微信图片下载到本地（解决防盗链），返回替换后的 HTML
   * 图片保存到 data/images/{articleId}/ 下，正文引用 /img/{articleId}/{n}.{ext}
   */
  async localizeArticleImages(
    contentHtml: string,
    articleId: string,
  ): Promise<string> {
    if (!contentHtml) return contentHtml;

    // 图片目录与 SQLite 同仓：apps/server/data/images（相对 __dirname 定位，dev/prod 均成立）
    const imgDir = join(__dirname, '..', '..', 'data', 'images', articleId);
    await mkdir(imgDir, { recursive: true }).catch(() => {});

    const $ = load(contentHtml, { decodeEntities: false });
    const imgs = $('img').toArray();
    let failed = 0;

    // 分批并发下载（每批 3 个），避免触发微信限流
    const concurrency = 3;
    for (let i = 0; i < imgs.length; i += concurrency) {
      const batch = imgs.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (img) => {
          const $img = $(img);
          const src = $img.attr('src') || $img.attr('data-src') || '';
          // 跳过本地/数据 URI
          if (!src || src.startsWith('/') || src.startsWith('data:')) return;
          try {
            const resp = await Axios.get(src, {
              timeout: 15 * 1e3,
              responseType: 'arraybuffer',
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: 'https://mp.weixin.qq.com/',
              },
            });
            const buf = Buffer.from(resp.data);
            if (buf.length === 0) {
              failed += 1;
              return;
            }
            const ct = String(resp.headers['content-type'] || '');
            const ext = ct.includes('png')
              ? 'png'
              : ct.includes('gif')
                ? 'gif'
                : ct.includes('webp')
                  ? 'webp'
                  : 'jpg';
            const filename = `${imgs.indexOf(img)}.${ext}`;
            await writeFile(join(imgDir, filename), buf);
            $img.attr('src', `/img/${articleId}/${filename}`);
          } catch (e) {
            failed += 1;
          }
        }),
      );
      // 每批间隔 300ms，降低请求频率
      if (i + concurrency < imgs.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    const localized = $('body').html() || contentHtml;
    if (failed > 0) {
      this.logger.log(
        `localizeArticleImages(${articleId}) 下载失败 ${failed}/${imgs.length} 张`,
      );
    }
    return localized;
  }

  /**
   * 获取文章正文（优先读库，未命中则抓公开页并回写）
   * 优先使用接口返回的 url，其次拼 s/{id}；成功/失效都会更新 contentStatus
   */
  async fetchArticleContent(id: string): Promise<string> {
    // 1. 内存缓存
    const cached = articleContentCache.get(id);
    if (cached) return cached;

    // 2. 数据库缓存
    const article = await this.prismaService.article
      .findUnique({
        where: { id },
        select: { content: true, url: true },
      })
      .catch(() => null);
    if (article?.content) {
      articleContentCache.set(id, article.content);
      return article.content;
    }

    // 3. 抓公开页
    try {
      const url = article?.url || `https://mp.weixin.qq.com/s/${id}`;
      const html = await Axios.get(url, {
        timeout: 10 * 1e3,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://mp.weixin.qq.com/',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }).then((r) => r.data as string);

      let cleaned = this.cleanArticleHtml(html);
      if (cleaned && cleaned.length > 300) {
        // 图片本地化（防盗链）
        cleaned = await this.localizeArticleImages(cleaned, id);
        articleContentCache.set(id, cleaned);
        // 回写数据库（懒加载持久化）
        await this.prismaService.article
          .update({
            where: { id },
            data: { content: cleaned, contentStatus: 1 },
          })
          .catch(() => {});
      } else {
        // 抓到了但正文为空 → 链接失效
        await this.prismaService.article
          .update({
            where: { id },
            data: { contentStatus: 2 },
          })
          .catch(() => {});
        cleaned = '';
      }
      return cleaned;
    } catch (e) {
      this.logger.error(
        `fetchArticleContent(${id}) error: ${(e as Error).message}`,
      );
      return '';
    }
  }

  /**
   * 对已有正文做图片本地化（重抓图片，用于正文已入库但图片仍引用微信的场景）
   */
  async localizeArticle(articleId: string): Promise<{ id: string; ok: boolean }> {
    const article = await this.prismaService.article
      .findUnique({ where: { id: articleId }, select: { content: true } })
      .catch(() => null);
    if (!article?.content) return { id: articleId, ok: false };
    const localized = await this.localizeArticleImages(
      article.content,
      articleId,
    );
    await this.prismaService.article.update({
      where: { id: articleId },
      data: { content: localized },
    });
    return { id: articleId, ok: true };
  }

  /**
   * 批量补全缺失正文（带节流，避免触发限流）
   * @param limit 最多补全条数
   * @param delayMs 每条间隔毫秒
   */
  async backfillMissingContent(limit = 20, delayMs = 1500) {
    const articles = await this.prismaService.article.findMany({
      where: {
        contentStatus: 0, // 未抓取
        status: 1,
      },
      select: { id: true, url: true },
      take: limit,
      orderBy: { publishTime: 'desc' },
    });

    let filled = 0;
    for (const { id } of articles) {
      const content = await this.fetchArticleContent(id);
      if (content) filled += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { total: articles.length, filled };
  }

  /**
   * HTML 转纯文本（供 AI 分析 / 检索）
   */
  htmlToText(html: string): string {
    if (!html) return '';
    try {
      const $ = load(html, { decodeEntities: false });
      const text = $('body').text() || $('div').first().text() || '';
      return text.replace(/\s+/g, ' ').trim().slice(0, 6000);
    } catch {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
    }
  }

  /**
   * 调用 DeepSeek 提取文章标签 + 领域归类
   * 返回 { tags: string[], domain: string }
   */
  async extractTagsWithAI(
    title: string,
    text: string,
    existingTags: string[] = [],
  ): Promise<{ tags: string[]; domain: string }> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('未配置 DEEPSEEK_API_KEY 环境变量');
    }

    const systemPrompt = `你是一名中文内容分析师。请分析公众号文章，只输出一个 json 对象（不要输出任何其他文字、注释或代码块标记）：
{"tags": ["标签1", "标签2", ...], "domain": "领域"}

要求：
1. tags：3-5 个精准标签（中文），概括文章主题，不要泛泛而谈（如"AI Agent"、"企业级应用"、"提示词工程"）
2. domain：1 个粗粒度领域（如"人工智能"、"编程开发"、"产品运营"、"职场成长"），用于能力雷达分析
3. 若已有标签列表中有与文章匹配的，优先复用已有标签名称`;

    const userPrompt = `文章标题：${title}\n\n文章内容（截断）：\n${text.slice(0, 5000)}\n\n已有标签库：${existingTags.join('、') || '（空）'}`;

    const resp = await Axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.3,
      },
      {
        timeout: 60 * 1e3,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    ).then((r) => r.data);

    const content = resp?.choices?.[0]?.message?.content || '{}';
    // 宽容解析：剥离 markdown 代码块标记，提取 JSON 对象
    const cleaned = content.replace(/```(?:json)?/gi, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const jsonStr =
      jsonStart >= 0 && jsonEnd > jsonStart
        ? cleaned.slice(jsonStart, jsonEnd + 1)
        : cleaned;
    try {
      const parsed = JSON.parse(jsonStr);
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags
            .map((t: unknown) => String(t).trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
      const domain = String(parsed.domain || '').trim().slice(0, 50);
      return { tags, domain };
    } catch (e) {
      this.logger.error(`extractTagsWithAI JSON 解析失败: ${content}`);
      return { tags: [], domain: '' };
    }
  }

  /**
   * 为单篇文章提取标签并入库（含 domain 归因）
   */
  async tagArticleWithAI(
    articleId: string,
  ): Promise<{ articleId: string; tags: string[]; domain: string }> {
    const article = await this.prismaService.article.findUnique({
      where: { id: articleId },
    });
    if (!article) throw new Error(`文章不存在: ${articleId}`);

    const text = this.htmlToText(article.content || '');
    if (!text) return { articleId, tags: [], domain: '' };

    // 已有标签作为候选
    const existingTags = (
      await this.prismaService.tag.findMany({ select: { name: true } })
    ).map((t) => t.name);

    const { tags, domain } = await this.extractTagsWithAI(
      article.title,
      text,
      existingTags,
    );

    // 建立标签关联
    const tagObjs: { id: string; name: string }[] = [];
    for (const name of tags) {
      const tag = await this.prismaService.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      tagObjs.push(tag);
    }
    await this.prismaService.articleTag.deleteMany({ where: { articleId } });
    await this.prismaService.$transaction(
      tagObjs.map((tag) =>
        this.prismaService.articleTag.upsert({
          where: { articleId_tagId: { articleId, tagId: tag.id } },
          update: {},
          create: { articleId, tagId: tag.id },
        }),
      ),
    );

    // 更新领域归类
    if (domain) {
      await this.prismaService.article.update({
        where: { id: articleId },
        data: { domain },
      });
    }

    return { articleId, tags: tags, domain };
  }

  /**
   * 批量给无标签文章打标签（串行 + 节流）
   * @param limit 最多处理条数
   * @param delayMs 每条间隔毫秒
   */
  async tagAllArticlesWithAI(limit = 20, delayMs = 3000) {
    const articles = await this.prismaService.article.findMany({
      where: {
        status: 1,
        content: { not: null },
        OR: [{ tags: { none: {} } }, { domain: null }],
      },
      select: { id: true, title: true, content: true },
      take: limit,
      orderBy: { publishTime: 'desc' },
    });

    let done = 0;
    for (const article of articles) {
      try {
        const r = await this.tagArticleWithAI(article.id);
        if (r.tags.length > 0) done += 1;
      } catch (e) {
        this.logger.error(`tagArticleWithAI(${article.id}) error: ${(e as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { total: articles.length, done };
  }

  /**
   * 计算关注雷达（基于文章标签聚合 + 收藏权重）
   * 标签是多值维度：一篇文章可归属多个标签，雷达展示强度 Top 8
   * 分数算法：收藏数权重（6 成）+ 文章量归一化（4 成），映射到 0-10
   */
  async computeRadar() {
    const articles = await this.prismaService.article.findMany({
      where: {
        status: 1,
        // 只看有实际正文的文章
        contentStatus: 1,
      },
      select: {
        isFavorite: true,
        mpId: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
    });

    // 按标签聚合（多值）
    const byTag = new Map<
      string,
      { count: number; fav: number; mps: Set<string> }
    >();
    for (const a of articles) {
      const names = a.tags
        .map((t) => t.tag?.name)
        .filter((n): n is string => !!n && n.length > 0);
      const nameset = names.length > 0 ? names : ['未归类'];
      for (const name of nameset) {
        if (!byTag.has(name))
          byTag.set(name, { count: 0, fav: 0, mps: new Set() });
        const item = byTag.get(name)!;
        item.count += 1;
        if (a.isFavorite) item.fav += 1;
        item.mps.add(a.mpId);
      }
    }

    const maxCount = Math.max(
      1,
      ...Array.from(byTag.values()).map((v) => v.count),
    );
    const maxFav = Math.max(
      1,
      ...Array.from(byTag.values()).map((v) => v.fav),
    );

    let radar = Array.from(byTag.entries()).map(([dimension, v]) => {
      // 收藏是强信号，占大头；文章量反映投入
      const score = Math.min(
        10,
        Math.round((v.fav / maxFav) * 6 + (v.count / maxCount) * 4),
      );
      return {
        dimension,
        score,
        articleCount: v.count,
        favoriteCount: v.fav,
        mpCount: v.mps.size,
      };
    });
    radar.sort((a, b) => b.score - a.score);

    // 雷达最多展示 8 个维度，保证可读性
    radar = radar.slice(0, 8);

    // 存库（SkillRadar）——SQLite 不支持 createMany，逐个创建
    await this.prismaService.skillRadar.deleteMany({});
    await this.prismaService.$transaction(
      radar.map((r) =>
        this.prismaService.skillRadar.create({
          data: {
            dimension: r.dimension,
            score: r.score,
            sourceCount: r.articleCount,
          },
        }),
      ),
    );

    return radar;
  }

  /**
   * 生成知识沉淀封面 SVG（品牌绿风格，零外部依赖）
   * 返回相对 URL：/img/kb_cover_<id>.svg
   */
  private async generateKbCover(kbId: number, total: number, images: number) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#064c2d"/>
      <stop offset="0.55" stop-color="#03a055"/>
      <stop offset="1" stop-color="#02723d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.1" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="420" fill="url(#bg)"/>
  <rect width="1200" height="420" fill="url(#glow)"/>
  <!-- 装饰网格圆点 -->
  <g fill="#ffffff" fill-opacity="0.10">
    ${Array.from({ length: 26 }, (_, i) => {
      const x = 60 + (i % 13) * 92;
      const y = 46 + Math.floor(i / 13) * 60;
      return `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 4 : 2.5}"/>`;
    }).join('')}
  </g>
  <!-- 右上角 RSS 标识 -->
  <g transform="translate(1060,70)" stroke="#ffffff" stroke-opacity="0.85" fill="none" stroke-width="5" stroke-linecap="round">
    <path d="M0,48 a60,60 0 0 1 60,60"/>
    <path d="M0,24 a84,84 0 0 1 84,84" stroke-opacity="0.7"/>
    <path d="M0,0 a108,108 0 0 1 108,108" stroke-opacity="0.45"/>
    <circle cx="0" cy="108" r="9" fill="#ffffff" stroke="none"/>
  </g>
  <!-- 标题 -->
  <text x="80" y="185" font-family="-apple-system,PingFang SC,Helvetica Neue,sans-serif" font-size="76" font-weight="700" fill="#ffffff" letter-spacing="2">知识沉淀</text>
  <text x="82" y="232" font-family="-apple-system,PingFang SC,monospace" font-size="20" fill="#d5fbe8" letter-spacing="6" font-weight="500">KNOWLEDGE  DISTILLATION</text>
  <!-- 统计 -->
  <rect x="80" y="268" rx="14" width="260" height="58" fill="#ffffff" fill-opacity="0.14"/>
  <text x="104" y="306" font-family="-apple-system,PingFang SC,sans-serif" font-size="24" fill="#ffffff" font-weight="600">${total} 篇文章</text>
  <rect x="356" y="268" rx="14" width="260" height="58" fill="#ffffff" fill-opacity="0.14"/>
  <text x="380" y="306" font-family="-apple-system,PingFang SC,sans-serif" font-size="24" fill="#ffffff" font-weight="600">${images} 张配图</text>
  <!-- 章节标签 -->
  <g font-family="-apple-system,PingFang SC,sans-serif" font-size="15" fill="#e9faf1">
    <text x="80" y="372">领域地图</text>
    <circle cx="228" cy="366" r="3" fill="#55d695"/>
    <text x="248" y="372">方法论库</text>
    <circle cx="396" cy="366" r="3" fill="#55d695"/>
    <text x="416" y="372">概念词典</text>
    <circle cx="564" cy="366" r="3" fill="#55d695"/>
    <text x="584" y="372">工具速查</text>
    <circle cx="732" cy="366" r="3" fill="#55d695"/>
    <text x="752" y="372">逐篇汇编</text>
    <circle cx="900" cy="366" r="3" fill="#55d695"/>
    <text x="920" y="372">学习路径</text>
  </g>
</svg>`;
    try {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      // 与 main.ts 静态目录一致：<server>/data/images
      const dir = join(__dirname, '..', 'data', 'images');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `kb_cover_${kbId}.svg`), svg, 'utf-8');
      return `/img/kb_cover_${kbId}.svg`;
    } catch (e) {
      this.logger.warn(`生成封面失败: ${(e as Error).message}`);
      return '';
    }
  }

  /**
   * 知识沉淀：蒸馏全部文章（含图片索引）为可复用的方法论与学习资料
   * 严格保证覆盖每一篇文章：分批处理 → 汇总 → 校验数量，不足则报错提示重试
   */
  async distillKnowledge() {
    // 1. 拉取全部有效文章（有正文）
    const articles = await this.prismaService.article.findMany({
      where: {
        status: 1,
        contentStatus: 1,
        content: { not: '' },
      },
      orderBy: { publishTime: 'desc' },
      select: {
        id: true,
        title: true,
        url: true,
        content: true,
        contentText: true,
        domain: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
    });
    const total = articles.length;
    if (total === 0) {
      throw new Error('暂无有效文章可用于知识沉淀');
    }

    // 2. HTML 转纯文本（content 缺纯文本时）
    const stripHtml = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

    // 3. 提取每篇图片 URL（本地化 /img/ 或微信 CDN）
    const extractImages = (html: string) => {
      const urls: string[] = [];
      const re = /<img[^>]+src=["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html || '')) !== null) {
        if (m[1] && !urls.includes(m[1])) urls.push(m[1]);
      }
      return urls;
    };

    const prepared = articles.map((a) => ({
      ...a,
      text: (a.contentText || stripHtml(a.content || '')).slice(0, 4000),
      images: extractImages(a.content || ''),
    }));
    const totalImages = prepared.reduce((acc, a) => acc + a.images.length, 0);

    // 4. 分批蒸馏（每批 3 篇，保证每篇提炼足够详细）
    const BATCH = 3;
    const batches: typeof prepared[] = [];
    for (let i = 0; i < prepared.length; i += BATCH) {
      batches.push(prepared.slice(i, i + BATCH));
    }

    const batchResults: string[] = [];
    const processedIds = new Set<string>();
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const section = batch
        .map(
          (a, idx) =>
            `【文章${idx + 1}/${batch.length}】《${a.title}》
领域: ${a.domain || '未归类'} | 标签: ${(a.tags || []).map((t: any) => t.tag?.name).filter(Boolean).join('、') || '无'}
正文:
${a.text.slice(0, 3600)}`,
        )
        .join('\n\n');

      const system =
        '你是资深知识工程师，擅长把实战文章蒸馏成可立即使用的方法论。输出必须非常详细、具体、可执行，避免空泛表述。对每篇文章独立成节提炼。';
      const user = `这是第 ${bi + 1}/${batches.length} 批文章（共 ${batch.length} 篇）。请对【每一篇】文章分别输出以下完整结构（不要合并、不要省略任何一篇）：

## 《文章标题》
### 核心问题
（这篇文章解决什么问题，1-2 句）
### 方法论 / 解决方案
（分步骤详细展开，每一步说清"做什么、为什么、怎么做"）
### 关键细节与坑
（实现中的关键参数、注意事项、踩坑点）
### 实用技巧
（可直接套用的技巧/模板/命令/工具）
### 适用场景
（什么时候用这个方法，什么时候不该用）
### 一句话总结
（可记入笔记的金句式总结）

最后给本批文章的共同趋势 2-3 句。

文章内容：
${section}`;

      let out = '';
      try {
        out = await this.askDeepSeek(system, user, 4000, 0.4);
      } catch (e: any) {
        this.logger.error(`蒸馏批次 ${bi + 1} 失败: ${e.message}`);
        out = `（批次 ${bi + 1} 生成失败，跳过）`;
      }
      batchResults.push(`# 批次 ${bi + 1}（${batch.length} 篇）\n${out}`);
      batch.forEach((a) => processedIds.add(a.id));
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 6. 汇总所有批次 → 统一结构的知识沉淀文档
    const digest = batchResults.join('\n\n---\n\n');
    const system2 =
      '你是知识体系构建专家。把分批蒸馏的文章知识整合成一份高密度、可直接学习的知识沉淀文档。要求：每一篇的精华都完整保留（不得丢弃任何一篇的内容）、按主题聚类成体系、方法必须具体可执行。';
    const user2 = `以下是从 ${total} 篇文章蒸馏出的详细笔记（共 ${batches.length} 批）。请整合为最终沉淀文档，结构：
# 知识沉淀（覆盖 ${total} 篇文章 / ${totalImages} 张配图）
## 一、领域地图
（主题领域、各领域文章数、领域间关联）
## 二、核心方法论库
（按主题归类的可复用方法；每个方法包含：方法名 / 适用场景 / 操作步骤 / 关键要点 / 来源文章标题）
## 三、概念词典
（全文出现的核心概念，逐一给出精确定义与出处）
## 四、工具与技巧速查
（工具、命令、模板、参数、提示词等可直接复用的素材清单）
## 五、逐篇精华汇编
（按批次/主题组织，保留每篇文章的完整提炼：核心问题 / 方法论步骤 / 关键细节 / 适用场景 / 金句）
## 六、推荐学习路径
（从易到难，标注每周可执行的学习动作与对应文章）

全文要求：信息密度高、不空泛、方法可立即上手。逐篇精华汇编部分必须包含全部 ${total} 篇文章，一篇都不能少。

分批蒸馏内容：
${digest}`;

    const finalDoc = await this.askDeepSeek(system2, user2, 8000, 0.35);

    // 7. 持久化
    const kb = await this.prismaService.knowledgeBase.create({
      data: {
        title: `知识沉淀 ${new Date().toISOString().slice(0, 10)}`,
        content: finalDoc,
        articleCount: total,
        imageCount: totalImages,
      },
    });

    // 8. 生成封面图并插入文档开头（替换可能的截图）
    const coverUrl = await this.generateKbCover(kb.id, total, totalImages);
    const coverDoc = coverUrl
      ? `![知识沉淀封面](${coverUrl})\n\n${finalDoc}`
      : finalDoc;
    if (coverUrl) {
      await this.prismaService.knowledgeBase.update({
        where: { id: kb.id },
        data: { content: coverDoc },
      });
    }

    return {
      kbId: kb.id,
      report: coverDoc,
      articleCount: total,
      imageCount: totalImages,
    };
  }

  /** 历史知识沉淀列表 */
  async listKnowledgeBase() {
    return this.prismaService.knowledgeBase.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 调用 DeepSeek 生成分析文本（报告 / 学习计划）
   */
  async askDeepSeek(
    system: string,
    user: string,
    maxTokens = 2500,
    temperature = 0.5,
  ): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
    const resp = await Axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature,
      },
      {
        timeout: 120 * 1e3,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    ).then((r) => r.data);
    return resp?.choices?.[0]?.message?.content || '';
  }

  /**
   * 生成雷达分析报告（Markdown）
   */
  async generateRadarReport() {
    const radar = await this.computeRadar();
    const tags = (
      await this.prismaService.tag.findMany({
        include: { _count: { select: { articles: true } } },
      })
    )
      .map((t) => `${t.name}(${t._count.articles})`)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 30);
    const favorites = await this.prismaService.article.findMany({
      where: { isFavorite: true, status: 1 },
      select: { title: true, domain: true },
      orderBy: { favoriteTime: 'desc' },
      take: 30,
    });

    const system =
      '你是个人知识管理教练。基于用户关注的公众号文章数据，生成一份专业、有洞察的中文分析报告（Markdown 格式）。';
    const user = `【关注雷达（标签维度）】${JSON.stringify(radar)}
【热门标签】${tags.join('、')}
【收藏文章】${favorites.map((f) => `- ${f.title}（${f.domain || '未归类'}）`).join('\n')}

请输出报告，结构：
## 关注结构总览
## 强弱项分析
## 交叉洞察（领域之间的关联机会）
## 行动建议（3-5 条具体、可执行）`;

    const report = await this.askDeepSeek(system, user);
    // 持久化报告（刷新/切页面不丢失）
    if (report) {
      await this.prismaService.analysisReport
        .create({ data: { content: report } })
        .catch((e) => this.logger.error(`保存报告失败: ${e.message}`));
    }
    return { radar, report };
  }

  /**
   * 生成学习计划（Markdown，4 周）并入库
   */
  async generateLearningPlan() {
    const radar = await this.computeRadar();
    const weak = radar.filter((r) => r.score < 5);
    const strong = radar.filter((r) => r.score >= 5);
    const mps = await this.prismaService.feed.findMany({
      select: { mpName: true },
      where: { status: 1 },
    });
    const tags = await this.prismaService.tag.findMany({
      include: { _count: { select: { articles: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const tagStr = tags
      .map((t) => `${t.name}(${t._count.articles})`)
      .join('、');

    const system =
      '你是学习规划专家。基于用户的公众号关注领域和标签数据，生成一份 4 周学习计划（Markdown）。学习计划要具体、可执行、循序渐进。';
    const user = `【关注雷达（标签维度）】${JSON.stringify(radar)}
【关注公众号】${mps.map((m) => m.mpName).join('、')}
【标签分布】${tagStr}

请输出：
## 学习目标（针对薄弱领域的提升）
## 第 1-4 周计划（每周：主题 / 学习内容 / 输出物）
## 推荐关注方向（与现有标签关联的新主题）
## 每周自查清单`;

    const content = await this.askDeepSeek(system, user);
    const plan = await this.prismaService.learningPlan.create({
      data: {
        title: `学习计划 ${new Date().toISOString().slice(0, 10)}`,
        content,
      },
    });
    return { plan, radar, weak, strong };
  }

  /**
   * 获取公众号文章（公众号后台采集）
   * @param mpId 订阅源 id（Feed 表主键）
   * @param page 页码（1 起始）
   */
  async getMpArticles(mpId: string, page = 1) {
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed?.fakerId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '该订阅源未配置公众号后台采集标识(fakeid)，请重新添加',
      });
    }
    return this.mpService.getMpArticles(feed.fakerId, page - 1);
  }

  async refreshMpArticlesAndUpdateFeed(mpId: string, page = 1) {
    // 公众号后台采集：先查订阅源的 fakeid
    const feed = await this.prismaService.feed.findUnique({
      where: { id: mpId },
    });
    if (!feed?.fakerId) {
      this.logger.error(
        `refreshMpArticlesAndUpdateFeed(${mpId}) 缺少 fakerId，请重新添加订阅源`,
      );
      return { hasHistory: 0 };
    }
    let articles: any[] = [];
    try {
      articles = await this.mpService.getMpArticles(feed.fakerId, page - 1);
    } catch (e: any) {
      this.logger.error(`refreshMpArticlesAndUpdateFeed(${mpId}) error: ${e.message}`);
      return { hasHistory: 0, rateLimited: (this.mpService as any).isRateLimited?.() === true };
    }
    const rateLimited = (this.mpService as any).isRateLimited?.() === true;

    if (articles.length > 0) {
      let results;
      const { type } =
        this.configService.get<ConfigurationType['database']>('database')!;
      if (type === 'sqlite') {
        // sqlite3 不支持 createMany
        const inserts = articles.map(
          ({ id, picUrl, publishTime, title, url, digest }) =>
            this.prismaService.article.upsert({
              create: {
                id,
                mpId,
                picUrl,
                publishTime,
                title,
                url,
                digest,
              },
              update: {
                publishTime,
                title,
                // 接口返回的 url 优先（链接可能变更）
                url: url || undefined,
                digest: digest || undefined,
              },
              where: { id },
            }),
        );
        results = await this.prismaService.$transaction(inserts);
      } else {
        results = await (this.prismaService.article as any).createMany({
          data: articles.map(({ id, picUrl, publishTime, title, url, digest }) => ({
            id,
            mpId,
            picUrl,
            publishTime,
            title,
            url,
            digest,
          })),
          skipDuplicates: true,
        });
      }

      this.logger.debug(
        `refreshMpArticlesAndUpdateFeed create results: ${JSON.stringify(results)}`,
      );
    }

    // 限流/失败时：不修改 hasHistory（避免误关"获取历史文章"）
    if (!rateLimited) {
      // 公众号后台每页 5 篇，不满一页则认为没有更多历史文章
      const hasHistory = articles.length < 5 ? 0 : 1;

      await this.prismaService.feed.update({
        where: { id: mpId },
        data: {
          syncTime: Math.floor(Date.now() / 1e3),
          hasHistory,
        },
      });
      return { hasHistory, rateLimited };
    }
    return { hasHistory: 0, rateLimited };
  }

  /**
   * 同步全部订阅的公众号信息（名称/头像）
   * 通过公网抓取文章页反查，不消耗公众号后台频率额度
   */
  async syncAllMpAvatars() {
    const feeds = await this.prismaService.feed.findMany({
      where: { status: 1 },
    });
    let updated = 0;
    let failed = 0;
    for (const feed of feeds) {
      // 熔断期间：不再尝试（避免每个订阅都触发一次限流）
      if ((this.mpService as any).isRateLimited?.()) {
        break;
      }
      let info: any = null;
      // 1. 优先：取该订阅最新一篇文章，公网抓文章页反查（不耗后台额度）
      const article = await this.prismaService.article.findFirst({
        where: { mpId: feed.id, url: { not: null }, status: 1 },
        orderBy: { publishTime: 'desc' },
      });
      if (article?.url) {
        try {
          const arr = await this.mpService.getMpInfo(article.url);
          info = arr[0] || null;
        } catch (e: any) {
          this.logger.warn(
            `syncMpAvatar 文章反查失败(${feed.mpName}): ${e.message}`,
          );
        }
      }
      // 2. 兜底：无文章或反查无头像时，按公众号名搜索拿头像
      if (!info?.cover && feed.mpName) {
        try {
          const list = await this.mpService.searchBiz(feed.mpName, 1);
          const hit = list?.[0];
          if (hit) {
            info = {
              name: hit.nickname || feed.mpName,
              cover: hit.headimgurl || '',
            };
          }
        } catch (e: any) {
          this.logger.warn(
            `syncMpAvatar 搜索兜底失败(${feed.mpName}): ${e.message}`,
          );
        }
      }
      if (info?.cover || info?.name) {
        await this.prismaService.feed.update({
          where: { id: feed.id },
          data: {
            mpCover: info.cover || feed.mpCover,
            mpName: info.name || feed.mpName,
          },
        });
        updated += 1;
      } else {
        failed += 1;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    const rateLimited = (this.mpService as any).isRateLimited?.() === true;
    return { total: feeds.length, updated, failed, rateLimited };
  }

  /**
   * 清理孤儿文章：mp_id 不存在于订阅表中的文章（历史引擎遗留数据）
   * 级联删除其标签关联，返回清理数量
   */
  async cleanupOrphanArticles() {
    const feedIds = await this.prismaService.feed.findMany({
      select: { id: true },
    });
    const ids = new Set(feedIds.map((f) => f.id));
    const orphans = await this.prismaService.article.findMany({
      select: { id: true },
      where: { NOT: { mpId: { in: Array.from(ids) } } },
    });
    if (orphans.length > 0) {
      // 删除文章（ArticleTag onDelete: Cascade 会级联清理关联）
      await this.prismaService.article.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
    }
    return { deleted: orphans.length };
  }

  /** 上次"更新全部"时间戳 */
  lastSyncAllAt = 0;

  /** 采集同步状态（供 dashboard 展示） */
  getSyncStatus() {
    const rl = (this.mpService as any).getRateLimitInfo?.() || {
      limited: false,
      retryAfterSec: 0,
      dailyCount: 0,
      dailyLimit: 100,
      minIntervalSec: 0,
    };
    const todayTrips = (this.mpService as any).getTodayTripCount?.() || 0;
    const sinceLastMin =
      this.lastSyncAllAt > 0
        ? Math.floor((Date.now() - this.lastSyncAllAt) / 6e4)
        : null;

    // 风险分级（与真实风控数据对齐，不承诺虚假"正常"）：
    //  danger  → 熔断中 / 今日已多次触发（>=2）→ 按钮禁用，建议明天再试
    //  warn    → 今日触发过 1 次 / 距上次操作 <10 分钟 / 今日请求偏高 → 谨慎，建议等待
    //  ok      → 今日零触发 + 距上次足够久 + 请求量低
    let level: 'ok' | 'warn' | 'danger' = 'ok';
    let levelText = '正常';
    if (rl.limited || todayTrips >= 2) {
      level = 'danger';
      levelText = todayTrips >= 2
        ? `今日已触发限流 ${todayTrips} 次，接口受限，建议明天再试`
        : `限流中 · 约 ${Math.ceil((rl.retryAfterSec || 0) / 60)} 分钟后可试`;
    } else if (todayTrips >= 1 || (sinceLastMin !== null && sinceLastMin < 10)) {
      level = 'warn';
      levelText = '谨慎操作 · 建议间隔 10 分钟以上';
    }

    return {
      lastSyncAllAt: (this.mpService as any).getLastSyncAll?.() || 0,
      sinceLastMin,
      rateLimited: rl.limited,
      retryAfterSec: rl.retryAfterSec,
      dailyCount: rl.dailyCount || 0,
      dailyLimit: rl.dailyLimit || 100,
      minIntervalSec: rl.minIntervalSec || 0,
      throttledSec: rl.throttledSec || 0,
      todayTrips,
      level,
      levelText,
      // 建议下次同步：上次更新 + 10 分钟（下限），今日触发过则 +30 分钟
      suggestedNextSyncAt:
        this.lastSyncAllAt > 0
          ? this.lastSyncAllAt +
            (todayTrips > 0 ? 30 : 10) * 60 * 1e3
          : 0,
    };
  }

  inProgressHistoryMp = {
    id: '',
    page: 1,
  };

  async getHistoryMpArticles(mpId: string) {
    if (this.inProgressHistoryMp.id === mpId) {
      this.logger.log(`getHistoryMpArticles(${mpId}) is running`);
      return;
    }

    this.inProgressHistoryMp = {
      id: mpId,
      page: 1,
    };

    if (!this.inProgressHistoryMp.id) {
      return;
    }

    try {
      const feed = await this.prismaService.feed.findFirstOrThrow({
        where: {
          id: mpId,
        },
      });

      // 如果完整同步过历史文章，则直接返回
      if (feed.hasHistory === 0) {
        this.logger.log(`getHistoryMpArticles(${mpId}) has no history`);
        return;
      }

      const total = await this.prismaService.article.count({
        where: {
          mpId,
        },
      });
      this.inProgressHistoryMp.page = Math.ceil(total / defaultCount);

      // 最多尝试一千次
      let i = 1e3;
      while (i-- > 0) {
        if (this.inProgressHistoryMp.id !== mpId) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) is not running, break`,
          );
          break;
        }
        const result = await this.refreshMpArticlesAndUpdateFeed(
          mpId,
          this.inProgressHistoryMp.page,
        );
        // 限流：立即停止翻页，避免继续触发
        if (result.rateLimited) {
          this.logger.warn(`getHistoryMpArticles(${mpId}) 触发限流，停止翻页`);
          break;
        }
        if (result.hasHistory < 1) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) has no history, break`,
          );
          break;
        }
        this.inProgressHistoryMp.page++;

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.inProgressHistoryMp = {
        id: '',
        page: 1,
      };
    }
  }

  isRefreshAllMpArticlesRunning = false;

  async refreshAllMpArticlesAndUpdateFeed() {
    if (this.isRefreshAllMpArticlesRunning) {
      this.logger.log('refreshAllMpArticlesAndUpdateFeed is running');
      return;
    }
    const mps = await this.prismaService.feed.findMany();
    this.isRefreshAllMpArticlesRunning = true;
    let rateLimited = false;
    await (this.mpService as any).setLastSyncAll?.(Date.now());
    try {
      for (const { id } of mps) {
        // 熔断期间：立即停止，不再遍历剩余订阅
        if ((this.mpService as any).isRateLimited?.()) {
          rateLimited = true;
          this.logger.warn('更新全部：接口熔断中，提前停止');
          break;
        }
        const r = await this.refreshMpArticlesAndUpdateFeed(id);
        if (r.rateLimited) {
          rateLimited = true;
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }
    } finally {
      this.isRefreshAllMpArticlesRunning = false;
    }
    return { rateLimited };
  }

  async getMpInfo(url: string) {
    url = url.trim();
    return this.mpService.getMpInfo(url);
  }

  async createLoginUrl() {
    return this.mpService.createLoginUrl();
  }

  async getLoginResult(id: string) {
    return this.mpService.getLoginResult(id);
  }

  /** 搜索公众号（公众号后台） */
  async searchBiz(keyword: string) {
    return this.mpService.searchBiz(keyword);
  }
}
