import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.MAX_REQUEST_PER_MINUTE;
    delete process.env.UPDATE_DELAY_TIME;
    delete process.env.DATABASE_TYPE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses valid numeric defaults instead of NaN', () => {
    const result = configuration();
    expect(result.server.port).toBe(4000);
    expect(result.throttler.maxRequestPerMinute).toBe(60);
    expect(result.feed.updateDelayTime).toBe(60);
  });

  it('rejects invalid or non-positive numeric environment values', () => {
    process.env.PORT = 'not-a-number';
    process.env.MAX_REQUEST_PER_MINUTE = '-1';
    process.env.UPDATE_DELAY_TIME = '0';
    const result = configuration();
    expect(result.server.port).toBe(4000);
    expect(result.throttler.maxRequestPerMinute).toBe(60);
    expect(result.feed.updateDelayTime).toBe(60);
  });

  it('keeps the supported database type fixed to sqlite', () => {
    process.env.DATABASE_TYPE = 'mysql';
    expect(configuration().database.type).toBe('sqlite');
  });
});
