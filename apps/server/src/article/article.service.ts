import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@server/prisma/prisma.service';
import Axios from 'axios';
import { load } from 'cheerio';
import { LRUCache } from 'lru-cache';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import {
  isWeixinArticleUrl,
  isWeixinImageUrl,
} from '@server/common/url-security';

/**
 * 文章正文缓存（内存，LRU）
 */
const articleContentCache = new LRUCache<string, string>({ max: 5000 });

/**
 * 文章服务：正文清洗、抓取、图片本地化、批量补全
 */
@Injectable()
export class ArticleService {
  private readonly logger = new Logger(ArticleService.name);

  constructor(private readonly prismaService: PrismaService) {}

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

      return content.replace(/>\s+</g, '><').trim();
    } catch (e) {
      this.logger.error(`cleanArticleHtml error: ${(e as Error).message}`);
      return source;
    }
  }

  /**
   * 把正文中的微信图片下载到本地（解决防盗链），返回替换后的 HTML
   */
  async localizeArticleImages(
    contentHtml: string,
    articleId: string,
  ): Promise<string> {
    if (!contentHtml) return contentHtml;

    const safeArticleId = createHash('sha256')
      .update(articleId)
      .digest('hex')
      .slice(0, 32);
    const imgDir = join(__dirname, '..', '..', 'data', 'images', safeArticleId);
    await mkdir(imgDir, { recursive: true }).catch(() => {});

    const $ = load(contentHtml, { decodeEntities: false });
    const imgs = $('img').toArray();
    let failed = 0;

    const concurrency = 3;
    for (let i = 0; i < imgs.length; i += concurrency) {
      const batch = imgs.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (img, bi) => {
          const $img = $(img);
          const src = $img.attr('src') || $img.attr('data-src') || '';
          if (
            !src ||
            src.startsWith('/') ||
            src.startsWith('data:') ||
            !isWeixinImageUrl(src)
          )
            return;
          try {
            const resp = await Axios.get(src, {
              timeout: 15 * 1e3,
              responseType: 'arraybuffer',
              maxRedirects: 0,
              maxContentLength: 15 * 1024 * 1024,
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
            const filename = `${i + bi}.${ext}`;
            await writeFile(join(imgDir, filename), buf);
            $img.attr('src', `/img/${safeArticleId}/${filename}`);
          } catch (e) {
            failed += 1;
          }
        }),
      );
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
      if (!isWeixinArticleUrl(url)) {
        this.logger.warn(`拒绝抓取非微信文章地址: ${url}`);
        return '';
      }
      const html = await Axios.get(url, {
        timeout: 10 * 1e3,
        maxRedirects: 0,
        maxContentLength: 5 * 1024 * 1024,
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
        cleaned = await this.localizeArticleImages(cleaned, id);
        articleContentCache.set(id, cleaned);
        await this.prismaService.article
          .update({
            where: { id },
            data: { content: cleaned, contentStatus: 1 },
          })
          .catch(() => {});
      } else {
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
   * 对已有正文做图片本地化（重抓图片）
   */
  async localizeArticle(
    articleId: string,
  ): Promise<{ id: string; ok: boolean }> {
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
   * 批量补全缺失正文（带节流）
   */
  async backfillMissingContent(limit = 20, delayMs = 1500) {
    const articles = await this.prismaService.article.findMany({
      where: { contentStatus: 0, status: 1 },
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
      return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
    }
  }
}
