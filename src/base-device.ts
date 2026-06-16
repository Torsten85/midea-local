/**
 * Base device class for Midea smart appliances.
 *
 * Ported from msmart/base_device.py
 * @module
 */

import type { DeviceType } from "./const.ts";
import { DEVICE_TYPE } from "./const.ts";
import type { Frame } from "./frame.ts";
import { Lan, AuthenticationError, ProtocolError } from "./lan.ts";
import { CapabilityManager } from "./utils.ts";

// Re-export for convenience
export { AuthenticationError };

/** Accepted types for a device authentication token. */
export type Token = string | Buffer;

/** Accepted types for a device authentication key. */
export type Key = string | Buffer;

/**
 * Base class for all Midea device types.
 *
 * Manages network communication via {@link Lan} and exposes common properties.
 * Subclass for specific device types (e.g. `AirConditioner`).
 */
export class Device {
  /** Map of supported capability override keys to attribute/type info. */
  protected static _SUPPORTED_CAPABILITY_OVERRIDES: Record<
    string,
    [string, string]
  > = {};

  protected _ip: string;
  protected _port: number;
  protected _id: number;
  protected _type: DeviceType;
  protected _sn: string | null;
  protected _name: string | null;
  protected _version: number | null;

  protected _lan: Lan;
  protected _supported: boolean;
  protected _online: boolean;

  constructor(opts: {
    ip: string;
    port: number;
    deviceId: number;
    deviceType: DeviceType;
    sn?: string | null;
    name?: string | null;
    version?: number | null;
  }) {
    this._ip = opts.ip;
    this._port = opts.port;
    this._id = opts.deviceId;
    this._type = opts.deviceType;
    this._sn = opts.sn ?? null;
    this._name = opts.name ?? null;
    this._version = opts.version ?? null;

    this._lan = new Lan(opts.ip, opts.port, opts.deviceId);
    this._supported = false;
    this._online = false;
  }

  /**
   * Send a command to the device and return any responses.
   * @internal
   */
  protected async _sendCommand(command: Frame): Promise<Uint8Array[]> {
    const data = command.toBytes();

    const start = performance.now();
    let responses: Uint8Array[] = [];
    try {
      responses = await this._lan.send(Buffer.from(data));
    } catch (e) {
      if (e instanceof ProtocolError) {
        console.error(`Network error ${this._ip}:${this._port}: ${e.message}`);
        return [];
      }
      if (e instanceof Error && e.name === "TimeoutError") {
        console.warn(`Network timeout ${this._ip}:${this._port}: ${e.message}`);
      } else {
        throw e;
      }
    } finally {
      const responseTime = ((performance.now() - start) / 1000).toFixed(2);

      if (responses.length === 0) {
        console.warn(
          `No response from ${this._ip}:${this._port} in ${responseTime} seconds.`,
        );
      }
    }

    return responses;
  }

  /** Refresh the local copy of the device state. */
  async refresh(): Promise<void> {
    throw new Error("Not implemented");
  }

  /** Apply the local state to the device. */
  async apply(): Promise<void> {
    throw new Error("Not implemented");
  }

  /** Authenticate with a V3 device. */
  async authenticate(token: Token, key: Key): Promise<void> {
    try {
      await this._lan.authenticate(token, key);
    } catch (e) {
      if (e instanceof ProtocolError || (e instanceof Error && e.name === "TimeoutError")) {
        throw new AuthenticationError(
          e instanceof Error ? e.message : String(e),
        );
      }
      throw e;
    }
  }

  /** Set the maximum connection lifetime of the LAN protocol. */
  setMaxConnectionLifetime(seconds: number | null): void {
    this._lan.maxConnectionLifetime = seconds;
  }

  get ip(): string {
    return this._ip;
  }

  get port(): number {
    return this._port;
  }

  get id(): number {
    return this._id;
  }

  /** Token as a hex string, or `null` if not set. */
  get token(): string | null {
    const t = this._lan.token;
    if (t == null) return null;
    return Buffer.from(t).toString("hex");
  }

  /** Key as a hex string, or `null` if not set. */
  get key(): string | null {
    const k = this._lan.key;
    if (k == null) return null;
    return Buffer.from(k).toString("hex");
  }

  get type(): DeviceType {
    return this._type;
  }

  get name(): string | null {
    return this._name;
  }

  get sn(): string | null {
    return this._sn;
  }

  get version(): number | null {
    return this._version;
  }

  get online(): boolean {
    return this._online;
  }

  get supported(): boolean {
    return this._supported;
  }

  toDict(): Record<string, unknown> {
    return {
      ip: this.ip,
      port: this.port,
      id: this.id,
      online: this.online,
      supported: this.supported,
      type: this.type,
      name: this.name,
      sn: this.sn,
      key: this.key,
      token: this.token,
    };
  }

  capabilitiesDict(): Record<string, unknown> {
    throw new Error("Not implemented");
  }

  toString(): string {
    return JSON.stringify(this.toDict());
  }

  /**
   * Dump device capabilities as an easily serializable dict.
   *
   * Converts const-object values to their names, arrays/sets to arrays, etc.
   */
  serializeCapabilities(): Record<string, unknown> {
    return this.capabilitiesDict();
  }

  /**
   * Override device capabilities via serialized dict.
   *
   * @param overrides - Map of capability key to new value.
   * @param opts      - Options. If `merge` is true, list values are merged
   *                    with existing rather than replaced.
   */
  overrideCapabilities(
    overrides: Record<string, unknown>,
    opts?: { merge?: boolean },
  ): void {
    const merge = opts?.merge ?? false;
    const supported =
      (this.constructor as typeof Device)._SUPPORTED_CAPABILITY_OVERRIDES;

    for (const [key, value] of Object.entries(overrides)) {
      if (!(key in supported)) {
        throw new Error(`Unsupported capabilities override '${key}'.`);
      }

      const [attrName, valueType] = supported[key]!;

      // Handle numeric overrides
      if (valueType === "float") {
        if (typeof value !== "number") {
          throw new Error(`'${key}' must be a number.`);
        }
        (this as any)[attrName] = value;
        continue;
      }

      // Handle CapabilityManager — update flags instead of replacing
      const attr = (this as any)[attrName];
      if (attr instanceof CapabilityManager) {
        // When value is an array, OR all values together into flags
        let newFlags: number;
        if (Array.isArray(value)) {
          newFlags = (value as number[]).reduce((acc, v) => acc | v, 0);
        } else {
          newFlags = value as number;
        }
        if (merge) {
          attr.flags = (attr.flags | newFlags) as any;
        } else {
          attr.flags = newFlags as any;
        }
        continue;
      }

      // Handle list overrides (enum names, etc.)
      if (Array.isArray(value)) {
        if (merge) {
          const existing = (this as any)[attrName];
          if (Array.isArray(existing)) {
            const merged = new Set([...existing, ...value]);
            (this as any)[attrName] = [...merged];
          } else {
            (this as any)[attrName] = value;
          }
        } else {
          (this as any)[attrName] = value;
        }
        continue;
      }

      (this as any)[attrName] = value;
    }
  }

  /**
   * Construct a device object based on the provided device type.
   *
   * Returns a typed device for known types, or a generic `Device` otherwise.
   */
  static construct(opts: {
    type: DeviceType;
    ip: string;
    port: number;
    deviceId: number;
    sn?: string | null;
    name?: string | null;
    version?: number | null;
  }): Device {
    const { type, ...rest } = opts;

    if (type === DEVICE_TYPE.AIR_CONDITIONER) {
      // Lazy import to avoid circular dependency
      const { AirConditioner } = require("./device/ac/device.ts");
      return new AirConditioner({ ...rest, deviceType: type });
    }

    if (type === DEVICE_TYPE.COMMERCIAL_AC) {
      const { CommercialAirConditioner } = require("./device/cc/device.ts");
      return new CommercialAirConditioner({ ...rest, deviceType: type });
    }

    return new Device({ ...rest, deviceType: type });
  }
}
