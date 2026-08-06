import {
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';
import { PrismaService } from '@server/prisma/prisma.service';

// 微信头像 UA + Referer（避免防盗链拦截）
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REFERER = 'https://mp.weixin.qq.com/';

/** 简单内存缓存：feedId -> { buf, type, ts }，缓存 24 小时 */
const cache = new Map<
  string,
  { buf: Buffer; type: string; ts: number }
>();

const CACHE_TTL = 24 * 60 * 60 * 1e3;

/**
 * 公众号头像代理
 * 服务端下载微信 CDN 头像并返回（本地化，避免外部域名引用 / 防盗链 / 混合内容）
 * GET /img/avatar/:feedId
 */
/** 允许代理的微信图片域名白名单（防 SSRF） */
const ALLOWED_HOSTS = ['mmbiz.qpic.cn', 'wx.qlogo.cn', 'wx.qpic.cn'];

@Controller('img')
export class AvatarController {
  constructor(private readonly prisma: PrismaService) {}

  /** 通用微信图片代理：仅允许白名单域名 GET /img/weixin?u=<url> */
  @Get('weixin')
  async proxyWeixin(@Res() res: Response, @Param() p: any, ...rest: any[]) {
    const req = (res.req as any);
    const u = req?.query?.u as string;
    if (!u) return res.status(400).end();
    let host = '';
    try {
      host = new URL(u).host;
    } catch {
      return res.status(400).end();
    }
    if (!ALLOWED_HOSTS.includes(host)) return res.status(403).end();
    const key = 'weixin:' + u;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      res.set({ 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' });
      return res.send(hit.buf);
    }
    try {
      const resp = await axios.get(u, {
        timeout: 12 * 1e3,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, Referer: REFERER },
      });
      const buf = Buffer.from(resp.data);
      const type = (resp.headers['content-type'] as string) || 'image/jpeg';
      cache.set(key, { buf, type, ts: Date.now() });
      res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
      return res.send(buf);
    } catch {
      return res.status(404).end();
    }
  }

  @Get('avatar/:feedId')
  async getAvatar(@Param('feedId') feedId: string, @Res() res: Response) {
    const hit = cache.get(feedId);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      res.set({
        'Content-Type': hit.type,
        'Cache-Control': 'public, max-age=86400',
      });
      return res.send(hit.buf);
    }

    const feed = await this.prisma.feed.findUnique({
      where: { id: feedId },
      select: { mpCover: true },
    });
    const url = feed?.mpCover;
    if (!url) {
      return res.status(404).end();
    }

    try {
      const resp = await axios.get(url, {
        timeout: 12 * 1e3,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, Referer: REFERER },
      });
      const buf = Buffer.from(resp.data);
      const type =
        (resp.headers['content-type'] as string) || 'image/jpeg';
      cache.set(feedId, { buf, type, ts: Date.now() });
      res.set({
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
      });
      return res.send(buf);
    } catch {
      return res.status(404).end();
    }
  }
}
