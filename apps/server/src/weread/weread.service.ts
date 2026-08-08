import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { PrismaService } from '@server/prisma/prisma.service';
import { CryptoService } from '@server/crypto/crypto.service';
import { statusMap } from '@server/constants';
import Axios, { AxiosInstance } from 'axios';
import QRCode from 'qrcode';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 微信读书（weread）采集服务
 *
 * 架构：本服务是"瘦客户端"，所有采集动作通过标准 HTTP API 委托给
 * weread 采集平台（PLATFORM_URL，如 https://weread.111965.xyz）。
 * 该平台内部用微信读书账号池采集公众号文章，风控宽松且分摊到多账号。
 *
 * 本服务职责：
 * - 微信读书扫码登录（createLoginUrl / getLoginResult）
 * - 文章列表拉取（getMpArticles，带账号池 + 重试）
 * - 文章链接反查公众号信息（getMpInfo）
 * - 账号池管理：WeReadError401 → 账号禁用；429 → 当日小黑屋跳过；随机选号
 */

/** 读书账号每日小黑屋（429 触发，当日不再选用） */
const blockedAccountsMap = new Map<string, string[]>();

@Injectable()
export class WereadService {
  private readonly logger = new Logger(WereadService.name);
  private request: AxiosInstance;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly cryptoService: CryptoService,
  ) {
    const { url } =
      this.configService.get<ConfigurationType['platform']>('platform')!;
    this.request = Axios.create({ baseURL: url, timeout: 15 * 1e3 });

    this.request.interceptors.response.use(
      (response) => response,
      async (error) => {
        const errMsg = error.response?.data?.message || '';
        const status = error.response?.status;
        const id = (error.config?.headers as any)?.xid;

        if (status === 401 || errMsg.includes('WeReadError401')) {
          // 账号失效：标记禁用（微信读书侧 token 过期）
          await this.prismaService.account
            .update({
              where: { id },
              data: { status: statusMap.INVALID },
            })
            .catch(() => {});
          this.logger.error(`账号（${id}）登录失效，已禁用`);
        } else if (errMsg.includes('WeReadError429')) {
          // 请求频繁：当日小黑屋（后续请求随机换账号）
          this.logger.error(`账号（${id}）请求频繁，打入小黑屋`);
        }

        const today = this.getTodayDate();
        if (errMsg.includes('WeReadError429') && id) {
          const blockedAccounts = blockedAccountsMap.get(today) || [];
          blockedAccountsMap.set(
            today,
            Array.from(new Set([...blockedAccounts, id])),
          );
        } else if (errMsg.includes('WeReadError400')) {
          this.logger.error(`账号（${id}）处理请求参数出错: ${errMsg}`);
          await new Promise((resolve) => setTimeout(resolve, 10 * 1e3));
        } else if (
          status !== 401 &&
          !errMsg.includes('WeReadError401') &&
          !errMsg.includes('WeReadError429')
        ) {
          this.logger.error("Can't handle this error: ", errMsg);
        }

        return Promise.reject(error);
      },
    );
  }

  /** 从今日小黑屋中移除账号（手动解除） */
  removeBlockedAccount(vid: string) {
    const today = this.getTodayDate();
    const blockedAccounts = blockedAccountsMap.get(today);
    if (Array.isArray(blockedAccounts)) {
      blockedAccountsMap.set(
        today,
        blockedAccounts.filter((id) => id !== vid),
      );
    }
  }

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  /** 今日小黑屋账号 id 列表（供前端展示） */
  getBlockedAccountIds() {
    const today = this.getTodayDate();
    const disabledAccounts = blockedAccountsMap.get(today) || [];
    return disabledAccounts.filter(Boolean);
  }

  /**
   * 随机选一个可用读书账号（排除当日小黑屋 + 非启用状态）
   * 返回解密后的 token（加密存储，请求时需明文 Bearer）
   */
  private async getAvailableAccount() {
    const disabledAccounts = this.getBlockedAccountIds();
    const accounts = await this.prismaService.account.findMany({
      where: {
        status: statusMap.ENABLE,
        pipeline: 1,
        NOT: { id: { in: disabledAccounts } },
      },
      take: 10,
    });
    if (!accounts || accounts.length === 0) {
      throw new Error('方案1暂无可用账号，请在方案1下重新扫码登录');
    }
    const account = accounts[Math.floor(Math.random() * accounts.length)];
    return {
      ...account,
      token: this.cryptoService.decrypt(account.token),
    };
  }

  async getStatus() {
    const blockedIds = this.getBlockedAccountIds();
    const enabledCount = await this.prismaService.account.count({
      where: { status: statusMap.ENABLE, pipeline: 1 },
    });
    const availableCount = await this.prismaService.account.count({
      where: {
        status: statusMap.ENABLE,
        pipeline: 1,
        NOT: { id: { in: blockedIds } },
      },
    });
    return {
      enabledCount,
      availableCount,
      blockedCount: blockedIds.length,
      limited: enabledCount > 0 && availableCount === 0,
      ready: availableCount > 0,
    };
  }

  /**
   * 获取公众号文章列表（weread 平台，每页 20 篇）
   * @param mpId 公众号 id（feed.id，即 fakeid）
   * @param page 页码（1 起始）
   */
  async getMpArticles(mpId: string, page = 1, retryCount = 3) {
    const account = await this.getAvailableAccount();
    try {
      const res = await this.request
        .get<
          {
            id: string;
            title: string;
            picUrl: string;
            publishTime: number;
          }[]
        >(`/api/v2/platform/mps/${mpId}/articles`, {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
          params: { page },
        })
        .then((r) => r.data);
      this.logger.log(
        `weread getMpArticles(${mpId}) page ${page} articles: ${res.length}`,
      );
      return res;
    } catch (err) {
      this.logger.error(
        `getMpArticles(${mpId}) page ${page} error: `,
        (err as Error).message,
      );
      if (retryCount > 0) {
        return this.getMpArticles(mpId, page, retryCount - 1);
      }
      throw err;
    }
  }

  /** 通过文章链接反查公众号信息（添加订阅用） */
  async getMpInfo(url: string) {
    const account = await this.getAvailableAccount();
    return this.request
      .post<
        {
          id: string;
          cover: string;
          name: string;
          intro: string;
          updateTime: number;
        }[]
      >(
        `/api/v2/platform/wxs2mp`,
        { url },
        {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
        },
      )
      .then((r) => r.data);
  }

  /** 获取微信读书登录二维码（把微信链接生成本地二维码图，走 /img 静态托管） */
  async createLoginUrl() {
    const data = await this.request
      .get<{
        uuid: string;
        scanUrl: string;
      }>(`/api/v2/login/platform`)
      .then((r) => r.data);

    if (data?.uuid && data?.scanUrl) {
      try {
        const qrDir = join(__dirname, '..', '..', 'data', 'images');
        await mkdir(qrDir, { recursive: true }).catch(() => {});
        // weread 返回的是 open.weixin.qq.com 链接，前端 <img> 无法直接展示，转成二维码图
        const png = await QRCode.toBuffer(data.scanUrl, {
          width: 320,
          margin: 2,
        });
        const qrFile = join(qrDir, `qr_${data.uuid}.png`);
        await writeFile(qrFile, png);
        return { uuid: data.uuid, scanUrl: `/img/qr_${data.uuid}.png` };
      } catch (e) {
        this.logger.error(`生成微信读书二维码失败: ${(e as Error).message}`);
      }
    }
    return data;
  }

  /** 轮询扫码登录结果，成功后返回 vid/token/username */
  async getLoginResult(id: string) {
    return this.request
      .get<{
        message: string;
        vid?: number;
        token?: string;
        username?: string;
      }>(`/api/v2/login/platform/${id}`, { timeout: 120 * 1e3 })
      .then((r) => r.data);
  }
}
