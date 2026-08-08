jest.mock('axios-cookiejar-support', () => ({ wrapper: jest.fn() }));

import { FeedsController } from './feeds.controller';

describe('FeedsController', () => {
  let controller: FeedsController;

  beforeEach(() => {
    controller = new FeedsController({} as any);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
