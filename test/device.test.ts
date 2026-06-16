/**
 * Device module tests.
 *
 * Ported from msmart/tests/test_device.py
 */

import { describe, it, expect, mock } from "bun:test";
import { Device } from "../src/base-device.ts";
import { DEVICE_TYPE, FRAME_TYPE } from "../src/const.ts";
import type { DeviceType } from "../src/const.ts";
import { Frame } from "../src/frame.ts";
import { ProtocolError } from "../src/lan.ts";
import { AirConditioner } from "../src/device/ac/device.ts";
import { CommercialAirConditioner } from "../src/device/cc/device.ts";

// ─── TestSendCommand ────────────────────────────────────────────────────────

describe("SendCommand", () => {
  it("should return empty array on timeout", async () => {
    // Create a dummy device
    const device = new Device({
      ip: "0.0.0.0",
      port: 0,
      deviceId: 0,
      deviceType: DEVICE_TYPE.AIR_CONDITIONER,
    });

    // Replace entire _lan with a minimal mock that throws TimeoutError
    const timeoutError = new Error("No response from host.");
    timeoutError.name = "TimeoutError";
    (device as any)._lan = { send: mock(() => Promise.reject(timeoutError)) };

    // Send dummy command
    const cmd = new Frame(DEVICE_TYPE.AIR_CONDITIONER, FRAME_TYPE.CONTROL);
    const responses = await (device as any)._sendCommand(cmd);

    // Assert empty array was returned
    expect(responses).toEqual([]);
  });

  it("should return empty array on protocol error", async () => {
    // Create a dummy device
    const device = new Device({
      ip: "0.0.0.0",
      port: 0,
      deviceId: 0,
      deviceType: DEVICE_TYPE.AIR_CONDITIONER,
    });

    // Replace entire _lan with a minimal mock that throws ProtocolError
    (device as any)._lan = {
      send: mock(() => Promise.reject(new ProtocolError("test"))),
    };

    // Send dummy command
    const cmd = new Frame(DEVICE_TYPE.AIR_CONDITIONER, FRAME_TYPE.CONTROL);
    const responses = await (device as any)._sendCommand(cmd);

    // Assert empty array was returned
    expect(responses).toEqual([]);
  });
});

// ─── TestConstruct ──────────────────────────────────────────────────────────

describe("Construct", () => {
  it("should construct an AC device", () => {
    const device = Device.construct({
      type: DEVICE_TYPE.AIR_CONDITIONER,
      ip: "127.0.0.1",
      port: 6444,
      deviceId: 147334558165565,
      name: "net_ac_63BA",
      sn: "000000P0000000Q1B88C29C963BA0000",
    });

    expect(device).not.toBeNull();
    expect(device).toBeInstanceOf(AirConditioner);

    expect(device.ip).toBe("127.0.0.1");
    expect(device.port).toBe(6444);
    expect(device.id).toBe(147334558165565);
    expect(device.sn).toBe("000000P0000000Q1B88C29C963BA0000");
  });

  it("should construct a CC device", () => {
    const device = Device.construct({
      type: DEVICE_TYPE.COMMERCIAL_AC,
      ip: "127.0.0.11",
      port: 6444,
      deviceId: 123456,
      sn: "000000",
    });

    expect(device).not.toBeNull();
    expect(device).toBeInstanceOf(CommercialAirConditioner);

    expect(device.ip).toBe("127.0.0.11");
    expect(device.port).toBe(6444);
    expect(device.id).toBe(123456);
    expect(device.sn).toBe("000000");
  });

  it("should construct an unsupported device as base Device", () => {
    const device = Device.construct({
      type: 0xbd as DeviceType,
      ip: "127.0.0.22",
      port: 6666,
      deviceId: 987654,
      sn: "12345",
    });

    expect(device).not.toBeNull();
    expect(device).toBeInstanceOf(Device);

    expect(device.ip).toBe("127.0.0.22");
    expect(device.port).toBe(6666);
    expect(device.id).toBe(987654);
    expect(device.sn).toBe("12345");
  });
});

// ─── TestOverrideCapabilities ───────────────────────────────────────────────

describe("OverrideCapabilities", () => {
  it("should throw on unsupported override", () => {
    const device = new Device({
      ip: "0",
      port: 0,
      deviceId: 0,
      deviceType: DEVICE_TYPE.AIR_CONDITIONER,
    });

    expect(() =>
      device.overrideCapabilities({ supports_eco: true }),
    ).toThrow("Unsupported capabilities override");
  });

  it("should throw on invalid numeric value", () => {
    const device = new Device({
      ip: "0",
      port: 0,
      deviceId: 0,
      deviceType: DEVICE_TYPE.AIR_CONDITIONER,
    });

    // Allow some numeric overrides
    (device.constructor as typeof Device)._SUPPORTED_CAPABILITY_OVERRIDES = {
      min_target_temperature: ["_dummyAttr", "float"],
      max_target_temperature: ["_dummyAttr", "float"],
    };

    expect(() =>
      device.overrideCapabilities({ min_target_temperature: "apple" }),
    ).toThrow("must be a number");

    expect(() =>
      device.overrideCapabilities({ max_target_temperature: [20, 50] }),
    ).toThrow("must be a number");

    // Clean up static property
    (device.constructor as typeof Device)._SUPPORTED_CAPABILITY_OVERRIDES = {};
  });
});
