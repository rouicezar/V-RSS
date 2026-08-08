import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigurationType } from './configuration';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', './package.json'), 'utf-8'),
);

const appVersion = packageJson.version;
console.log('appVersion: v' + appVersion);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  const configService = app.get(ConfigService);

  const { host, isProd, port } =
    configService.get<ConfigurationType['server']>('server')!;

  if (isProd) {
    const authCode = process.env.AUTH_CODE?.trim();
    const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
    const unsafeValues = new Set(['changeme', '123456', 'password']);
    if (!authCode || authCode.length < 12 || unsafeValues.has(authCode)) {
      throw new Error('生产环境 AUTH_CODE 必须设置为至少 12 位的非默认值');
    }
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('生产环境 ENCRYPTION_KEY 必须设置为至少 32 位随机字符串');
    }
  }

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });

  app.useStaticAssets(join(__dirname, '..', 'client', 'assets'), {
    prefix: '/dash/assets/',
  });
  // WeRSS 扩展：正文本地图片托管
  app.useStaticAssets(join(__dirname, '..', 'data', 'images'), {
    prefix: '/img/',
  });
  app.setBaseViewsDir(join(__dirname, '..', 'client'));
  app.setViewEngine('hbs');

  // CORS：仅允许配置的 origin，公网部署时用 SERVER_ORIGIN_URL
  const originUrl = process.env.SERVER_ORIGIN_URL || `http://${host}:${port}`;
  app.enableCors({
    origin: isProd ? originUrl.replace(/\/$/, '') : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  const trpc = app.get(TrpcRouter);
  trpc.applyMiddleware(app);

  await app.listen(port, host);

  console.log(`Server is running at http://${host}:${port}`);
}
bootstrap().catch((error) => {
  console.error('[bootstrap]', error);
  process.exitCode = 1;
});
