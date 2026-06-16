/**
 * Discovery module for Midea AC devices.
 *
 * Uses UDP broadcast to discover devices on the local network, then
 * decrypts and parses the response to build Device instances.
 *
 * Ported from msmart/discover.py
 * @module
 */

import * as dgram from "node:dgram";
import { DEVICE_TYPE, DISCOVERY_MSG, DEVICE_INFO_MSG, DEFAULT_CLOUD_REGION } from "./const.ts";
import type { DeviceType } from "./const.ts";
import { Security } from "./security.ts";
import { Device, AuthenticationError } from "./base-device.ts";
import { NetHomePlusCloud, CloudError } from "./cloud.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IPV4_BROADCAST = "255.255.255.255";

/** Discovery target ports. */
const DISCOVERY_PORTS = [6445, 20086] as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a discovery operation fails. */
export class DiscoverError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "DiscoverError";
  }
}

// ---------------------------------------------------------------------------
// Discover options
// ---------------------------------------------------------------------------

/** Options for the {@link Discover.discover} method. */
export interface DiscoverOptions {
  /** Target IP address or hostname. Defaults to broadcast. */
  target?: string;
  /** Timeout in seconds to wait for responses. */
  timeout?: number;
  /** Number of discovery packets to send per port. */
  discoveryPackets?: number;
  /** Network interface name to bind to (Linux only). */
  iface?: string;
  /** Midea cloud region for authentication. */
  region?: string;
  /** Cloud account username. */
  account?: string;
  /** Cloud account password. */
  password?: string;
  /** Automatically connect and refresh discovered devices. */
  autoConnect?: boolean;
}

/** Options for the {@link Discover.connect} method. */
export interface ConnectOptions {
  /** Midea cloud region for authentication. */
  region?: string;
  /** Cloud account username. */
  account?: string;
  /** Cloud account password. */
  password?: string;
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

/**
 * Discover Midea smart devices on the local network.
 *
 * All methods are static — mirrors the Python `Discover` class.
 */
export class Discover {
  // Shared state (mirrors Python class-level attributes)
  private static _region = DEFAULT_CLOUD_REGION;
  private static _account: string | null = null;
  private static _password: string | null = null;
  private static _cloud: NetHomePlusCloud | null = null;
  private static _autoConnect = false;

  /**
   * Discover devices via UDP broadcast.
   *
   * Sends discovery packets to ports 6445 and 20086, then collects
   * and processes all responses within the timeout period.
   *
   * @returns An array of discovered {@link Device} instances.
   */
  static async discover(options: DiscoverOptions = {}): Promise<Device[]> {
    const {
      target = IPV4_BROADCAST,
      timeout = 3,
      discoveryPackets = 3,
      iface,
      region = DEFAULT_CLOUD_REGION,
      account,
      password,
      autoConnect = true,
    } = options;

    // Always use a new cloud connection
    Discover._cloud = null;

    // Save cloud region and credentials
    Discover._region = region;
    Discover._account = account ?? null;
    Discover._password = password ?? null;
    Discover._autoConnect = autoConnect;

    const discoveredIps = new Set<string>();
    const tasks: Promise<Device | null>[] = [];

    return new Promise<Device[]>((resolve, reject) => {
      const socket = dgram.createSocket("udp4");

      socket.on("error", (err) => {
        console.error(`Discovery socket error: ${err.message}`);
        socket.close();
        reject(new DiscoverError(`Socket error: ${err.message}`));
      });

      socket.on("message", (data: Buffer, rinfo: dgram.RemoteInfo) => {
        const ip = rinfo.address;

        // Ignore already discovered devices
        if (discoveredIps.has(ip)) return;
        discoveredIps.add(ip);

        console.debug(
          `Discovery response from ${ip}: ${data.toString("hex")}`,
        );

        try {
          const version = Discover._getDeviceVersion(data);

          // Create a task to get device info
          const task = Discover._getDevice(ip, version, data);
          tasks.push(task);
        } catch (e) {
          if (e instanceof DiscoverError) {
            console.error(`Unknown device version for ${ip}.`);
          } else {
            throw e;
          }
        }
      });

      socket.bind(0, "0.0.0.0", () => {
        // Enable broadcast if targeting broadcast address
        if (target === IPV4_BROADCAST) {
          socket.setBroadcast(true);
        }

        // Bind to interface if specified (Linux only, may fail on other OS)
        if (iface) {
          try {
            // SO_BINDTODEVICE is Linux-specific
            (socket as any).setMulticastInterface?.(iface);
          } catch {
            console.warn(
              `Failed to bind to interface '${iface}'. This may only work on Linux.`,
            );
          }
        }

        // Send discovery packets
        const msg = Buffer.from(DISCOVERY_MSG);
        for (const port of DISCOVERY_PORTS) {
          console.debug(`Discovery sent to ${target}:${port}.`);
          for (let i = 0; i < discoveryPackets; i++) {
            socket.send(msg, 0, msg.length, port, target);
          }
        }

        // Wait for responses
        console.debug(`Waiting ${timeout} seconds for responses...`);
        setTimeout(async () => {
          socket.close();

          console.debug(`Discovered ${tasks.length} devices.`);

          // Wait for remaining tasks
          const results = await Promise.all(tasks);

          // Remove any null entries
          const devices = results.filter(
            (d): d is Device => d !== null,
          );

          resolve(devices);
        }, timeout * 1000);
      });
    });
  }

  /**
   * Discover a single device by hostname or IP.
   *
   * @returns The first discovered device, or `null` if none found.
   */
  static async discoverSingle(
    host: string,
    options: Omit<DiscoverOptions, "target"> = {},
  ): Promise<Device | null> {
    const devices = await Discover.discover({ ...options, target: host });

    if (devices.length > 0) {
      return devices[0]!;
    }

    return null;
  }

  /**
   * Connect, authenticate as needed, and refresh a device.
   *
   * @returns `true` if connection was successful.
   */
  static async connect(
    device: Device,
    options: ConnectOptions = {},
  ): Promise<boolean> {
    // Save credentials if provided
    if (options.region) Discover._region = options.region;
    if (options.account) Discover._account = options.account;
    if (options.password) Discover._password = options.password;

    if (device.version === 3) {
      const success = await Discover._authenticateDevice(device);
      if (!success) return false;
    }

    // Attempt to refresh the device state
    try {
      await device.refresh();
    } catch (e) {
      if (e instanceof Error && e.message === "Not implemented") {
        console.error(
          `Device class ${device.constructor.name} has not implemented refresh().`,
        );
        return false;
      }
      throw e;
    }

    return true;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Determine the device protocol version from discovery response data.
   *
   * - Version 1: XML response
   * - Version 2: Starts with `0x5A5A`
   * - Version 3: Starts with `0x8370`
   *
   * @throws {DiscoverError} If the version cannot be determined.
   */
  private static _getDeviceVersion(data: Buffer | Uint8Array): number {
    // Attempt to detect XML (V1) — check if starts with '<'
    if (data[0] === 0x3c) {
      // '<' character
      try {
        // Simple XML detection: check if it's parseable text starting with <
        const text = Buffer.from(data).toString("utf-8");
        if (text.includes("<") && text.includes(">")) {
          return 1;
        }
      } catch {
        // Not XML
      }
    }

    // Use start of packet data to differentiate between V2 and V3
    if (data[0] === 0x5a && data[1] === 0x5a) {
      return 2;
    }

    if (data[0] === 0x83 && data[1] === 0x70) {
      return 3;
    }

    throw new DiscoverError("Unknown device version.");
  }

  /**
   * Get device information from the discovery response.
   *
   * V2/V3 devices return sufficient information in their discovery response.
   * V1 devices must be queried separately (not yet supported).
   *
   * @throws {DiscoverError} On decryption or parsing failure.
   * @throws {Error} For V1 devices (not yet supported).
   */
  private static async _getDeviceInfo(
    ip: string,
    version: number,
    data: Buffer | Uint8Array,
  ): Promise<{
    ip: string;
    port: number;
    deviceId: number;
    name: string;
    sn: string;
    deviceType: number;
    version: number;
  }> {
    // Version 1 devices
    if (version === 1) {
      throw new Error("V1 device not supported yet");
    }

    // Version 2 & 3 devices
    let view = Buffer.from(data);

    // Strip V3 header and hash
    if (version === 3) {
      view = view.subarray(8, view.length - 16);
    }

    // Extract encrypted payload
    const encryptedData = view.subarray(40, view.length - 16);

    // Extract ID — 6 bytes little-endian (uint48)
    const idBytes = view.subarray(20, 26);
    let deviceId = 0;
    for (let i = 5; i >= 0; i--) {
      deviceId = deviceId * 256 + idBytes[i]!;
    }

    // Attempt to decrypt the packet
    let decryptedData: Buffer;
    try {
      decryptedData = Security.decryptAes(Buffer.from(encryptedData));
    } catch (e) {
      throw new DiscoverError(
        `Failed to decrypt discovery response. ${e instanceof Error ? e.message : e}`,
      );
    }

    console.debug(
      `Decrypted data from ${ip}: ${decryptedData.toString("hex")}`,
    );

    // Extract IP address (4 bytes, reversed)
    const ipBytes = Buffer.from([
      decryptedData[3]!,
      decryptedData[2]!,
      decryptedData[1]!,
      decryptedData[0]!,
    ]);
    const ipAddress = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;

    // Extract port (2 bytes little-endian)
    const port = decryptedData[4]! | (decryptedData[5]! << 8);

    if (ipAddress !== ip) {
      console.warn(
        `Reported device IP ${ipAddress} does not match received IP ${ip}. Using received IP.`,
      );
    }

    // Extract serial number (bytes 8-40)
    const sn = decryptedData.subarray(8, 40).toString("utf-8");

    // Extract name/SSID
    const nameLength = decryptedData[40]!;
    const name = decryptedData
      .subarray(41, 41 + nameLength)
      .toString("utf-8");

    // Extract device type from name (e.g. "net_cc_...")
    const deviceType = parseInt(name.split("_")[1]!, 16);

    return {
      ip,
      port,
      deviceId,
      name,
      sn,
      deviceType,
      version,
    };
  }

  /**
   * Get a cloud connection, creating it if necessary.
   *
   * @throws {CloudError} If login fails.
   */
  private static async _getCloud(): Promise<NetHomePlusCloud> {
    if (Discover._cloud === null) {
      const cloud = new NetHomePlusCloud(Discover._region, {
        account: Discover._account ?? undefined,
        password: Discover._password ?? undefined,
      });
      try {
        await cloud.login();
        Discover._cloud = cloud;
      } catch (e) {
        if (e instanceof CloudError) {
          throw new CloudError(`Failed to login to cloud. ${e.message}`);
        }
        throw e;
      }
    }

    return Discover._cloud;
  }

  /**
   * Attempt to authenticate a V3 device using cloud tokens.
   *
   * Tries both little-endian and big-endian byte orders of the device ID
   * to compute the udpid.
   *
   * @returns `true` if authentication succeeded.
   */
  private static async _authenticateDevice(
    device: Device,
  ): Promise<boolean> {
    let cloud: NetHomePlusCloud;
    try {
      cloud = await Discover._getCloud();
    } catch (e) {
      if (e instanceof CloudError) {
        console.error(
          `Could not establish cloud connection. Error: ${e.message}`,
        );
        throw e;
      }
      throw e;
    }

    // Try authenticating with udpids generated from both endians
    for (const endian of ["little", "big"] as const) {
      // Convert device ID to 6 bytes in the specified endian
      const idBuf = Buffer.alloc(6);
      let id = device.id;
      if (endian === "little") {
        for (let i = 0; i < 6; i++) {
          idBuf[i] = id & 0xff;
          id = Math.floor(id / 256);
        }
      } else {
        for (let i = 5; i >= 0; i--) {
          idBuf[i] = id & 0xff;
          id = Math.floor(id / 256);
        }
      }

      const udpid = Security.udpid(idBuf).toString("hex");

      console.debug(
        `Fetching token and key for udpid '${udpid}' (${endian}).`,
      );

      let token: string;
      let key: string;
      try {
        [token, key] = await cloud.getToken(udpid);
      } catch (e) {
        if (e instanceof CloudError) {
          console.error(`Failed to get token from cloud. Error: ${e.message}`);
          throw new CloudError(
            `Failed to get token from cloud. ${e.message}`,
          );
        }
        throw e;
      }

      try {
        await device.authenticate(token, key);
        return true;
      } catch (e) {
        if (e instanceof AuthenticationError) {
          continue;
        }
        throw e;
      }
    }

    return false;
  }

  /**
   * Get device information and construct a device instance from the
   * discovery response data.
   */
  private static async _getDevice(
    ip: string,
    version: number,
    data: Buffer | Uint8Array,
  ): Promise<Device | null> {
    // Fetch device information
    let info: Awaited<ReturnType<typeof Discover._getDeviceInfo>>;
    try {
      info = await Discover._getDeviceInfo(ip, version, data);
    } catch (e) {
      if (e instanceof DiscoverError || e instanceof Error) {
        console.error(e.message);
        return null;
      }
      throw e;
    }

    // Build device from type
    const device = Device.construct({
      type: info.deviceType as DeviceType,
      ip: info.ip,
      port: info.port,
      deviceId: info.deviceId,
      name: info.name,
      sn: info.sn,
      version: info.version,
    });

    // Don't query device if requested
    if (Discover._autoConnect) {
      await Discover.connect(device);
    }

    return device;
  }
}
