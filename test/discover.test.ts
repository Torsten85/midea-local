/**
 * Discover module tests.
 *
 * Ported from msmart/tests/test_discover.py
 */

import { describe, it, expect, mock } from "bun:test";
import { Device } from "../src/base-device.ts";
import { DEVICE_TYPE, DISCOVERY_MSG } from "../src/const.ts";
import { AirConditioner } from "../src/device/ac/device.ts";
import { Discover } from "../src/discover.ts";

// ─── Discovery response fixtures ────────────────────────────────────────────

/** Pairs of (host, response) that simulate device discovery responses. */
const DISCOVER_RESPONSES: Array<[host: { ip: string; port: number }, data: Buffer]> = [
  [
    { ip: "10.100.1.140", port: 6445 },
    Buffer.from(
      "5a5a011178007a8000000000000000000000000060ca0000000e0000000000000000000001000000c08651cb1b88a167bdcf7d37534ef81312d39429bf9b2673f200b635fae369a560fa9655eab8344be22b1e3b024ef5dfd392dc3db64dbffb6a66fb9cd5ec87a78000cd9043833b9f76991e8af29f3496",
      "hex",
    ),
  ],
  [
    { ip: "10.100.1.239", port: 6445 },
    Buffer.from(
      "837000c8200f00005a5a0111b8007a800000000061433702060817143daa00000086000000000000000001800000000041c7129527bc03ee009284a90c2fbd2f179764ac35b55e7fb0e4ab0de9298fa1a5ca328046c603fb1ab60079d550d03546b605180127fdb5bb33a105f5206b5f008bffba2bae272aa0c96d56b45c4afa33f826a0a4215d1dd87956a267d2dbd34bdfb3e16e33d88768cc4c3d0658937d0bb19369bf0317b24d3a4de9e6a13106f7ceb5acc6651ce53d684a32ce34dc3a4fbe0d4139de99cc88a0285e14657045",
      "hex",
    ),
  ],
];

// ─── TestDiscover ───────────────────────────────────────────────────────────

describe("Discover", () => {
  it("should detect V2 device version", () => {
    const [, RESPONSE_V2] = DISCOVER_RESPONSES[0]!;

    const version = (Discover as any)._getDeviceVersion(RESPONSE_V2);
    expect(version).toBe(2);
  });

  it("should detect V3 device version", () => {
    const [, RESPONSE_V3] = DISCOVER_RESPONSES[1]!;

    const version = (Discover as any)._getDeviceVersion(RESPONSE_V3);
    expect(version).toBe(3);
  });

  it("should parse V2 device info", async () => {
    const [HOST, RESPONSE_V2] = DISCOVER_RESPONSES[0]!;

    const version = (Discover as any)._getDeviceVersion(RESPONSE_V2);
    expect(version).toBe(2);

    const info = await (Discover as any)._getDeviceInfo(
      HOST.ip,
      version,
      RESPONSE_V2,
    );
    expect(info).not.toBeNull();

    expect(info.ip).toBe(HOST.ip);
    expect(info.port).toBe(6444);

    expect(info.deviceId).toBe(15393162840672);
    expect(info.deviceType).toBe(DEVICE_TYPE.AIR_CONDITIONER);

    expect(info.name).toBe("net_ac_F7B4");
    expect(info.sn).toBe("000000P0000000Q1F0C9D153F7B40000");

    // Build device
    const device = Device.construct({
      type: info.deviceType,
      ip: info.ip,
      port: info.port,
      deviceId: info.deviceId,
      name: info.name,
      sn: info.sn,
      version: info.version,
    });

    expect(device).not.toBeNull();
    expect(device).toBeInstanceOf(AirConditioner);
    expect(device.version).toBe(2);
  });

  it("should parse V3 device info", async () => {
    const [HOST, RESPONSE_V3] = DISCOVER_RESPONSES[1]!;

    const version = (Discover as any)._getDeviceVersion(RESPONSE_V3);
    expect(version).toBe(3);

    const info = await (Discover as any)._getDeviceInfo(
      HOST.ip,
      version,
      RESPONSE_V3,
    );
    expect(info).not.toBeNull();

    expect(info.ip).toBe(HOST.ip);
    expect(info.port).toBe(6444);

    expect(info.deviceId).toBe(147334558165565);
    expect(info.deviceType).toBe(DEVICE_TYPE.AIR_CONDITIONER);

    expect(info.name).toBe("net_ac_63BA");
    expect(info.sn).toBe("000000P0000000Q1B88C29C963BA0000");

    // Build device
    const device = Device.construct({
      type: info.deviceType,
      ip: info.ip,
      port: info.port,
      deviceId: info.deviceId,
      name: info.name,
      sn: info.sn,
      version: info.version,
    });

    expect(device).not.toBeNull();
    expect(device).toBeInstanceOf(AirConditioner);
    expect(device.version).toBe(3);
  });
});
