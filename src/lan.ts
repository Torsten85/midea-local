/**
 * Module for local network control of Midea AC devices.
 *
 * Ported from msmart/lan.py
 * @module lan
 */

import { createHash, randomBytes } from "node:crypto";
import * as net from "node:net";
import { Security } from "./security.ts";

// ─── Token / Key types ──────────────────────────────────────────────────────

/** Acceptable token input: hex string, Buffer, or null/undefined. */
export type Token = string | Buffer | null | undefined;

/** Acceptable key input: hex string, Buffer, or null/undefined. */
export type Key = string | Buffer | null | undefined;

// ─── Error classes ──────────────────────────────────────────────────────────

/** General protocol error. */
export class ProtocolError extends Error {
  constructor(message?: string | Error) {
    super(message instanceof Error ? message.message : message);
    this.name = "ProtocolError";
  }
}

/** Authentication-specific protocol error. */
export class AuthenticationError extends ProtocolError {
  constructor(message?: string | Error) {
    super(message);
    this.name = "AuthenticationError";
  }
}

// ─── Async Queue ────────────────────────────────────────────────────────────

/** Error thrown when a non-blocking get is attempted on an empty queue. */
class QueueEmpty extends Error {
  constructor() {
    super("Queue is empty");
    this.name = "QueueEmpty";
  }
}

/**
 * Simple promise-based async queue, similar to `asyncio.Queue`.
 *
 * Items can be put synchronously and retrieved asynchronously with an
 * optional timeout.
 */
class AsyncQueue<T> {
  private _items: T[] = [];
  private _waiters: Array<(item: T) => void> = [];

  /** Enqueue an item. If a consumer is waiting, resolve immediately. */
  put(item: T): void {
    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift()!;
      resolve(item);
    } else {
      this._items.push(item);
    }
  }

  /**
   * Dequeue an item.
   *
   * @param timeout — seconds to wait. `0` means non-blocking (throws
   * `QueueEmpty` immediately if nothing is available).
   */
  async get(timeout: number = 2): Promise<T> {
    // Non-blocking path
    if (this._items.length > 0) {
      return this._items.shift()!;
    }

    if (timeout === 0) {
      throw new QueueEmpty();
    }

    // Blocking path with timeout
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Remove the waiter
          const idx = this._waiters.indexOf(wrappedResolve);
          if (idx !== -1) this._waiters.splice(idx, 1);
          reject(new Error("Timeout"));
        }
      }, timeout * 1000);

      const wrappedResolve = (item: T) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(item);
        }
      };

      this._waiters.push(wrappedResolve);
    });
  }

  /** Discard all queued items. */
  flush(): void {
    this._items.length = 0;
  }
}

// ─── Packet (V2) ────────────────────────────────────────────────────────────

/**
 * Static utility for V2 packet encode / decode.
 *
 * V2 Packet layout:
 * - Header: 40 bytes
 *   - 2 byte start of packet: 0x5A5A
 *   - 2 byte message type: 0x0111
 *   - 2 byte packet length (LE)
 *   - 2 byte magic bytes: 0x2000
 *   - 4 byte message ID
 *   - 8 byte timestamp
 *   - 8 byte device ID (LE)
 *   - 12 byte reserved
 * - Payload: N bytes (AES-ECB encrypted frame)
 * - Sign: 16 bytes (MD5 of header+payload + SIGN_KEY)
 */
export class Packet {
  /** Encode a command frame into a V2 LAN packet. */
  static encode(deviceId: number, command: Buffer): Buffer {
    // Encrypt command
    const encryptedPayload = Security.encryptAes(command);

    // Compute total length: 40-byte header + payload + 16-byte sign
    const length = 40 + encryptedPayload.length + 16;

    // Build header (40 bytes)
    const header = Buffer.alloc(40);

    // Start of packet
    header[0] = 0x5a;
    header[1] = 0x5a;

    // Message type
    header[2] = 0x01;
    header[3] = 0x11;

    // Packet length (LE)
    header.writeUInt16LE(length, 4);

    // Magic bytes
    header[6] = 0x20;
    header[7] = 0x00;

    // Message ID: 4 zero bytes (offset 8..11) — already zero

    // Timestamp (offset 12..19)
    const ts = Packet.timestamp();
    ts.copy(header, 12);

    // Device ID as little-endian uint64 (offset 20..27)
    // Node Buffer doesn't have writeBigUInt64LE in all versions,
    // so write manually for maximum compat.
    header.writeBigUInt64LE(BigInt(deviceId), 20);

    // 12 reserved bytes (offset 28..39) — already zero

    const packet = Buffer.concat([header, encryptedPayload]);

    // Append sign (MD5)
    const sign = Security.sign(packet);
    return Buffer.concat([packet, sign]);
  }

  /** Decode a V2 LAN packet back into the inner command frame. */
  static decode(data: Buffer): Buffer {
    if (data.length < 6) {
      throw new ProtocolError(`Packet is too short: ${data.toString("hex")}`);
    }

    if (data[0] !== 0x5a || data[1] !== 0x5a) {
      throw new ProtocolError(
        `Unsupported packet: ${data.toString("hex")}`,
      );
    }

    const length = data.readUInt16LE(4);

    if (data.length < length) {
      throw new ProtocolError(
        `Packet is truncated. Expected ${length} bytes, only have ${data.length} bytes: ${data.toString("hex")}`,
      );
    }

    const packet = data.subarray(0, length);
    const encryptedFrame = packet.subarray(40, length - 16);
    const rxHash = packet.subarray(length - 16);

    // Verify hash
    const calcHash = Security.sign(Buffer.from(packet.subarray(0, length - 16)));
    if (!calcHash.equals(rxHash)) {
      throw new ProtocolError(
        "Calculated and received MD5 digest do not match.",
      );
    }

    // Decrypt frame
    return Security.decryptAes(Buffer.from(encryptedFrame));
  }

  /**
   * Build an 8-byte UTC timestamp in device format.
   *
   * Each byte is a 2-digit component of the timestamp:
   * `[centiseconds, second, minute, hour, day, month, yearLow, yearHigh]`
   */
  static timestamp(): Buffer {
    const now = new Date();
    const buf = Buffer.alloc(8);

    buf[0] = Math.floor(now.getUTCMilliseconds() / 10); // centiseconds
    buf[1] = now.getUTCSeconds();
    buf[2] = now.getUTCMinutes();
    buf[3] = now.getUTCHours();
    buf[4] = now.getUTCDate();
    buf[5] = now.getUTCMonth() + 1; // JS months are 0-based
    buf[6] = now.getUTCFullYear() % 100;
    buf[7] = Math.floor(now.getUTCFullYear() / 100);

    return buf;
  }
}

// ─── LanProtocol (V2 TCP wrapper) ──────────────────────────────────────────

/**
 * Midea LAN protocol — TCP socket wrapper with a promise-based receive queue.
 */
export class LanProtocol {
  protected _socket: net.Socket | null = null;
  protected _peer: string | null = null;
  protected _queue = new AsyncQueue<Buffer | Error>();

  /** Peer address string (e.g. `"192.168.1.100:6444"`). */
  get peer(): string | null {
    return this._peer;
  }

  /** Whether the underlying socket is connected and not destroyed. */
  get alive(): boolean {
    if (this._socket === null || this._socket.destroyed) {
      return false;
    }
    return true;
  }

  /**
   * Connect to a host/port via TCP.
   *
   * @param host - Hostname or IP address.
   * @param port - TCP port number.
   * @param timeout - Connection timeout in seconds (default 5).
   */
  async connect(host: string, port: number, timeout: number = 5): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connect timeout."));
      }, timeout * 1000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        this._socket = socket;
        const addr = socket.remoteAddress ?? host;
        const rport = socket.remotePort ?? port;
        this._peer = `${addr}:${rport}`;
        this._setupSocketHandlers(socket);
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(new ProtocolError(`Connect failed: ${err.message}`));
      });
    });
  }

  /** Attach data / close / error handlers to the socket. */
  protected _setupSocketHandlers(socket: net.Socket): void {
    socket.on("data", (data: Buffer) => {
      this._onData(data);
    });

    socket.on("close", (hadError: boolean) => {
      if (hadError) {
        this._queue.put(new Error("Connection closed with error."));
      }
    });

    socket.on("error", (err: Error) => {
      this._queue.put(err);
    });
  }

  /**
   * Handle incoming data from the socket.
   * Override in subclasses for protocol-specific framing.
   */
  protected _onData(data: Buffer): void {
    this._queue.put(data);
  }

  /** Disconnect from the peer. */
  disconnect(): void {
    if (this._socket === null) {
      throw new Error("Not connected.");
    }
    this._socket.destroy();
    this._socket = null;
  }

  /** Send raw data to the peer. */
  write(data: Buffer): void {
    if (this._socket === null) {
      throw new Error("Not connected.");
    }
    if (!this.alive) {
      throw new ProtocolError("Transport is closing or closed.");
    }
    this._socket.write(data);
  }

  /**
   * Asynchronously read data from the receive queue.
   *
   * @param timeout — seconds to wait (default 2). Use 0 for non-blocking.
   */
  async read(timeout: number = 2): Promise<Buffer> {
    return this._readQueue(timeout);
  }

  /** Read from the queue, re-throwing any queued errors. */
  protected async _readQueue(timeout: number = 2): Promise<Buffer> {
    const item = await this._queue.get(timeout);

    if (item instanceof Error) {
      throw new ProtocolError(item.message);
    }

    return item;
  }

  /** Discard all pending data in the queue. */
  protected _flush(): void {
    this._queue.flush();
  }
}

// ─── V3 Packet type const ───────────────────────────────────────────────────

/** V3 packet types. */
export const PACKET_TYPE = {
  HANDSHAKE_REQUEST: 0x0,
  HANDSHAKE_RESPONSE: 0x1,
  ENCRYPTED_RESPONSE: 0x3,
  ENCRYPTED_REQUEST: 0x6,
  ERROR: 0xf,
} as const;

export type PacketType = (typeof PACKET_TYPE)[keyof typeof PACKET_TYPE];

// ─── LanProtocolV3 ──────────────────────────────────────────────────────────

/** Authentication expiration in milliseconds (12 hours). */
const AUTH_LIFETIME_MS = 12 * 60 * 60 * 1000;

/**
 * Midea LAN protocol V3.
 *
 * Extends `LanProtocol` with 0x8370 packet framing, AES-CBC encryption,
 * SHA-256 signing, and a token-based authentication handshake.
 *
 * V3 Packet layout:
 * - Header: 6 bytes
 *   - 2 byte start of packet: 0x8370
 *   - 2 byte size of data payload, padding and sign (BE)
 *   - 1 byte special: 0x20
 *   - 1 byte: (pad << 4) | type
 * - Payload: 2 + N bytes
 *   - 2 byte request ID / count (BE)
 *   - N byte data
 * - Sign: 32 bytes (SHA-256 of header + unencrypted payload)
 */
export class LanProtocolV3 extends LanProtocol {
  private _packetId: number = 0;
  private _buffer: Buffer = Buffer.alloc(0);
  private _localKey: Buffer | null = null;
  private _localKeyExpiration: number | null = null;

  /** The negotiated local key (available after authentication). */
  get localKey(): Buffer | null {
    return this._localKey;
  }

  /** Whether the protocol is authenticated and the key hasn't expired. */
  get authenticated(): boolean {
    if (this._localKey === null || this._localKeyExpiration === null) {
      return false;
    }
    if (Date.now() > this._localKeyExpiration) {
      return false;
    }
    return true;
  }

  // ── Socket data handling (V3 framing) ──────────────────────────────────

  /**
   * Override data handler to buffer incoming bytes and extract
   * complete V3 packets.
   */
  protected override _onData(data: Buffer): void {
    // Append incoming data to buffer
    this._buffer = Buffer.concat([this._buffer, data]);

    // Process buffer until we can't extract any more complete packets
    while (this._buffer.length > 0) {
      // Find start of packet 0x8370
      const start = findBytes(this._buffer, [0x83, 0x70]);
      if (start === -1) {
        // No start marker found — discard buffer
        return;
      }

      // Trim any leading data before the marker
      if (start !== 0) {
        this._buffer = Buffer.from(this._buffer.subarray(start));
      }

      // Need at least the 6-byte header to read the length
      if (this._buffer.length < 6) {
        return;
      }

      // 6-byte header + 2-byte packet ID + padded encrypted payload
      const payloadSize = this._buffer.readUInt16BE(2);
      const totalSize = payloadSize + 8;

      // Ensure entire packet has been received
      if (this._buffer.length < totalSize) {
        return;
      }

      // Extract the packet and advance the buffer
      const packet = Buffer.from(this._buffer.subarray(0, totalSize));
      this._buffer = Buffer.from(this._buffer.subarray(totalSize));

      // Enqueue the complete packet
      this._queue.put(packet);
    }
  }

  // ── Read (V3 override) ─────────────────────────────────────────────────

  /** Read a V3 packet from the queue and process it. */
  override async read(timeout: number = 2): Promise<Buffer> {
    const packet = await this._readQueue(timeout);
    return this._processPacket(packet);
  }

  // ── Packet processing ─────────────────────────────────────────────────

  /** Route a raw V3 packet to the appropriate decoder by type. */
  private _processPacket(packet: Buffer): Buffer {
    if (packet[0] !== 0x83 || packet[1] !== 0x70) {
      throw new ProtocolError(
        `Invalid start of packet: ${packet.subarray(0, 2).toString("hex")}`,
      );
    }

    if (packet[4] !== 0x20) {
      throw new ProtocolError(
        `Invalid magic byte: 0x${packet[4]!.toString(16).toUpperCase()}`,
      );
    }

    const packetType = packet[5]! & 0x0f;

    switch (packetType) {
      case PACKET_TYPE.ENCRYPTED_RESPONSE:
        return this._decodeEncryptedResponse(packet);
      case PACKET_TYPE.HANDSHAKE_RESPONSE:
        return this._decodeHandshakeResponse(packet);
      case PACKET_TYPE.ERROR:
        throw new ProtocolError("Error packet received.");
      default:
        throw new ProtocolError(`Unexpected type: ${packetType}`);
    }
  }

  // ── Decode helpers ────────────────────────────────────────────────────

  /** Decode an encrypted response packet. */
  private _decodeEncryptedResponse(packet: Buffer): Buffer {
    if (this._localKey === null) {
      throw new ProtocolError("No local key available for decryption.");
    }

    const header = packet.subarray(0, 6);
    const payload = packet.subarray(6, packet.length - 32);
    const rxHash = packet.subarray(packet.length - 32);

    // Decrypt payload
    const decryptedPayload = Security.decryptAesCbc(this._localKey, Buffer.from(payload));

    // Verify hash: sha256(header + decryptedPayload)
    const calcHash = createHash("sha256")
      .update(header)
      .update(decryptedPayload)
      .digest();

    if (!calcHash.equals(rxHash)) {
      throw new ProtocolError(
        "Calculated and received SHA256 digest do not match.",
      );
    }

    // Get pad count from header
    const pad = header[5]! >> 4;

    // Extract frame: skip 2-byte packet ID, remove trailing padding
    const end = decryptedPayload.length - pad;
    return Buffer.from(decryptedPayload.subarray(2, end));
  }

  /** Decode a handshake response packet. */
  private _decodeHandshakeResponse(packet: Buffer): Buffer {
    const payload = packet.subarray(6);
    // Skip 2-byte packet ID
    return Buffer.from(payload.subarray(2));
  }

  // ── Build helpers ─────────────────────────────────────────────────────

  /** Build a 6-byte V3 header. */
  private _buildHeader(length: number, extra: Buffer): Buffer {
    const header = Buffer.alloc(6);
    header[0] = 0x83;
    header[1] = 0x70;
    header.writeUInt16BE(length, 2);
    header[4] = 0x20;
    extra.copy(header, 5);
    return header;
  }

  // ── Encode helpers ────────────────────────────────────────────────────

  /** Encode an encrypted request packet. */
  private _encodeEncryptedRequest(packetId: number, data: Buffer): Buffer {
    if (this._localKey === null) {
      throw new ProtocolError("Protocol has not been authenticated.");
    }

    // Compute required padding for 16-byte alignment
    // Include 2 bytes for packet ID in total length
    const remainder = (data.length + 2) % 16;
    const pad = remainder !== 0 ? 16 - remainder : 0;

    // Total length of payload + pad + 32-byte hash
    const length = data.length + pad + 32;

    // Build header
    const typeByte = Buffer.from([(pad << 4) | PACKET_TYPE.ENCRYPTED_REQUEST]);
    const header = this._buildHeader(length, typeByte);

    // Build payload: 2-byte packet ID (BE) + data + random padding
    const packetIdBuf = Buffer.alloc(2);
    packetIdBuf.writeUInt16BE(packetId, 0);
    const padBytes = randomBytes(pad);
    const payload = Buffer.concat([packetIdBuf, data, padBytes]);

    // Sign: sha256(header + unencrypted payload)
    const calcHash = createHash("sha256")
      .update(header)
      .update(payload)
      .digest();

    // Encrypt payload
    const encrypted = Security.encryptAesCbc(this._localKey, payload);

    return Buffer.concat([header, encrypted, calcHash]);
  }

  /** Encode a handshake request packet. */
  private _encodeHandshakeRequest(packetId: number, data: Buffer): Buffer {
    const typeByte = Buffer.from([PACKET_TYPE.HANDSHAKE_REQUEST]);
    const header = this._buildHeader(data.length, typeByte);

    const packetIdBuf = Buffer.alloc(2);
    packetIdBuf.writeUInt16BE(packetId, 0);
    const payload = Buffer.concat([packetIdBuf, data]);

    return Buffer.concat([header, payload]);
  }

  // ── Write (V3 override) ────────────────────────────────────────────────

  /**
   * Send a V3 packet of the specified type.
   *
   * @param data - The raw data payload.
   * @param packetType - V3 packet type (default: ENCRYPTED_REQUEST).
   */
  writeV3(
    data: Buffer,
    packetType: PacketType = PACKET_TYPE.ENCRYPTED_REQUEST,
  ): void {
    let packet: Buffer;

    if (packetType === PACKET_TYPE.ENCRYPTED_REQUEST) {
      packet = this._encodeEncryptedRequest(this._packetId, data);
    } else if (packetType === PACKET_TYPE.HANDSHAKE_REQUEST) {
      packet = this._encodeHandshakeRequest(this._packetId, data);
    } else {
      throw new TypeError(`Unknown type: ${packetType}`);
    }

    // Write raw bytes to the socket
    super.write(packet);

    // Increment packet ID and handle rollover (12-bit)
    this._packetId = (this._packetId + 1) & 0xfff;
  }

  // ── Key derivation ────────────────────────────────────────────────────

  /**
   * Derive the local key from a handshake response.
   *
   * @param key - The cloud key (16 bytes).
   * @param data - The 64-byte handshake response payload.
   * @returns The 16-byte local key.
   */
  private _getLocalKey(key: Buffer, data: Buffer): Buffer {
    if (data.length !== 64) {
      throw new AuthenticationError(
        "Invalid data length for key handshake.",
      );
    }

    const payload = data.subarray(0, 32);
    const rxHash = data.subarray(32);

    // Decrypt payload with provided key
    const decryptedPayload = Security.decryptAesCbc(key, Buffer.from(payload));

    // Verify SHA-256
    const calcHash = createHash("sha256").update(decryptedPayload).digest();
    if (!calcHash.equals(rxHash)) {
      throw new AuthenticationError(
        "Calculated and received SHA256 digest do not match.",
      );
    }

    // Construct local key: xor(decrypted, key)
    return Security.xor(decryptedPayload, key);
  }

  // ── Authentication ────────────────────────────────────────────────────

  /**
   * Authenticate with a V3 device using the provided token and key.
   *
   * Sends a handshake request, reads the response, and derives the local
   * key for subsequent encrypted communication.
   *
   * @param token - Authentication token (16 bytes).
   * @param key - Cloud key (16 bytes).
   */
  async authenticate(
    token: Buffer | null | undefined,
    key: Buffer | null | undefined,
  ): Promise<void> {
    if (!token || !key) {
      throw new AuthenticationError("Token and key must be supplied.");
    }

    // Flush any stale data
    this._flush();

    try {
      this.writeV3(token, PACKET_TYPE.HANDSHAKE_REQUEST);
      const response = await this.read();

      // Derive local key
      this._localKey = this._getLocalKey(key, response);

      // Set expiration
      this._localKeyExpiration = Date.now() + AUTH_LIFETIME_MS;
    } catch (e) {
      if (e instanceof ProtocolError) {
        throw new AuthenticationError(
          e instanceof Error ? e.message : String(e),
        );
      }
      throw e;
    }
  }
}

// ─── Lan (high-level API) ───────────────────────────────────────────────────

/** Number of retries for send/authenticate operations. */
const RETRIES = 3;

/**
 * High-level API for communicating with a Midea device over LAN.
 *
 * Handles connection management, protocol version selection, authentication,
 * V2 packet encoding/decoding, and retries.
 */
export class Lan {
  private _ip: string;
  private _port: number;
  private _deviceId: number;

  private _token: Buffer | null = null;
  private _key: Buffer | null = null;
  private _protocolVersion: number = 2;
  private _protocol: LanProtocol | LanProtocolV3 | null = null;

  private _connectionExpiration: number | null = null;
  private _maxConnectionLifetimeMs: number | null = null;

  constructor(host: string, port: number, deviceId: number) {
    this._ip = host;
    this._port = port;
    this._deviceId = deviceId;
  }

  // ── Token / Key ────────────────────────────────────────────────────────

  /** Current authentication token. */
  get token(): Buffer | null {
    return this._token;
  }

  /** Current cloud key. */
  get key(): Buffer | null {
    return this._key;
  }

  // ── Connection lifetime ────────────────────────────────────────────────

  /** Maximum connection lifetime in seconds, or `null` for unlimited. */
  get maxConnectionLifetime(): number | null {
    if (this._maxConnectionLifetimeMs === null) return null;
    return Math.floor(this._maxConnectionLifetimeMs / 1000);
  }

  set maxConnectionLifetime(seconds: number | null) {
    this._maxConnectionLifetimeMs =
      seconds === null ? null : seconds * 1000;
  }

  // ── Private connection helpers ─────────────────────────────────────────

  /** Whether the protocol is connected and the connection hasn't expired. */
  private get _alive(): boolean {
    if (this._protocol === null || !this._protocol.alive) {
      return false;
    }

    if (
      this._connectionExpiration !== null &&
      Date.now() > this._connectionExpiration
    ) {
      return false;
    }

    return true;
  }

  /** Create a new TCP connection using the appropriate protocol version. */
  private async _connect(): Promise<void> {
    const protocol =
      this._protocolVersion === 3 ? new LanProtocolV3() : new LanProtocol();

    await protocol.connect(this._ip, this._port, 5);

    this._protocol = protocol;

    if (this._maxConnectionLifetimeMs !== null) {
      this._connectionExpiration = Date.now() + this._maxConnectionLifetimeMs;
    }
  }

  /** Disconnect and clear the protocol reference. */
  private _disconnect(): void {
    if (this._protocol) {
      try {
        this._protocol.disconnect();
      } catch {
        // Ignore errors during disconnect
      }
      this._protocol = null;
    }
  }

  // ── Authentication ────────────────────────────────────────────────────

  /**
   * Authenticate against a V3 device.
   *
   * Uses cached token/key unless new ones are provided. Accepts hex strings
   * or Buffers.
   *
   * @param token - Authentication token (hex string or Buffer).
   * @param key - Cloud key (hex string or Buffer).
   * @param retries - Number of retries on timeout (default 3).
   */
  async authenticate(
    token: Token = null,
    key: Key = null,
    retries: number = RETRIES,
  ): Promise<void> {
    let tokenBuf: Buffer | null;
    let keyBuf: Buffer | null;

    if (token === null || token === undefined || key === null || key === undefined) {
      tokenBuf = this._token;
      keyBuf = this._key;
    } else {
      tokenBuf =
        typeof token === "string" ? Buffer.from(token, "hex") : token;
      keyBuf = typeof key === "string" ? Buffer.from(key, "hex") : key;
    }

    // Create V3 connection if needed
    if (!this._alive || !(this._protocol instanceof LanProtocolV3)) {
      this._disconnect();
      this._protocolVersion = 3;
      await this._connect();
    }

    const proto = this._protocol as LanProtocolV3;

    // Attempt authentication with retries
    let remaining = retries;
    while (remaining > 0) {
      try {
        await proto.authenticate(tokenBuf, keyBuf);
        break;
      } catch (e) {
        if (e instanceof AuthenticationError) {
          this._disconnect();
          throw e;
        }
        // Timeout — retry
        if (remaining > 1) {
          remaining--;
        } else {
          this._disconnect();
          throw new Error("No response from host.");
        }
      }
    }

    // Update stored credentials on success
    this._token = tokenBuf;
    this._key = keyBuf;

    // Brief sleep before requesting data (matches Python behaviour)
    await sleep(1000);
  }

  // ── Read helpers ──────────────────────────────────────────────────────

  /** Read and decode a V2 frame from the protocol. */
  private async _read(timeout?: number): Promise<Buffer> {
    if (this._protocol === null) {
      throw new ProtocolError("Not connected.");
    }

    const packet = await this._protocol.read(timeout);
    return Packet.decode(packet);
  }

  /**
   * Async generator that reads all immediately available responses
   * from the queue without blocking.
   */
  private async *_readAvailable(): AsyncGenerator<Buffer> {
    try {
      while (true) {
        yield await this._read(0);
      }
    } catch {
      // QueueEmpty or timeout — stop iterating
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────

  /**
   * Send data via the LAN protocol, connecting and authenticating as needed.
   *
   * @param data - The command frame to send.
   * @param retries - Number of retries on timeout (default 3).
   * @returns An array of decoded response frames.
   */
  async send(data: Buffer, retries: number = RETRIES): Promise<Buffer[]> {
    // Connect if needed
    if (!this._alive) {
      this._disconnect();
      await this._connect();
    }

    if (this._protocol === null) {
      throw new ProtocolError("Not connected.");
    }

    // Authenticate V3 if needed
    if (
      this._protocol instanceof LanProtocolV3 &&
      !this._protocol.authenticated
    ) {
      await this.authenticate();
    }

    // Encode the command frame into a V2 packet
    const packet = Packet.encode(this._deviceId, data);

    const responses: Buffer[] = [];

    // Drain any sporadically received responses
    for await (const resp of this._readAvailable()) {
      responses.push(resp);
    }

    // Send with retries
    let remaining = retries;
    while (remaining > 0) {
      // Send the packet
      if (this._protocol instanceof LanProtocolV3) {
        (this._protocol as LanProtocolV3).writeV3(packet);
      } else {
        this._protocol.write(packet);
      }

      try {
        responses.push(await this._read());
        break;
      } catch (e) {
        if (e instanceof ProtocolError) {
          // Protocol error — disconnect and re-raise
          this._disconnect();
          throw e;
        }
        // Timeout — retry
        if (remaining > 1) {
          remaining--;
        } else {
          this._disconnect();
          throw new Error("No response from host.");
        }
      }
    }

    // Read any additional immediately available responses
    for await (const resp of this._readAvailable()) {
      responses.push(resp);
    }

    return responses;
  }
}

// ─── Utility functions ──────────────────────────────────────────────────────

/** Find the first occurrence of a byte sequence in a buffer. Returns -1 if not found. */
function findBytes(buf: Buffer, pattern: number[]): number {
  outer: for (let i = 0; i <= buf.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
