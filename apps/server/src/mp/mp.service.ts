import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { PrismaService } from '@server/prisma/prisma.service';
import { CryptoService } from '@server/crypto/crypto.service';
import { PipelineId, RateLimiter } from './rate-limiter.service';
import { statusMap } from '@server/constants';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

wrapper(axios);

/**
 * 公众号后台采集服务
 *
 * 通过微信公众号后台（mp.weixin.qq.com）官方扫码登录采集文章。
 * 限流逻辑托付给 RateLimiter。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface MpArticle {
  id: string;
  title: string;
  picUrl: string;
  publishTime: number;
  url: string;
  digest?: string;
}

export interface LoginResult {
  vid?: string;
  token?: string;
  username?: string;
  message?: string;
}

@Injectable()
export class MpService {
  private readonly logger = new Logger(this.constructor.name);
  private readonly rateLimiter: RateLimiter;

  private session: AxiosInstance | null = null;
  private token = '';
  private currentAccountId = '';
  private fingerprint = '';
  private loginFinished = false;
  private currentAccountIndex = 0;

  private savedVid = '';
  private savedToken = '';
  private savedName = '';

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
  ) {
    this.rateLimiter = new RateLimiter(prismaService);
  }

  async onModuleInit() {
    await this.rateLimiter.restore();
  }

  // ========== 限流委托（公共 API 不变） ==========

  getRateLimitRemainingMs(): number {
    return this.rateLimiter.getRemainingMs();
  }

  getTodayTripCount(): number {
    return this.rateLimiter.getTodayTripCount();
  }

  isRateLimited(): boolean {
    // 当前账号视角：全局熔断 或 当前账号被单独熔断
    return this.rateLimiter.isRateLimited(this.currentAccountId);
  }

  getRateLimitInfo() {
    return this.rateLimiter.getStatus(this.currentAccountId);
  }

  getLastSyncAll(): number {
    return this.rateLimiter.getLastSyncAll();
  }

  async setLastSyncAll(ts: number) {
    await this.rateLimiter.setLastSyncAll(ts);
  }

  getActivePipeline(): PipelineId {
    return this.rateLimiter.getActivePipeline();
  }

  async setActivePipeline(pipeline: PipelineId) {
    await this.rateLimiter.setActivePipeline(pipeline);
  }

  // ==================== 工具 ====================

  private createSession(cookieHeader = '') {
    const jar = new CookieJar();
    const instance = axios.create({
      timeout: 20 * 1e3,
      maxRedirects: 5,
      headers: {
        'User-Agent': UA,
        Referer: 'https://mp.weixin.qq.com/',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      jar: jar as any,
      withCredentials: true,
    });
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
          jar.setCookieSync(part.trim(), 'https://mp.weixin.qq.com');
        }
      }
    }
    return instance;
  }

  private extractToken(text: string): string {
    const m = text.match(/token=([^&\s"'\\]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  private isInvalidSession(resp: any): boolean {
    return (
      resp?.base_resp?.ret === 200003 ||
      String(resp?.base_resp?.err_msg || '').includes('invalid session')
    );
  }

  // ==================== 登录 ====================

  async createLoginUrl() {
    const session = this.createSession();
    this.session = session;
    this.token = '';
    this.loginFinished = false;
    this.fingerprint = '';

    try {
      await session.get('https://mp.weixin.qq.com/');

      const fingerprint = this.genUuid().replace(/-/g, '');
      this.fingerprint = fingerprint;
      const startResp = await session.post(
        'https://mp.weixin.qq.com/cgi-bin/bizlogin?action=startlogin',
        new URLSearchParams({
          fingerprint,
          token: '',
          lang: 'zh_CN',
          f: 'json',
          ajax: '1',
          redirect_url:
            '/cgi-bin/settingpage?t=setting/index&action=index&lang=zh_CN',
          login_type: '3',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      const startData = startResp.data || {};
      const uuid = startData.uuid || '';
      if (!uuid) {
        this.logger.error('获取 uuid 失败', startResp.data);
        return { uuid: '', scanUrl: '', message: '获取登录二维码失败' };
      }

      const qrResp = await session.get(
        'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode',
        {
          params: { action: 'getqrcode', uuid, random: Date.now() },
          responseType: 'arraybuffer',
        },
      );
      const buf = Buffer.from(qrResp.data as any);
      if (buf.length === 0) {
        this.logger.error('二维码图片为空');
        return { uuid: '', scanUrl: '', message: '获取登录二维码失败' };
      }
      const qrDir = join(__dirname, '..', '..', 'data', 'images');
      await mkdir(qrDir, { recursive: true }).catch(() => {});
      const qrFile = join(qrDir, `qr_${uuid}.png`);
      await writeFile(qrFile, buf);

      return { uuid, scanUrl: `/img/qr_${uuid}.png`, message: '' };
    } catch (e: any) {
      this.logger.error(`createLoginUrl error: ${e.message}`);
      return {
        uuid: '',
        scanUrl: '',
        message: `获取登录二维码失败: ${e.message}`,
      };
    }
  }

  async getLoginResult(uuid: string): Promise<LoginResult> {
    if (!this.session) return { message: '请先获取登录二维码' };
    if (this.loginFinished) {
      return {
        vid: this.savedVid,
        token: this.savedToken,
        username: this.savedName,
      };
    }
    const session = this.session;
    try {
      const resp = await session.get(
        'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode',
        {
          params: {
            action: 'ask',
            fingerprint: this.fingerprint,
            lang: 'zh_CN',
            f: 'json',
            ajax: 1,
          },
        },
      );
      const data = resp.data;
      this.logger.log(`ask 响应: ${JSON.stringify(data).slice(0, 300)}`);
      if (data.status === 1 || data.status === 3) {
        return await this.finishLogin(session);
      } else if (data.status === 2 || data.status === 4) {
        return { message: '已扫码，请在手机上确认登录' };
      } else {
        return { message: '等待扫码...' };
      }
    } catch (e: any) {
      this.logger.error(`getLoginResult error: ${e.message}`);
      return { message: `查询登录状态失败: ${e.message}` };
    }
  }

  private async finishLogin(session: AxiosInstance): Promise<LoginResult> {
    try {
      const loginResp = await session.post(
        'https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login',
        new URLSearchParams({
          userlang: 'zh_CN',
          redirect_url: '',
          cookie_forbidden: '0',
          cookie_cleaned: '0',
          plugin_used: '0',
          login_type: '3',
          fingerprint: this.fingerprint,
          token: '',
          lang: 'zh_CN',
          f: 'json',
          ajax: '1',
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      const respStr = JSON.stringify(loginResp.data);
      this.logger.log(
        `bizlogin 响应(${loginResp.status}): ${respStr.slice(0, 600)}`,
      );

      this.token =
        this.extractToken(respStr) ||
        this.extractToken(String(loginResp.headers['location'] || ''));
      if (!this.token) {
        try {
          const homeResp = await session.get(
            'https://mp.weixin.qq.com/cgi-bin/home',
            { params: { t: 'home/index', lang: 'zh_CN' }, maxRedirects: 5 },
          );
          const finalUrl =
            (homeResp.request as any)?.res?.responseUrl ||
            String(homeResp.config.url || '');
          this.token =
            this.extractToken(finalUrl) ||
            this.extractToken(String(homeResp.data));
        } catch (e: any) {
          this.logger.warn(`登录后访问 home 失败: ${e.message}`);
        }
      }
      this.logger.log(`登录完成，token: ${this.token ? '已获取' : '未获取到'}`);

      let username = '公众号后台账号';
      try {
        const acctResp = await session.get(
          'https://mp.weixin.qq.com/cgi-bin/switchacct',
          {
            params: {
              action: 'get_acct_list',
              token: this.token,
              lang: 'zh_CN',
              f: 'json',
              ajax: '1',
            },
            headers: {
              Referer: `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${this.token}`,
            },
          },
        );
        const acctData = acctResp.data;
        this.logger.log(
          `get_acct_list 响应: ${JSON.stringify(acctData).slice(0, 300)}`,
        );
        const bizList = acctData?.biz_list?.list || [];
        if (bizList.length > 0) {
          username = bizList[0].username || bizList[0].nickname || username;
        }
      } catch (e: any) {
        this.logger.error(`get_acct_list error: ${e.message}`);
      }

      const cookies = await (session.defaults.jar as any)
        .getCookies('https://mp.weixin.qq.com')
        .then((cs: any[]) => cs.map((c) => `${c.key}=${c.value}`).join('; '));
      const vid = (this.token || this.genUuid().replace(/-/g, '')).slice(0, 32);
      const tokenStr = `${cookies}; token=${this.token}`;
      const encryptedToken = this.cryptoService.encrypt(tokenStr);

      await this.prismaService.account.upsert({
        where: { id: vid },
        update: {
          token: encryptedToken,
          name: username,
          status: statusMap.ENABLE,
          pipeline: 2,
        },
        create: {
          id: vid,
          token: encryptedToken,
          name: username,
          status: statusMap.ENABLE,
          pipeline: 2,
        },
      });
      this.logger.log(`公众号后台登录成功: ${username} (id: ${vid})`);

      this.loginFinished = true;
      this.savedVid = vid;
      this.savedToken = tokenStr;
      this.savedName = username;

      return { vid, token: tokenStr, username };
    } catch (e: any) {
      this.logger.error(`finishLogin error: ${e.message}`);
      return { message: `登录处理失败: ${e.message}` };
    }
  }

  // ==================== 多账号轮询 ====================

  private async loadAccountSession(accountId?: string): Promise<AxiosInstance> {
    if (accountId) {
      const account = await this.prismaService.account.findUnique({
        where: { id: accountId, pipeline: 2 },
      });
      if (!account) throw new Error('指定账号不存在');
      if (account.status !== statusMap.ENABLE)
        throw new Error('公众号账号已失效');
      const cookieStr = this.cryptoService.decrypt(account.token);
      const tokenMatch = cookieStr.match(/token=([^;\s]+)/);
      this.token = tokenMatch ? tokenMatch[1] : '';
      this.currentAccountId = account.id;
      return this.createSession(cookieStr);
    }

    const accounts = await this.prismaService.account.findMany({
      where: { status: statusMap.ENABLE, pipeline: 2 },
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0)
      throw new Error('暂无可用公众号账号，请先扫码登录');

    const tried: string[] = [];

    for (let offset = 0; offset < accounts.length; offset++) {
      const idx = (this.currentAccountIndex + offset) % accounts.length;
      const account = accounts[idx];

      if (!this.rateLimiter.isAccountAvailable(account.id)) {
        const reason =
          this.rateLimiter.getAccountDailyCount(account.id) >= 100
            ? '日配额耗尽'
            : '限流中';
        tried.push(`${account.name}(${reason})`);
        continue;
      }

      const cookieStr = this.cryptoService.decrypt(account.token);
      const tokenMatch = cookieStr.match(/token=([^;\s]+)/);
      if (!tokenMatch) {
        tried.push(`${account.name}(token无效)`);
        await this.prismaService.account
          .update({
            where: { id: account.id },
            data: { status: statusMap.INVALID },
          })
          .catch(() => {});
        continue;
      }

      this.currentAccountIndex = (idx + 1) % accounts.length;
      this.token = tokenMatch[1];
      this.currentAccountId = account.id;
      this.logger.log(
        `多账号轮询：选择账号 "${account.name}" (${idx + 1}/${accounts.length})` +
          (tried.length > 0 ? ` [跳过: ${tried.join(', ')}]` : ''),
      );
      return this.createSession(cookieStr);
    }

    throw new Error(
      `所有 ${accounts.length} 个公众号账号暂时不可用: ${tried.join(', ')}，请稍后再试或添加新账号`,
    );
  }

  // ==================== 采集 ====================

  async searchBiz(keyword: string, limit = 10, offset = 0) {
    if (this.rateLimiter.isRateLimited()) return [];
    const canReq = await this.rateLimiter.canRequest(
      'search',
      this.currentAccountId,
    );
    if (!canReq) return [];

    const session = await this.loadAccountSession();
    if (!this.token) throw new Error('Token 无效，请重新扫码登录');
    try {
      const resp = await session.get(
        'https://mp.weixin.qq.com/cgi-bin/searchbiz',
        {
          params: {
            action: 'search_biz',
            begin: offset,
            count: limit,
            query: keyword,
            token: this.token,
            lang: 'zh_CN',
            f: 'json',
            ajax: '1',
          },
          headers: { Referer: 'https://mp.weixin.qq.com/' },
        },
      );
      const data = resp.data;
      if (this.isInvalidSession(data)) {
        await this.markAccountInvalid();
        throw new Error('登录已失效，请重新扫码登录');
      }
      if (data.base_resp?.ret === 200013) {
        await this.rateLimiter.trip(this.currentAccountId);
        return [];
      }
      return (data.list || []).map((item: any) => ({
        fakeid: item.fakeid,
        nickname: item.nickname || '',
        alias: item.alias || '',
        headimgurl: item.round_head_img || item.headimgurl || '',
        signature: item.signature || '',
        serviceType: item.service_type || 0,
      }));
    } catch (e: any) {
      if (e.message.includes('扫码登录')) throw e;
      this.logger.error(`searchBiz(${keyword}) error: ${e.message}`);
      throw e;
    }
  }

  async getMpArticles(fakeid: string, page = 0): Promise<any[]> {
    try {
      if (this.rateLimiter.isRateLimited()) return [];
      const canReq = await this.rateLimiter.canRequest(
        'article',
        this.currentAccountId,
      );
      if (!canReq) {
        this.logger.debug(`getMpArticles(${fakeid}) 请求受限速控制`);
        return [];
      }
      const session = await this.loadAccountSession();
      if (!this.token) {
        this.logger.error(`getMpArticles(${fakeid}) Token 无效，请重新扫码`);
        return [];
      }
      const resp = await session.get(
        'https://mp.weixin.qq.com/cgi-bin/appmsgpublish',
        {
          params: {
            sub: 'list',
            sub_action: 'list_ex',
            begin: page * 5,
            count: 5,
            fakeid,
            token: this.token,
            lang: 'zh_CN',
            f: 'json',
            ajax: '1',
          },
          headers: {
            Referer: `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${this.token}`,
          },
        },
      );
      const data = resp.data;
      if (this.isInvalidSession(data)) {
        await this.markAccountInvalid();
        this.logger.error(`getMpArticles(${fakeid}) 登录已失效`);
        return [];
      }
      if (data.base_resp?.ret === 200013) {
        await this.rateLimiter.trip(this.currentAccountId);
        return [];
      }
      if (!data.publish_page) return [];

      const publishPage =
        typeof data.publish_page === 'string'
          ? JSON.parse(data.publish_page)
          : data.publish_page;
      const publishList = publishPage.publish_list || [];
      const articles: MpArticle[] = [];
      for (const item of publishList) {
        const publishInfo =
          typeof item.publish_info === 'string'
            ? JSON.parse(item.publish_info)
            : item.publish_info;
        const appMsgs = publishInfo?.appmsgex || [];
        for (const msg of appMsgs) {
          const link = msg.link || '';
          const idMatch = link.match(/\/s\/([^/?]+)/);
          articles.push({
            id: idMatch ? idMatch[1] : msg.app_msg_id || '',
            title: msg.title || '',
            picUrl: msg.cover || '',
            publishTime: msg.update_time || 0,
            url: link,
            digest: msg.digest || '',
          });
        }
      }
      return articles;
    } catch (e: any) {
      this.logger.error(
        `getMpArticles(${fakeid}) page ${page} error: ${e.message}`,
      );
      return [];
    }
  }

  async getMpInfo(url: string) {
    try {
      const articleResp = await axios.get(url, {
        timeout: 15 * 1e3,
        headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
      });
      const html = articleResp.data as string;
      const nameMatch = html.match(
        /var\s+nickname\s*=\s*["']([^"']+)["']|id="js_name">\s*([^<]+)</,
      );
      const avatarMatch = html.match(
        /var\s+(?:head_avatar_url|round_head_img)\s*=\s*["']([^"']+)/,
      );
      const bizMatch = html.match(/var\s+user_name\s*=\s*"([^"]+)"/);
      const name = (nameMatch?.[1] || nameMatch?.[2] || '').trim();
      return [
        {
          id: bizMatch ? bizMatch[1] : this.genUuid(),
          name,
          cover: avatarMatch?.[1] || '',
          intro: '',
          updateTime: Math.floor(Date.now() / 1e3),
        },
      ];
    } catch (e: any) {
      this.logger.error(`getMpInfo(${url}) error: ${e.message}`);
      throw e;
    }
  }

  private async markAccountInvalid() {
    const account = this.currentAccountId
      ? await this.prismaService.account.findUnique({
          where: { id: this.currentAccountId, pipeline: 2 },
        })
      : null;
    if (account) {
      await this.prismaService.account.update({
        where: { id: account.id },
        data: { status: statusMap.INVALID },
      });
      this.logger.warn(`公众号账号(${account.name})登录已失效，已标记`);
    }
  }

  private genUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
