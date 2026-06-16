/**
 * Tests for CC (Commercial AC) device class.
 *
 * Ported from msmart/device/CC/test_device.py
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  CommercialAirConditioner,
  CC_FAN_SPEED,
  CC_OPERATIONAL_MODE,
  CC_SWING_MODE,
  CC_SWING_ANGLE,
  CC_PURIFIER_MODE,
  CC_AUX_HEAT_MODE,
  CC_CAPABILITY,
} from "../src/device/cc/device.ts";
import type {
  CcFanSpeed,
  CcOperationalMode,
  CcSwingMode,
  CcSwingAngle,
  CcPurifierMode,
  CcAuxHeatMode,
} from "../src/device/cc/device.ts";
import {
  Response,
  QueryResponse,
  QueryCommand,
  CONTROL_ID,
  ControlCommand,
} from "../src/device/cc/command.ts";
import type { ControlId } from "../src/device/cc/command.ts";
import { listValues, getFromValue, getFromName } from "../src/utils.ts";

// ---------------------------------------------------------------------------
// Helper: create a dummy device
// ---------------------------------------------------------------------------

function createDevice(): CommercialAirConditioner {
  return new CommercialAirConditioner({
    ip: "0.0.0.0",
    port: 0,
    deviceId: 0,
  });
}

// ---------------------------------------------------------------------------
// TestDeviceEnums
// ---------------------------------------------------------------------------

describe("TestDeviceEnums", () => {
  /**
   * For each const-object "enum", check that:
   * 1. Every value can be looked up by value (round-trip).
   * 2. Every key can be looked up by name (round-trip).
   */
  function testEnumMembers(constObj: Record<string, number>): void {
    const values = listValues(constObj);
    for (const v of values) {
      // Look up by value
      const fromValue = getFromValue(constObj, v);
      expect(fromValue).toBe(v);

      // Look up by name
      const name = Object.keys(constObj).find((k) => constObj[k] === v)!;
      const fromName = getFromName(constObj, name);
      expect(fromName).toBe(v);
    }
  }

  /**
   * Check that invalid names/values fall back to the default.
   */
  function testEnumFallback(
    constObj: Record<string, number>,
    defaultValue: number,
  ): void {
    // Invalid name
    expect(getFromName(constObj, "INVALID_NAME", defaultValue)).toBe(
      defaultValue,
    );

    // Invalid value
    expect(getFromValue(constObj, 1234567, defaultValue)).toBe(defaultValue);

    // null/undefined value
    expect(getFromValue(constObj, null, defaultValue)).toBe(defaultValue);

    // null/undefined/empty name
    expect(getFromName(constObj, null, defaultValue)).toBe(defaultValue);
    expect(getFromName(constObj, "", defaultValue)).toBe(defaultValue);
  }

  const ENUM_CLASSES: [Record<string, number>, number][] = [
    [CC_AUX_HEAT_MODE, CC_AUX_HEAT_MODE.OFF],
    [CC_FAN_SPEED, CC_FAN_SPEED.AUTO],
    [CC_OPERATIONAL_MODE, CC_OPERATIONAL_MODE.FAN],
    [CC_PURIFIER_MODE, CC_PURIFIER_MODE.OFF],
    [CC_SWING_ANGLE, CC_SWING_ANGLE.POS_3],
    [CC_SWING_MODE, CC_SWING_MODE.OFF],
  ];

  it("should round-trip all enum members", () => {
    for (const [constObj] of ENUM_CLASSES) {
      testEnumMembers(constObj);
    }
  });

  it("should fall back to default for unknown values/names", () => {
    for (const [constObj, defaultValue] of ENUM_CLASSES) {
      testEnumFallback(constObj, defaultValue);
    }
  });
});

// ---------------------------------------------------------------------------
// TestSwingMode
// ---------------------------------------------------------------------------

describe("TestSwingMode", () => {
  it("should decode swing angles into swing modes", () => {
    const device = createDevice();

    // Default should be off
    expect(device.swingMode).toBe(CC_SWING_MODE.OFF);

    // Auto horizontal -> swing mode horizontal
    device.horizontalSwingAngle = CC_SWING_ANGLE.AUTO;
    device.verticalSwingAngle = CC_SWING_ANGLE.CLOSE;
    expect(device.swingMode).toBe(CC_SWING_MODE.HORIZONTAL);

    // Auto vertical -> swing mode vertical
    device.horizontalSwingAngle = CC_SWING_ANGLE.CLOSE;
    device.verticalSwingAngle = CC_SWING_ANGLE.AUTO;
    expect(device.swingMode).toBe(CC_SWING_MODE.VERTICAL);

    // Auto both -> swing mode both
    device.horizontalSwingAngle = CC_SWING_ANGLE.AUTO;
    device.verticalSwingAngle = CC_SWING_ANGLE.AUTO;
    expect(device.swingMode).toBe(CC_SWING_MODE.BOTH);
  });

  it("should encode swing mode into swing angles", () => {
    const device = createDevice();

    device.swingMode = CC_SWING_MODE.OFF;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT

    device.swingMode = CC_SWING_MODE.HORIZONTAL;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT

    device.swingMode = CC_SWING_MODE.VERTICAL;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);

    device.swingMode = CC_SWING_MODE.BOTH;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);

    // Verify that axes are taken out of auto mode when disabling swing
    device.horizontalSwingAngle = CC_SWING_ANGLE.AUTO;
    device.verticalSwingAngle = CC_SWING_ANGLE.AUTO;
    device.swingMode = CC_SWING_MODE.OFF;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.POS_3); // DEFAULT

    // Verify one axis doesn't affect the other if it's not swinging
    device.horizontalSwingAngle = CC_SWING_ANGLE.POS_1;
    device.verticalSwingAngle = CC_SWING_ANGLE.POS_1;
    device.swingMode = CC_SWING_MODE.VERTICAL;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.POS_1);
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);

    device.horizontalSwingAngle = CC_SWING_ANGLE.POS_1;
    device.verticalSwingAngle = CC_SWING_ANGLE.POS_5;
    device.swingMode = CC_SWING_MODE.HORIZONTAL;
    expect(device.horizontalSwingAngle).toBe(CC_SWING_ANGLE.AUTO);
    expect(device.verticalSwingAngle).toBe(CC_SWING_ANGLE.POS_5);
  });
});

// ---------------------------------------------------------------------------
// TestUpdateStateFromResponse
// ---------------------------------------------------------------------------

describe("TestUpdateStateFromResponse", () => {
  it("should update state from a query response", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3272675291
    const TEST_RESPONSE = Buffer.from(
      "aa63cc0000000000000301fe00000043005001728c7800ff00728c728c787800010141ff010203000603010008000600000001060106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff5f",
      "hex",
    );

    const resp = Response.construct(TEST_RESPONSE);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(QueryResponse);

    const device = createDevice();
    // Access private method via type assertion
    (device as any)._updateState(resp);

    expect(device.targetTemperature).toBe(20.0);
    expect(device.indoorTemperature).toBe(25.5);

    expect(device.eco).toBe(false);
    expect(device.silent).toBe(false);
    expect(device.sleep).toBe(false);
    expect(device.purifier).toBe(CC_PURIFIER_MODE.OFF);

    expect(device.operationalMode).toBe(CC_OPERATIONAL_MODE.HEAT);
    expect(device.fanSpeed).toBe(CC_FAN_SPEED.AUTO);
    expect(device.swingMode).toBe(CC_SWING_MODE.BOTH);
  });

  it("should parse aux mode into device state", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3272675291
    const TEST_RESPONSES: [number, string][] = [
      [CC_AUX_HEAT_MODE.ON, "aa63cc0000000000000301fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff01ff65"],
      [CC_AUX_HEAT_MODE.AUTO, "aa63cc0000000000000301fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff00ff66"],
      [CC_AUX_HEAT_MODE.OFF, "aa63cc0000000000000301fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001010100010000000000000000000000000001000200000100000101000102ff02ff63"],
    ];

    const device = createDevice();

    for (const [value, hex] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, "hex"));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(QueryResponse);

      (device as any)._updateState(resp);
      expect(device.auxMode).toBe(value);
    }
  });

  it("should parse purifier mode into device state", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3272675291
    const TEST_RESPONSES: [number, string][] = [
      [CC_PURIFIER_MODE.ON, "aa63cc0000000000000301fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000100000100000101000102ff02ff65"],
      [CC_PURIFIER_MODE.OFF, "aa63cc0000000000000301fe00000043005001728c78010700728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000101010000000000000000000000000001000200000100000101000102ff02ff62"],
    ];

    const device = createDevice();

    for (const [value, hex] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, "hex"));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(QueryResponse);

      (device as any)._updateState(resp);
      expect(device.purifier).toBe(value);
    }
  });
});

// ---------------------------------------------------------------------------
// TestCapabilities
// ---------------------------------------------------------------------------

describe("TestCapabilities", () => {
  it("should parse device capabilities from a query response", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3272675291
    const TEST_RESPONSE = Buffer.from(
      "aa63cc0000000000000301fe00000043005001728c7800ff00728c728c787800010141ff010203000603010008000600000001060106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff5f",
      "hex",
    );

    const resp = Response.construct(TEST_RESPONSE);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(QueryResponse);

    const queryResp = resp as QueryResponse;
    queryResp.parseCapabilities();

    const device = createDevice();
    (device as any)._updateCapabilities(queryResp);

    // Check supported operation modes
    expect(device.supportedOperationModes).toContain(CC_OPERATIONAL_MODE.HEAT);
    expect(device.supportedOperationModes).toContain(CC_OPERATIONAL_MODE.COOL);
    expect(device.supportedOperationModes).toContain(CC_OPERATIONAL_MODE.FAN);
    expect(device.supportedOperationModes).toContain(CC_OPERATIONAL_MODE.DRY);

    // Check supported swing modes
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.OFF);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.BOTH);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.HORIZONTAL);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.VERTICAL);

    // Check supported fan speeds
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L1);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L2);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L3);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L4);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L5);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L6);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.L7);
    expect(device.supportedFanSpeeds).toContain(CC_FAN_SPEED.AUTO);

    expect(device.supportsHumidity).toBe(true);

    expect(device.supportsEco).toBe(true);
    expect(device.supportsSilent).toBe(true);
    expect(device.supportsSleep).toBe(true);

    expect(device.supportedPurifierModes).toContain(CC_PURIFIER_MODE.OFF);
    expect(device.supportedPurifierModes).toContain(CC_PURIFIER_MODE.ON);

    expect(device.supportedAuxModes).toContain(CC_AUX_HEAT_MODE.OFF);
    expect(device.supportedAuxModes).toContain(CC_AUX_HEAT_MODE.ON);
    expect(device.supportedAuxModes).toContain(CC_AUX_HEAT_MODE.AUTO);
  });

  it("should handle swing mode capabilities", () => {
    // Test with only vertical swing angle control
    const resp1 = {
      supportsHorzSwingAngle: false,
      supportsVertSwingAngle: true,
      // Minimal properties needed by _updateCapabilities
      targetTemperatureMin: 17,
      targetTemperatureMax: 30,
      supportsHumidity: false,
      supportedOpModes: null,
      supportsFanSpeed: false,
      supportsWindSense: false,
      supportsCo2Level: false,
      supportsEco: false,
      supportsSilent: false,
      supportsSleep: false,
      supportsSelfClean: false,
      supportsPurifier: false,
      supportsPurifierAuto: false,
      supportsFilterLevel: false,
      supportedAuxModes: null,
    } as unknown as QueryResponse;

    const device = createDevice();
    (device as any)._updateCapabilities(resp1);

    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.OFF);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.VERTICAL);
    expect(device.supportedSwingModes).not.toContain(CC_SWING_MODE.HORIZONTAL);
    expect(device.supportedSwingModes).not.toContain(CC_SWING_MODE.BOTH);

    expect(device.supportsHorizontalSwingAngle).toBe(false);
    expect(device.supportsVerticalSwingAngle).toBe(true);

    // Test with only horizontal swing angle control
    const resp2 = { ...resp1, supportsHorzSwingAngle: true, supportsVertSwingAngle: false } as unknown as QueryResponse;
    (device as any)._updateCapabilities(resp2);

    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.OFF);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.HORIZONTAL);
    expect(device.supportedSwingModes).not.toContain(CC_SWING_MODE.VERTICAL);
    expect(device.supportedSwingModes).not.toContain(CC_SWING_MODE.BOTH);

    expect(device.supportsHorizontalSwingAngle).toBe(true);
    expect(device.supportsVerticalSwingAngle).toBe(false);

    // Test with both controls
    const resp3 = { ...resp1, supportsHorzSwingAngle: true, supportsVertSwingAngle: true } as unknown as QueryResponse;
    (device as any)._updateCapabilities(resp3);

    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.OFF);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.HORIZONTAL);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.VERTICAL);
    expect(device.supportedSwingModes).toContain(CC_SWING_MODE.BOTH);

    expect(device.supportsHorizontalSwingAngle).toBe(true);
    expect(device.supportsVerticalSwingAngle).toBe(true);
  });

  it("should handle aux mode capabilities with invalid modes", () => {
    // Test with invalid mode
    const resp1 = {
      supportedAuxModes: [0xff],
      targetTemperatureMin: 17,
      targetTemperatureMax: 30,
      supportsHumidity: false,
      supportedOpModes: null,
      supportsFanSpeed: false,
      supportsHorzSwingAngle: false,
      supportsVertSwingAngle: false,
      supportsWindSense: false,
      supportsCo2Level: false,
      supportsEco: false,
      supportsSilent: false,
      supportsSleep: false,
      supportsSelfClean: false,
      supportsPurifier: false,
      supportsPurifierAuto: false,
      supportsFilterLevel: false,
    } as unknown as QueryResponse;

    const device = createDevice();
    (device as any)._updateCapabilities(resp1);

    expect(device.supportedAuxModes).toEqual([]);

    // Test with valid mode
    const resp2 = { ...resp1, supportedAuxModes: [0] } as unknown as QueryResponse;
    (device as any)._updateCapabilities(resp2);

    expect(device.supportedAuxModes).toContain(CC_AUX_HEAT_MODE.AUTO);
  });
});

// ---------------------------------------------------------------------------
// TestSetState
// ---------------------------------------------------------------------------

describe("TestSetState", () => {
  it("should track updated controls when setting properties", async () => {
    const device = createDevice();

    // Set some controls
    device.powerState = true;
    device.operationalMode = CC_OPERATIONAL_MODE.HEAT;
    device.fanSpeed = CC_FAN_SPEED.AUTO;
    device.targetTemperature = 24;
    device.eco = true;

    // Assert correct controls are being updated (access private set)
    const updatedControls = (device as any)._updatedControls as Set<ControlId>;
    expect(updatedControls.has(CONTROL_ID.POWER)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.MODE)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.FAN_SPEED)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.TARGET_TEMPERATURE)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.ECO)).toBe(true);
    expect(updatedControls.size).toBe(5);

    // Patch _sendCommandsGetResponses to prevent network access
    const sendMock = mock(() => Promise.resolve([]));
    (device as any)._sendCommandsGetResponses = sendMock;

    // Apply changed settings
    await device.apply();

    // Assert mock was called
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Get call arguments - should be an array of commands
    const args = sendMock.mock.calls[0]!;
    const commands = args[0] as any[];
    expect(commands.length).toBe(1);

    // Ensure no controls remain
    expect((device as any)._updatedControls.size).toBe(0);
  });

  it("should send only power control when powering off with other controls", async () => {
    const device = createDevice();

    // Set some controls
    device.powerState = false;
    device.operationalMode = CC_OPERATIONAL_MODE.HEAT;
    device.targetTemperature = 24;

    // Assert correct controls are being updated
    const updatedControls = (device as any)._updatedControls as Set<ControlId>;
    expect(updatedControls.has(CONTROL_ID.POWER)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.MODE)).toBe(true);
    expect(updatedControls.has(CONTROL_ID.TARGET_TEMPERATURE)).toBe(true);
    expect(updatedControls.size).toBe(3);

    // Patch _sendCommandsGetResponses to prevent network access
    const sendMock = mock(() => Promise.resolve([]));
    (device as any)._sendCommandsGetResponses = sendMock;

    // Apply changed settings
    await device.apply();

    // Assert mock was called
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Get call arguments
    const args = sendMock.mock.calls[0]!;
    const commands = args[0] as ControlCommand[];

    // Only 1 command should be sent
    expect(commands.length).toBe(1);

    // Assert power control present via the command's internal controls
    const cmdControls = (commands[0] as any)._controls as Map<ControlId, number | boolean>;
    expect(cmdControls.size).toBe(1);
    expect(cmdControls.has(CONTROL_ID.POWER)).toBe(true);

    // Assert no other controls present
    expect(cmdControls.has(CONTROL_ID.MODE)).toBe(false);
    expect(cmdControls.has(CONTROL_ID.TARGET_TEMPERATURE)).toBe(false);

    // Ensure no controls remain
    expect((device as any)._updatedControls.size).toBe(0);
  });

  it("should send only power control when powering off alone", async () => {
    const device = createDevice();

    // Only set power off
    device.powerState = false;

    const updatedControls = (device as any)._updatedControls as Set<ControlId>;
    expect(updatedControls.has(CONTROL_ID.POWER)).toBe(true);
    expect(updatedControls.size).toBe(1);

    // Patch _sendCommandsGetResponses to prevent network access
    const sendMock = mock(() => Promise.resolve([]));
    (device as any)._sendCommandsGetResponses = sendMock;

    await device.apply();

    expect(sendMock).toHaveBeenCalledTimes(1);

    const args = sendMock.mock.calls[0]!;
    const commands = args[0] as any[];
    expect(commands.length).toBe(1);

    expect((device as any)._updatedControls.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TestSendCommandGetResponse
// ---------------------------------------------------------------------------

describe("TestSendCommandGetResponse", () => {
  it("should mark device offline when refresh gets no response", async () => {
    const device = createDevice();

    // Force device online
    (device as any)._online = true;
    expect(device.online).toBe(true);

    // Patch _sendCommand to return no responses
    (device as any)._sendCommand = mock(() => Promise.resolve([]));

    await device.refresh();

    // Assert device is now offline
    expect(device.online).toBe(false);
  });

  it("should mark device online and supported on valid response", async () => {
    const TEST_RESPONSE = Buffer.from(
      "aa63cc0000000000000301fe00000043005001728c79010100728c728c797900010141ff010203000603010000000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff6a",
      "hex",
    );

    const device = createDevice();

    // Assert device starts offline and unsupported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // Patch _sendCommand to return a valid response
    (device as any)._sendCommand = mock(() =>
      Promise.resolve([TEST_RESPONSE]),
    );

    await device.refresh();

    // Assert device is now online and supported
    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);
  });

  it("should stay online with only one response", async () => {
    const TEST_RESPONSE = Buffer.from(
      "aa63cc0000000000000301fe00000043005001728c8000d200728c728c7b7b00010141ff010203000602010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff8e",
      "hex",
    );

    const device = createDevice();

    // Force device online
    (device as any)._online = true;
    expect(device.online).toBe(true);

    let packetCount = 0;

    // Dummy method to only respond to state commands
    (device as any)._sendCommand = mock(
      async (command: any): Promise<Uint8Array[]> => {
        packetCount++;
        if (command instanceof QueryCommand) {
          return [TEST_RESPONSE];
        }
        return [];
      },
    );

    await device.refresh();

    // Assert expected number of packets was sent
    expect(packetCount).toBe(1);

    // Assert device is still online
    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);
  });

  it("should keep supported=true even when device goes offline", async () => {
    const TEST_RESPONSE = Buffer.from(
      "aa63cc0000000000000301fe00000043005000728c7b00d200728c728c7b7b00010141ff010203000602010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff94",
      "hex",
    );

    const device = createDevice();

    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // First refresh: return valid response
    (device as any)._sendCommand = mock(() =>
      Promise.resolve([TEST_RESPONSE]),
    );

    await device.refresh();

    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);

    // Second refresh: no response
    (device as any)._sendCommand = mock(() => Promise.resolve([]));

    await device.refresh();

    // Device offline but still supported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(true);
  });

  it("should mark device online but unsupported for wrong device type response", async () => {
    const TEST_RESPONSE = Buffer.from(
      "aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79",
      "hex",
    );

    const device = createDevice();

    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // Patch _sendCommand to return wrong-type response
    (device as any)._sendCommand = mock(() =>
      Promise.resolve([TEST_RESPONSE]),
    );

    await device.refresh();

    // Device is online (got response) but unsupported (invalid frame)
    expect(device.online).toBe(true);
    expect(device.supported).toBe(false);
  });

  it("should handle getCapabilities with no response", async () => {
    const device = createDevice();

    // Patch _sendCommand to return no response
    (device as any)._sendCommand = mock(() => Promise.resolve([]));

    // Should not throw
    await device.getCapabilities();
  });

  it("should handle getCapabilities with unexpected response type", async () => {
    const WRONG_RESPONSE = Buffer.from(
      "aa16cc0000000000000200000101ff00030180ff000098",
      "hex",
    );

    const device = createDevice();

    // Patch _sendCommand to return wrong response type
    (device as any)._sendCommand = mock(() =>
      Promise.resolve([WRONG_RESPONSE]),
    );

    // Should not throw
    await device.getCapabilities();
  });
});

// ---------------------------------------------------------------------------
// TestCapabilityOverrides
// ---------------------------------------------------------------------------

describe("TestCapabilityOverrides", () => {
  it("should override min/max target temperatures", () => {
    const device = createDevice();

    device.overrideCapabilities({ min_target_temperature: 22.5 });
    expect(device.minTargetTemperature).toBe(22.5);

    device.overrideCapabilities({ max_target_temperature: 40 });
    expect(device.maxTargetTemperature).toBe(40.0);
  });

  it("should override operational modes", () => {
    const TEST_OVERRIDE = {
      supported_modes: [
        CC_OPERATIONAL_MODE.HEAT,
        CC_OPERATIONAL_MODE.COOL,
        CC_OPERATIONAL_MODE.AUTO,
      ],
    };

    const EXPECTED_VALUE = [
      CC_OPERATIONAL_MODE.HEAT,
      CC_OPERATIONAL_MODE.COOL,
      CC_OPERATIONAL_MODE.AUTO,
    ];

    const device = createDevice();

    expect(device.supportedOperationModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities(TEST_OVERRIDE);

    expect(device.supportedOperationModes).toEqual(EXPECTED_VALUE);
  });

  it("should override swing modes", () => {
    const TEST_OVERRIDE = {
      supported_swing_modes: [
        CC_SWING_MODE.BOTH,
        CC_SWING_MODE.HORIZONTAL,
      ],
    };

    const EXPECTED_VALUE = [
      CC_SWING_MODE.BOTH,
      CC_SWING_MODE.HORIZONTAL,
    ];

    const device = createDevice();

    expect(device.supportedSwingModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities(TEST_OVERRIDE);

    expect(device.supportedSwingModes).toEqual(EXPECTED_VALUE);
  });

  it("should override fan speeds", () => {
    const TEST_OVERRIDE = {
      supported_fan_speeds: [
        CC_FAN_SPEED.AUTO,
        CC_FAN_SPEED.L6,
      ],
    };

    const EXPECTED_VALUE = [
      CC_FAN_SPEED.AUTO,
      CC_FAN_SPEED.L6,
    ];

    const device = createDevice();

    expect(device.supportedFanSpeeds).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities(TEST_OVERRIDE);

    expect(device.supportedFanSpeeds).toEqual(EXPECTED_VALUE);
  });

  it("should override aux heat modes", () => {
    const TEST_OVERRIDE = {
      supported_aux_modes: [
        CC_AUX_HEAT_MODE.OFF,
        CC_AUX_HEAT_MODE.ON,
      ],
    };

    const EXPECTED_VALUE = [
      CC_AUX_HEAT_MODE.OFF,
      CC_AUX_HEAT_MODE.ON,
    ];

    const device = createDevice();

    expect(device.supportedAuxModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities(TEST_OVERRIDE);

    expect(device.supportedAuxModes).toEqual(EXPECTED_VALUE);
  });

  it("should override purifier modes", () => {
    const TEST_OVERRIDE = {
      supported_purifier_modes: [
        CC_PURIFIER_MODE.OFF,
        CC_PURIFIER_MODE.AUTO,
      ],
    };

    const EXPECTED_VALUE = [
      CC_PURIFIER_MODE.OFF,
      CC_PURIFIER_MODE.AUTO,
    ];

    const device = createDevice();

    expect(device.supportedPurifierModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities(TEST_OVERRIDE);

    expect(device.supportedPurifierModes).toEqual(EXPECTED_VALUE);
  });

  it("should override additional capabilities", () => {
    const device = createDevice();

    // Alter default capabilities
    (device as any)._capabilities.set(CC_CAPABILITY.ECO, false);
    (device as any)._capabilities.set(CC_CAPABILITY.SILENT, true);
    (device as any)._capabilities.set(CC_CAPABILITY.SLEEP, false);

    // Assert the capabilities match
    expect(device.supportsEco).toBe(false);
    expect(device.supportsSilent).toBe(true);
    expect(device.supportsSleep).toBe(false);

    // Override capabilities — in the TS port, the override expects the
    // bitmask value directly. We set it to ECO | SLEEP.
    device.overrideCapabilities({
      additional_capabilities: CC_CAPABILITY.ECO | CC_CAPABILITY.SLEEP,
    });

    // Assert they match
    expect(device.supportsEco).toBe(true);
    expect(device.supportsSilent).toBe(false);
    expect(device.supportsSleep).toBe(true);
  });
});
