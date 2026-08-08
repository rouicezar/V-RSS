import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(() => {
    const configService = { get: jest.fn() } as any;
    const appService = new AppService(configService);
    appController = new AppController(appService, configService);
  });

  describe('root', () => {
    it('返回管理界面入口', () => {
      expect(appController.getHello()).toContain('href="/dash"');
    });
  });
});
