/**
 * Security utilities for Midea LAN protocol.
 *
 * All methods are static — mirrors the Python `Security` class from
 * `msmart.lan`. Uses only `node:crypto` (no npm dependencies).
 *
 * @module security
 */

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

/** PKCS#7 pad `data` to a multiple of `blockSize` bytes. */
function pkcs7Pad(data: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (data.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, padding]);
}

/** PKCS#7 unpad `data`. Throws if the padding is invalid. */
function pkcs7Unpad(data: Buffer, blockSize: number): Buffer {
  if (data.length === 0 || data.length % blockSize !== 0) {
    throw new Error("Invalid PKCS7 padded data length.");
  }

  const padLen = data[data.length - 1]!;

  if (padLen === undefined || padLen === 0 || padLen > blockSize) {
    throw new Error(`Invalid PKCS7 padding byte: ${padLen}`);
  }

  // Verify every padding byte
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) {
      throw new Error("Invalid PKCS7 padding.");
    }
  }

  return data.subarray(0, data.length - padLen);
}

/**
 * Static security helpers used throughout the Midea LAN protocol.
 *
 * Provides AES encryption/decryption (CBC and ECB), HMAC-style signing,
 * and device-ID hashing exactly matching the Python `Security` class.
 */
export class Security {
  /** Signing key shared with the cloud API. */
  static readonly SIGN_KEY: Buffer = Buffer.from(
    "xhdiwjnchekd4d512chdjx5d8e4c394D2D7S",
    "utf-8",
  );

  /** AES-128 key derived as `md5(SIGN_KEY)`. */
  static readonly ENC_KEY: Buffer = createHash("md5")
    .update(Security.SIGN_KEY)
    .digest();

  // ── AES-CBC (raw, no padding) ────────────────────────────────────────

  /** Resolve the AES-CBC cipher name from key length. */
  private static _aesCbcCipher(key: Buffer): string {
    switch (key.length) {
      case 16: return "aes-128-cbc";
      case 24: return "aes-192-cbc";
      case 32: return "aes-256-cbc";
      default: throw new Error(`Invalid AES key length: ${key.length}`);
    }
  }

  /**
   * Decrypt `data` with AES-CBC using a zero IV.
   *
   * Automatically selects AES-128/192/256 based on key length.
   * No PKCS#7 unpadding is performed.
   */
  static decryptAesCbc(key: Buffer, data: Buffer): Buffer {
    const iv = Buffer.alloc(16, 0);
    const decipher = createDecipheriv(Security._aesCbcCipher(key), key, iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  /**
   * Encrypt `data` with AES-CBC using a zero IV.
   *
   * Automatically selects AES-128/192/256 based on key length.
   * No PKCS#7 padding is applied — `data.length` **must** already be a
   * multiple of 16.
   */
  static encryptAesCbc(key: Buffer, data: Buffer): Buffer {
    const iv = Buffer.alloc(16, 0);
    const cipher = createCipheriv(Security._aesCbcCipher(key), key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }

  // ── AES-ECB (with PKCS#7 padding) ───────────────────────────────────

  /**
   * Decrypt `data` with AES-128-ECB using the shared {@link ENC_KEY}.
   *
   * PKCS#7 padding is removed after decryption.
   */
  static decryptAes(data: Buffer): Buffer {
    const decipher = createDecipheriv("aes-128-ecb", Security.ENC_KEY, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return pkcs7Unpad(decrypted, 16);
  }

  /**
   * Encrypt `data` with AES-128-ECB using the shared {@link ENC_KEY}.
   *
   * PKCS#7 padding is applied before encryption.
   */
  static encryptAes(data: Buffer): Buffer {
    const padded = pkcs7Pad(data, 16);
    const cipher = createCipheriv("aes-128-ecb", Security.ENC_KEY, null);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
  }

  // ── Signing & hashing ───────────────────────────────────────────────

  /**
   * Compute `md5(data + SIGN_KEY)` and return the raw 16-byte digest.
   */
  static sign(data: Buffer): Buffer {
    return createHash("md5")
      .update(Buffer.concat([data, Security.SIGN_KEY]))
      .digest();
  }

  /**
   * Derive a 16-byte UDP-ID from a device ID buffer.
   *
   * `sha256(deviceId)` is computed, then the first 16 bytes are XOR-ed
   * with the last 16 bytes.
   */
  static udpid(deviceId: Buffer): Buffer {
    const hash = createHash("sha256").update(deviceId).digest();
    return Security.xor(hash.subarray(0, 16), hash.subarray(16));
  }

  /**
   * Byte-wise XOR of two equal-length buffers.
   *
   * Equivalent to `Crypto.Util.strxor` from PyCryptodome.
   *
   * @throws {Error} If `a` and `b` have different lengths.
   */
  static xor(a: Buffer, b: Buffer): Buffer {
    if (a.length !== b.length) {
      throw new Error(
        `xor: buffer length mismatch (${a.length} vs ${b.length})`,
      );
    }
    const result = Buffer.alloc(a.length);
    for (let i = 0; i < a.length; i++) {
      result[i] = a[i]! ^ b[i]!;
    }
    return result;
  }
}
