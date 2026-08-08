import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-hex-string!!!';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();
    service = module.get<CryptoService>(CryptoService);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  describe('encrypt / decrypt roundtrip', () => {
    it('加密后解密得到原始明文', () => {
      const plain = 'token=abc123; cookies=session_data';
      const encrypted = service.encrypt(plain);
      expect(encrypted).not.toBe(plain);
      expect(encrypted).toBeTruthy();
      expect(service.decrypt(encrypted)).toBe(plain);
    });

    it('长 token 加解密正确', () => {
      const plain = 'a'.repeat(2048);
      const encrypted = service.encrypt(plain);
      expect(service.decrypt(encrypted)).toBe(plain);
    });

    it('每次加密输出不同（随机 salt + iv）', () => {
      const plain = 'same-token';
      const r1 = service.encrypt(plain);
      const r2 = service.encrypt(plain);
      expect(r1).not.toBe(r2);
    });
  });

  describe('encrypt 边界', () => {
    it('空字符串返回空字符串', () => {
      expect(service.encrypt('')).toBe('');
    });
  });

  describe('decrypt 边界', () => {
    it('空字符串返回空字符串', () => {
      expect(service.decrypt('')).toBe('');
    });

    it('旧版明文 token（含 = ; 等非 hex 字符）原样返回', () => {
      const legacy = 'token=legacy123; session=abc';
      expect(service.decrypt(legacy)).toBe(legacy);
    });

    it('纯 hex 但长度不足的字符串原样返回', () => {
      const short = 'deadbeef';
      expect(service.decrypt(short)).toBe(short);
    });

    it('无效密文（伪造 hex）原样返回不抛异常', () => {
      const fake = '0'.repeat(128);
      const result = service.decrypt(fake);
      expect(typeof result).toBe('string');
    });
  });
});

describe('CryptoService - fallback（无密钥）', () => {
  let service: CryptoService;

  beforeEach(async () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.AUTH_CODE;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get<CryptoService>(CryptoService);
  });

  it('无密钥时 encrypt 走 base64 降级', () => {
    const result = service.encrypt('hello');
    const decoded = Buffer.from(result, 'base64').toString('utf-8');
    expect(decoded).toBe('hello');
  });

  it('无密钥时 decrypt 原样返回', () => {
    expect(service.decrypt('anything')).toBe('anything');
  });
});

describe('CryptoService - AUTH_CODE 回退', () => {
  let service: CryptoService;

  beforeEach(async () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.AUTH_CODE = 'fallback-auth-code';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();
    service = module.get<CryptoService>(CryptoService);
  });

  afterEach(() => {
    delete process.env.AUTH_CODE;
  });

  it('仅 AUTH_CODE 时加解密正常', () => {
    const plain = 'token-test-data';
    const encrypted = service.encrypt(plain);
    expect(service.decrypt(encrypted)).toBe(plain);
  });
});
