import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@server/prisma/prisma.service';
import { EventsService } from '@server/events/events.service';
import Axios from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 标题时间戳：Asia/Shanghai 本地时间，精确到分钟（同日多次生成可区分） */
const cnTime = () =>
  dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD HH:mm');

/**
 * 分析服务：雷达计算、报告生成、学习计划、知识沉淀
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * 调用 DeepSeek 生成文本
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
   * 调用 DeepSeek 提取文章标签 + 领域归类
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
    const cleaned = content.replace(/```(?:json)?/gi, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    const jsonStr =
      jsonStart >= 0 && jsonEnd > jsonStart
        ? cleaned.slice(jsonStart, jsonEnd + 1)
        : cleaned;

    // 尝试修复截断 JSON：补齐尾部
    const tryRepair = (s: string): string => {
      if (!s.endsWith('}')) {
        const lastComma = s.lastIndexOf(',');
        if (lastComma > 0) s = s.slice(0, lastComma);
        if (!s.includes('"tags"')) return s + '],"domain":""}';
        if (!s.includes('"domain"')) return s + ',"domain":""}';
        return s + '}';
      }
      return s;
    };

    try {
      const parsed = JSON.parse(jsonStr);
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags
            .map((t: unknown) => String(t).trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
      const domain = String(parsed.domain || '')
        .trim()
        .slice(0, 50);
      return { tags, domain };
    } catch {
      // 修复后重试
      try {
        const repaired = tryRepair(jsonStr);
        const parsed = JSON.parse(repaired);
        const tags = Array.isArray(parsed.tags)
          ? parsed.tags
              .map((t: unknown) => String(t).trim())
              .filter(Boolean)
              .slice(0, 5)
          : [];
        const domain = String(parsed.domain || '')
          .trim()
          .slice(0, 50);
        return { tags, domain };
      } catch (e2) {
        this.logger.error(
          `extractTagsWithAI JSON 解析失败(含修复): ${content}`,
        );
        return { tags: [], domain: '' };
      }
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

    const $ = await import('cheerio').then((m) => m.load);
    const htmlToText = (html: string): string => {
      if (!html) return '';
      try {
        const c = $ ? $(html, { decodeEntities: false }) : null;
        const text = c ? c('body').text() || c('div').first().text() || '' : '';
        return text.replace(/\s+/g, ' ').trim().slice(0, 6000);
      } catch {
        return html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000);
      }
    };

    const text = htmlToText(article.content || '');
    if (!text) return { articleId, tags: [], domain: '' };

    const existingTags = (
      await this.prismaService.tag.findMany({ select: { name: true } })
    ).map((t) => t.name);

    const { tags, domain } = await this.extractTagsWithAI(
      article.title,
      text,
      existingTags,
    );

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

    this.eventsService.emit({
      type: 'job:started',
      data: { job: 'tagAll', total: articles.length },
    });

    let done = 0;
    let index = 0;
    for (const article of articles) {
      index += 1;
      try {
        const r = await this.tagArticleWithAI(article.id);
        if (r.tags.length > 0) done += 1;
        // 实时推送：单篇打标完成
        this.eventsService.emit({
          type: 'article:tagged',
          data: { articleId: article.id, tags: r.tags, domain: r.domain },
        });
      } catch (e) {
        this.logger.error(
          `tagArticleWithAI(${article.id}) error: ${(e as Error).message}`,
        );
      }
      this.eventsService.emit({
        type: 'job:progress',
        data: {
          job: 'tagAll',
          current: index,
          total: articles.length,
          detail: article.title,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    this.eventsService.emit({
      type: 'job:finished',
      data: {
        job: 'tagAll',
        result: { total: articles.length, done },
      },
    });
    return { total: articles.length, done };
  }

  /**
   * 计算关注雷达（基于文章标签聚合 + 收藏权重）
   * 使用 tag.category 合并维度
   */
  async computeRadar() {
    const articles = await this.prismaService.article.findMany({
      where: { status: 1, contentStatus: 1 },
      select: {
        isFavorite: true,
        mpId: true,
        tags: { select: { tag: { select: { name: true, category: true } } } },
      },
    });

    // 按标签类别分组，无 category 的用标签名
    const byCategory = new Map<
      string,
      { count: number; fav: number; mps: Set<string> }
    >();

    for (const a of articles) {
      const tagPairs = a.tags
        .map((t) => ({
          name: t.tag?.name || '',
          category: t.tag?.category || '',
        }))
        .filter((t) => t.name.length > 0);

      const dimensions =
        tagPairs.length > 0
          ? tagPairs.map((t) => t.category || t.name)
          : ['未归类'];

      for (const dim of dimensions) {
        if (!byCategory.has(dim))
          byCategory.set(dim, { count: 0, fav: 0, mps: new Set() });
        const item = byCategory.get(dim)!;
        item.count += 1;
        if (a.isFavorite) item.fav += 1;
        item.mps.add(a.mpId);
      }
    }

    const maxCount = Math.max(
      1,
      ...Array.from(byCategory.values()).map((v) => v.count),
    );
    const maxFav = Math.max(
      1,
      ...Array.from(byCategory.values()).map((v) => v.fav),
    );

    let radar = Array.from(byCategory.entries())
      .map(([dimension, v]) => {
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
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // 存库
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
【收藏文章】${favorites
      .map((f) => `- ${f.title}（${f.domain || '未归类'}）`)
      .join('\n')}

请输出报告，结构：
## 关注结构总览
## 强弱项分析
## 交叉洞察（领域之间的关联机会）
## 行动建议（3-5 条具体、可执行）`;

    const report = await this.askDeepSeek(system, user);
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
        title: `学习计划 ${cnTime()}`,
        content,
      },
    });
    return { plan, radar, weak, strong };
  }

  /**
   * 知识沉淀：蒸馏全部文章为可复用的方法论与学习资料
   */
  async distillKnowledge() {
    // 快速失败：未配置 DeepSeek Key 时立即报错，避免 54 批空转 5 分钟
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error(
        '未配置 DEEPSEEK_API_KEY：请在 apps/server/.env 配置 DeepSeek API Key（https://platform.deepseek.com）',
      );
    }
    const articles = await this.prismaService.article.findMany({
      where: { status: 1, contentStatus: 1, content: { not: '' } },
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
    if (total === 0) throw new Error('暂无有效文章可用于知识沉淀');

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

    const BATCH = 3;
    const batches: (typeof prepared)[] = [];
    for (let i = 0; i < prepared.length; i += BATCH) {
      batches.push(prepared.slice(i, i + BATCH));
    }

    const batchResults: string[] = new Array(batches.length).fill('');
    const processedIds = new Set<string>();
    const MAX_RETRY = 3;
    // 并发批处理：54 批串行约 20 分钟，并发 5 个降到约 4 分钟
    const CONCURRENCY = 5;

    let nextBatch = 0;
    const worker = async () => {
      while (nextBatch < batches.length) {
        const bi = nextBatch++;
        const batch = batches[bi];
        const section = batch
          .map(
            (a, idx) =>
              `【文章${idx + 1}/${batch.length}】《${a.title}》
领域: ${a.domain || '未归类'} | 标签: ${
                (a.tags || [])
                  .map((t: any) => t.tag?.name)
                  .filter(Boolean)
                  .join('、') || '无'
              }
正文:
${a.text.slice(0, 3600)}`,
          )
          .join('\n\n');

        const system =
          '你是资深知识工程师，擅长把实战文章蒸馏成可立即使用的方法论。输出必须非常详细、具体、可执行，避免空泛表述。对每篇文章独立成节提炼。';
        const user = `这是第 ${bi + 1}/${batches.length} 批文章（共 ${batch.length} 篇）。请对【每一篇】文章分别输出以下完整结构：

## 《文章标题》
### 核心问题
### 方法论 / 解决方案
### 关键细节与坑
### 实用技巧
### 适用场景
### 一句话总结

最后给本批文章的共同趋势 2-3 句。

文章内容：
${section}`;

        let out = '';
        for (let retry = 0; retry < MAX_RETRY; retry++) {
          try {
            out = await this.askDeepSeek(system, user, 4000, 0.4);
            if (out.includes('##') && out.length > 100) break;
            this.logger.warn(
              `蒸馏批次 ${bi + 1} 输出过短，重试 ${retry + 1}/${MAX_RETRY}`,
            );
          } catch (e: any) {
            this.logger.error(
              `蒸馏批次 ${bi + 1} 第${retry + 1}次失败: ${e.message}`,
            );
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (!out) out = `（批次 ${bi + 1} 生成失败，跳过）`;

        batchResults[bi] = `# 批次 ${bi + 1}（${batch.length} 篇）\n${out}`;
        batch.forEach((a) => processedIds.add(a.id));
        await new Promise((r) => setTimeout(r, 1500));
        if ((bi + 1) % 10 === 0) {
          this.logger.log(`蒸馏进度：${bi + 1}/${batches.length} 批`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () =>
        worker(),
      ),
    );

    const digest = batchResults.join('\n\n---\n\n');
    const system2 =
      '你是知识体系构建专家。把分批蒸馏的文章知识整合成一份高密度、可直接学习的知识沉淀文档。';
    const user2 = `以下是从 ${total} 篇文章蒸馏出的详细笔记（共 ${batches.length} 批）。请整合为最终沉淀文档，结构：
# 知识沉淀（覆盖 ${total} 篇文章 / ${totalImages} 张配图）
## 一、领域地图
## 二、核心方法论库
## 三、概念词典
## 四、工具与技巧速查
## 五、逐篇精华汇编
## 六、推荐学习路径

逐篇精华汇编部分必须包含全部 ${total} 篇文章，一篇都不能少。

分批蒸馏内容：
${digest}`;

    const finalDoc = await this.askDeepSeek(system2, user2, 8000, 0.35);

    const kb = await this.prismaService.knowledgeBase.create({
      data: {
        title: `知识沉淀 ${cnTime()}`,
        content: finalDoc,
        articleCount: total,
        imageCount: totalImages,
      },
    });

    return {
      kbId: kb.id,
      report: finalDoc,
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
}
