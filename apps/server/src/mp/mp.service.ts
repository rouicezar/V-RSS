import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { PrismaService } from '@server/prisma/prisma.service';
import { statusMap } from '@server/constants';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

wrapper(axios);

/**
 * 公众号后台采集服务（方案B）
 *
 * 通过微信公众号后台（mp.weixin.qq.com）官方扫码登录，
 * 使用微信公众号后台官方接口采集文章。
 *
 * 登录流程：
 *   1. createLoginUrl() 获取登录二维码
 *   2. getLoginResult(uuid) 轮询扫码结果，成功后保存 cookie + token
 * 采集流程：
 *   searchBiz(keyword)  搜索公众号 → fakeid
 *   getMpArticles(fakeid, page) 获取文章列表（发布链接，长期有效）
 *   getMpInfo(url)      通过文章链接反查公众号信息
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
  /** 当前登录会话（cookie jar + token） */
  private session: AxiosInstance | null = null;
  private token = '';
  /** 当前登录流程的浏览器指纹 */
  private fingerprint = '';
  /** 登录是否已完成（防止轮询重复执行完成登录） */
  private loginFinished = false;
  /**
   * 限流策略（基于社区调研：微信后台无固定恢复时间，轻则几分钟、频繁触发可达 24h；
   * 关键是低频均匀请求，而非"冷却 X 分钟"）
   *  - 触发 200013 → 熔断 60 分钟（足够恢复且避免持续累积风控）
   *  - 请求速率控制：文章拉取最小间隔 30s、搜索最小间隔 15s（手动连点也被节流）
   *  - 日配额：当日后台接口请求超过 100 次 → 熔断至次日（防累积风控）
   */
  private rateLimitedUntil = 0;
  private readonly RATE_LIMIT_BREAK_MS = 60 * 60 * 1e3;
  // 速率控制
  private lastArticleReqAt = 0;
  private lastSearchReqAt = 0;
  private readonly ARTICLE_MIN_INTERVAL = 30 * 1e3;
  private readonly SEARCH_MIN_INTERVAL = 15 * 1e3;
  // 日配额
  private dailyReqDate = '';
  private dailyReqCount = 0;
  private readonly DAILY_LIMIT = 100;
  // 今日触发限流次数（用于评估账号风控恢复状态）
  private tripDate = '';
  private tripCountToday = 0;

  /** 上次"更新全部"时间戳（持久化） */
  private lastSyncAllAt = 0;

  /** 今日已触发限流次数 */
  getTodayTripCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.tripDate !== today) {
      this.tripDate = today;
      this.tripCountToday = 0;
    }
    return this.tripCountToday;
  }

  private isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  /** 请求节流：不足最小间隔时返回 false（调用方直接短路，不发请求） */
  private async throttle(key: 'article' | 'search'): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyReqDate !== today) {
      this.dailyReqDate = today;
      this.dailyReqCount = 0;
    }
    // 日配额耗尽：熔断至次日
    if (this.dailyReqCount >= this.DAILY_LIMIT) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, tomorrow.getTime());
      this.logger.warn(`当日后台请求已达 ${this.DAILY_LIMIT} 次上限，熔断至次日`);
      return false;
    }
    const last = key === 'article' ? this.lastArticleReqAt : this.lastSearchReqAt;
    const minInt = key === 'article' ? this.ARTICLE_MIN_INTERVAL : this.SEARCH_MIN_INTERVAL;
    if (last + minInt > Date.now()) {
      // 距上次请求不足间隔：限速中
      return false;
    }
    if (key === 'article') this.lastArticleReqAt = Date.now();
    else this.lastSearchReqAt = Date.now();
    this.dailyReqCount += 1;
    return true;
  }

  /** 查询限流状态（供前端 dashboard 展示） */
  getRateLimitInfo() {
    const remaining = this.rateLimitedUntil - Date.now();
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyReqDate !== today) {
      this.dailyReqDate = today;
      this.dailyReqCount = 0;
    }
    const articleLeft = Math.ceil(
      (this.lastArticleReqAt + this.ARTICLE_MIN_INTERVAL - Date.now()) / 1e3,
    );
    const searchLeft = Math.ceil(
      (this.lastSearchReqAt + this.SEARCH_MIN_INTERVAL - Date.now()) / 1e3,
    );
    return {
      limited: remaining > 0,
      retryAfterSec: remaining > 0 ? Math.ceil(remaining / 1e3) : 0,
      dailyCount: this.dailyReqCount,
      dailyLimit: this.DAILY_LIMIT,
      // 冷却剩余（取文章/搜索间隔的最大值）
      throttledSec: Math.max(articleLeft, searchLeft, 0),
      minIntervalSec: Math.max(articleLeft, searchLeft, 0),
    };
  }

  /** 触发熔断（200013） */
  private async tripRateLimit() {
    this.rateLimitedUntil = Date.now() + this.RATE_LIMIT_BREAK_MS;
    // 今日触发计数（跨天重置）
    const today = new Date().toISOString().slice(0, 10);
    if (this.tripDate !== today) {
      this.tripDate = today;
      this.tripCountToday = 0;
    }
    this.tripCountToday += 1;
    this.logger.warn(
      `公众号接口触发频率限制（今日第 ${this.tripCountToday} 次），熔断 ${this.RATE_LIMIT_BREAK_MS / 1e3}s`,
    );
    // 持久化今日触发次数（跨重启保留）
    try {
      await this.prismaService.mpState.upsert({
        where: { id: 'daily' },
        update: { tripCount: this.tripCountToday, tripDate: today },
        create: { id: 'daily', tripCount: this.tripCountToday, tripDate: today },
      });
    } catch (e) {
      this.logger.warn(`保存 tripCount 失败: ${(e as Error).message}`);
    }
  }
  private savedVid = '';
  private savedToken = '';
  private savedName = '';

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** 启动时从数据库恢复限流/同步状态（跨重启保留） */
  async onModuleInit() {
    try {
      const state = await this.prismaService.mpState.findUnique({
        where: { id: 'daily' },
      });
      if (state) {
        const today = new Date().toISOString().slice(0, 10);
        // 同步 tripDate，避免 getTodayTripCount 的跨天重置逻辑误清零
        this.tripDate = state.tripDate;
        if (state.tripDate === today) {
          this.tripCountToday = state.tripCount;
        }
        // 上次更新全部时间戳（供 dashboard 展示）
        if (state.lastSyncAllAt > 0) {
          this.lastSyncAllAt = Number(state.lastSyncAllAt);
        }
        this.logger.log(
          `MpState 恢复：今日限流 ${this.tripCountToday} 次（${state.tripDate}）`,
        );
      }
    } catch (e) {
      this.logger.warn(`恢复 MpState 失败: ${(e as Error).message}`);
    }
  }

  /** 记录"更新全部"时间（持久化） */
  async setLastSyncAll(ts: number) {
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

  /** 上次更新全部时间戳 */
  getLastSyncAll(): number {
    return this.lastSyncAllAt;
  }

  // ==================== 工具 ====================

  private createSession(cookieHeader = '') {
    const jar = new CookieJar();
    const instance = axios.create({
      timeout: 20 * 1e3,
      maxRedirects: 5,
      headers: {
        'User-Agent': UA,
        'Referer': 'https://mp.weixin.qq.com/',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      jar: jar as any,
      withCredentials: true,
    });
    if (cookieHeader) {
      // 预置已保存的 cookie
      for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
          jar.setCookieSync(
            part.trim(),
            'https://mp.weixin.qq.com',
          );
        }
      }
    }
    return instance;
  }

  /** 从登录响应中提取 token */
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

  /**
   * 获取公众号后台登录二维码
   * 二维码图片通过服务端会话下载，经 /img 静态托管提供给前端（避免跨域/cookie 问题）
   */
  async createLoginUrl() {
    const session = this.createSession();
    this.session = session;
    this.token = '';
    this.loginFinished = false;
    this.fingerprint = '';

    try {
      // 1. 访问登录页，建立会话
      await session.get('https://mp.weixin.qq.com/');

      // 2. 通过 bizlogin 启动登录，获取 uuid
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

      // 3. 用同一会话下载二维码图片
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
      // 保存到本地（与文章图片同仓，经 /img 静态托管）
      const qrDir = join(__dirname, '..', '..', 'data', 'images');
      await mkdir(qrDir, { recursive: true }).catch(() => {});
      const qrFile = join(qrDir, `qr_${uuid}.png`);
      await writeFile(qrFile, buf);

      return { uuid, scanUrl: `/img/qr_${uuid}.png`, message: '' };
    } catch (e: any) {
      this.logger.error(`createLoginUrl error: ${e.message}`);
      return { uuid: '', scanUrl: '', message: `获取登录二维码失败: ${e.message}` };
    }
  }

  /**
   * 轮询登录结果
   * @param uuid 二维码 uuid
   */
  async getLoginResult(uuid: string): Promise<LoginResult> {
    if (!this.session) {
      return { message: '请先获取登录二维码' };
    }
    // 登录已完成：直接返回成功结果，避免重复执行完成登录
    if (this.loginFinished) {
      return { vid: this.savedVid, token: this.savedToken, username: this.savedName };
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
      // status: 1/3 登录成功；2/4 已扫码待确认；其他等待
      if (data.status === 1 || data.status === 3) {
        // 完成登录，获取 token 和账号信息
        const loginInfo = await this.finishLogin(session);
        return loginInfo;
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

  /** 登录成功后：获取 token + 账号信息 + 保存 */
  private async finishLogin(session: AxiosInstance): Promise<LoginResult> {
    try {
      // 1. 执行登录（必须带与 startlogin 一致的 fingerprint）
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

      // 2. 多路提取 token：bizlogin 响应 JSON → 响应头 Location → home 页 URL
      this.token =
        this.extractToken(respStr) ||
        this.extractToken(String(loginResp.headers['location'] || ''));
      if (!this.token) {
        // 跟随重定向访问 home 页，token 在最终 URL 中
        try {
          const homeResp = await session.get(
            'https://mp.weixin.qq.com/cgi-bin/home',
            { params: { t: 'home/index', lang: 'zh_CN' }, maxRedirects: 5 },
          );
          const finalUrl =
            (homeResp.request as any)?.res?.responseUrl ||
            String(homeResp.config.url || '');
          this.token = this.extractToken(finalUrl) || this.extractToken(String(homeResp.data));
        } catch (e: any) {
          this.logger.warn(`登录后访问 home 失败: ${e.message}`);
        }
      }
      this.logger.log(`登录完成，token: ${this.token ? '已获取' : '未获取到'}`);

      // 3. 获取账号信息（switchacct 接口，token 有效时可用）
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

      // 4. 提取 cookie 并保存账号（id 限制 32 字符以内）
      const cookies = await (session.defaults.jar as any)
        .getCookies('https://mp.weixin.qq.com')
        .then((cs: any[]) =>
          cs.map((c) => `${c.key}=${c.value}`).join('; '),
        );
      const vid = (this.token || this.genUuid().replace(/-/g, '')).slice(0, 32);
      const tokenStr = `${cookies}; token=${this.token}`;

      await this.prismaService.account.upsert({
        where: { id: vid },
        update: { token: tokenStr, name: username, status: statusMap.ENABLE },
        create: {
          id: vid,
          token: tokenStr,
          name: username,
          status: statusMap.ENABLE,
        },
      });
      this.logger.log(`公众号后台登录成功: ${username} (id: ${vid})`);

      // 标记完成，防止轮询重复执行
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

  /** 使用已保存的账号建立采集会话 */
  private async loadAccountSession(accountId?: string): Promise<AxiosInstance> {
    const account = await this.prismaService.account.findFirst({
      where: accountId ? { id: accountId } : { status: statusMap.ENABLE },
      orderBy: { createdAt: 'asc' },
    });
    if (!account) throw new Error('暂无可用公众号账号，请先扫码登录');
    if (account.status !== statusMap.ENABLE) {
      throw new Error('公众号账号已失效，请重新扫码登录');
    }
    const cookieStr = account.token;
    const tokenMatch = cookieStr.match(/token=([^;\s]+)/);
    this.token = tokenMatch ? tokenMatch[1] : '';
    return this.createSession(cookieStr);
  }

  // ==================== 采集 ====================

  /**
   * 搜索公众号
   */
  async searchBiz(keyword: string, limit = 10, offset = 0) {
    // 熔断/节流/日配额：直接返回空
    if (this.isRateLimited()) {
      return [];
    }
    const canReq = await this.throttle('search');
    if (!canReq) {
      return [];
    }
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
        // 触发熔断，返回空数组
        await this.tripRateLimit();
        return [];
      }
      const list = (data.list || []).map((item: any) => ({
        fakeid: item.fakeid,
        nickname: item.nickname || '',
        alias: item.alias || '',
        // 微信返回圆形头像字段为 round_head_img
        headimgurl: item.round_head_img || item.headimgurl || '',
        signature: item.signature || '',
        serviceType: item.service_type || 0,
      }));
      return list;
    } catch (e: any) {
      if (e.message.includes('扫码登录')) throw e;
      this.logger.error(`searchBiz(${keyword}) error: ${e.message}`);
      throw e;
    }
  }

  /**
   * 获取公众号文章列表（分页，每页 5 篇）
   */
  async getMpArticles(fakeid: string, page = 0): Promise<any[]> {
    try {
      // 熔断/节流/日配额：不发真实请求
      if (this.isRateLimited()) {
        return [];
      }
      const canReq = await this.throttle('article');
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
        // 频率限制：触发熔断（接下来几分钟不再发请求），返回空
        await this.tripRateLimit();
        return [];
      }
      if (!data.publish_page) {
        return [];
      }
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
      this.logger.error(`getMpArticles(${fakeid}) page ${page} error: ${e.message}`);
      return [];
    }
  }

  /**
   * 通过文章链接反查公众号信息
   */
  async getMpInfo(url: string) {
    try {
      // 文章页为公网资源，直接抓取解析公众号信息（不依赖后台 session / 频率限制）
      const articleResp = await axios.get(url, {
        timeout: 15 * 1e3,
        headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
      });
      const html = articleResp.data as string;
      const nameMatch = html.match(
        /var\s+nickname\s*=\s*["']([^"']+)["']|id="js_name">\s*([^<]+)</,
      );
      // 新版页面用 round_head_img，旧版用 head_avatar_url
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

  /** 标记当前账号失效 */
  private async markAccountInvalid() {
    const account = await this.prismaService.account.findFirst({
      where: { status: statusMap.ENABLE },
    });
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
