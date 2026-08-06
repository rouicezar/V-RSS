import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Token 加密工具服务
 *
 * 用法：
 *   存储前：encrypt(plaintext) → 返回 hex 编码密文
 *   读取后：decrypt(ciphertext) → 返回原始明文
 *
 * 密钥派生：ENCRYPTION_KEY → scrypt → 256-bit key
 * 若未配置 ENCRYPTION_KEY 则回退到 AUTH_CODE（兼容旧数据）
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  private ensureKey(): Buffer {
    if (this.key) return this.key;

    const encryptionKey = process.env.ENCRYPTION_KEY;
    const authCode = process.env.AUTH_CODE;

    if (!encryptionKey && !authCode) {
      this.logger.warn(
        'ENCRYPTION_KEY 和 AUTH_CODE 均未配置，Token 将明文存储（不安全）',
      );
      this.initialized = false;
      return Buffer.alloc(0); // 哨兵值
    }

    const raw = encryptionKey || authCode || 'fallback-not-secure';
    this.key = scryptSync(raw, 'vrss-salt-2024', 32);
    this.initialized = true;
    return this.key;
  }

  /**
   * 加密明文 token，返回 hex 格式：salt + iv + authTag + ciphertext
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return '';

    const key = this.ensureKey();
    if (key.length === 0) {
      // 无密钥可用：明文 base64 编码（兼容，非安全存储）
      return Buffer.from(plaintext, 'utf-8').toString('base64');
    }

    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);

      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf-8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // 格式：salt(32B) + iv(16B) + authTag(16B) + encrypted
      const salt = randomBytes(SALT_LENGTH);
      const result = Buffer.concat([salt, iv, authTag, encrypted]);
      return result.toString('hex');
    } catch (e) {
      this.logger.error(`加密失败: ${(e as Error).message}`);
      // 降级：base64 编码
      return Buffer.from(plaintext, 'utf-8').toString('base64');
    }
  }

  /**
   * 解密密文 token，返回原始明文
   * 同时兼容旧版本的明文 token（向后兼容）
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';

    const key = this.ensureKey();
    if (key.length === 0) {
      // 无密钥可用：尝试 base64 解码
      try {
        return Buffer.from(ciphertext, 'base64').toString('utf-8');
      } catch {
        return ciphertext; // 明文存储的旧数据
      }
    }

    try {
      const buf = Buffer.from(ciphertext, 'hex');

      // 检查是否为加密格式（至少需要 salt + iv + tag = 64 字节）
      if (buf.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
        // 不是加密格式，可能是旧版明文或 base64
        try {
          return Buffer.from(ciphertext, 'base64').toString('utf-8');
        } catch {
          return ciphertext;
        }
      }

      const salt = buf.subarray(0, SALT_LENGTH);
      const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const authTag = buf.subarray(
        SALT_LENGTH + IV_LENGTH,
        SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
      );
      const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf-8');
    } catch {
      // 解密失败，可能是旧版明文数据
      if (ciphertext.includes('token=') || ciphertext.includes(';')) {
        return ciphertext; // 旧版明文 cookie 串
      }
      try {
        return Buffer.from(ciphertext, 'base64').toString('utf-8');
      } catch {
        return ciphertext;
      }
    }
  }
}
