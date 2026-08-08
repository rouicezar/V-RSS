jest.mock('axios-cookiejar-support', () => ({ wrapper: jest.fn() }));

import { FeedsService } from './feeds.service';

describe('FeedsService', () => {
  let service: FeedsService;

  beforeEach(() => {
    service = Object.create(FeedsService.prototype);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
