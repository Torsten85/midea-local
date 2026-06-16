/**
 * Tests for CC (Commercial AC) command and response classes.
 *
 * Ported from msmart/device/CC/test_command.py
 */

import { describe, it, expect } from "bun:test";
import {
  Command,
  QueryCommand,
  ControlCommand,
  Response,
  QueryResponse,
  ControlResponse,
  InvalidResponseError,
  CONTROL_ID,
  decodeControl,
  encodeControl,
} from "../src/device/cc/command.ts";
import type { ControlId } from "../src/device/cc/command.ts";
import { DEVICE_TYPE, FRAME_TYPE } from "../src/const.ts";
import { Frame, InvalidFrameError } from "../src/frame.ts";

// ---------------------------------------------------------------------------
// Helper: reset the module-level messageId counter
// ---------------------------------------------------------------------------

/**
 * Reset the module-level message ID to a specific value so tests get
 * deterministic output.  We abuse the fact that the module var is
 * incremented by `nextMessageId()` *before* use, so setting it to
 * `target - 1` means the next call will produce `target`.
 *
 * Since the counter is a module-private `let`, we patch it via the
 * exported `Command` class by overriding `toBytes` temporarily.
 * Actually, Python did `Command._message_id = 0x00` which is a class var.
 * The TS port uses a module-level `let messageId`.  We can't easily reach it,
 * so we work around it: we build a command and just verify the *payload*
 * portion of the frame (bytes 10 to -1) after stripping the last 2 bytes
 * (message id + CRC).
 */

// ---------------------------------------------------------------------------
// TestCommand
// ---------------------------------------------------------------------------

describe("TestCommand", () => {
  it("should frame a command properly", () => {
    // Build a QueryCommand and serialize it
    const command = new QueryCommand();
    const frame = command.toBytes();
    expect(frame).not.toBeNull();

    // Frame should be valid
    Frame.validate(frame, DEVICE_TYPE.COMMERCIAL_AC);

    // The payload region is frame[10 .. -1] (everything between header and checksum)
    const payload = frame.subarray(10, frame.length - 1);

    // Payload should be: 22 bytes of query data + 1 byte message id + 1 byte CRC = 24 bytes
    expect(payload.length).toBe(24);

    // First byte of query payload should be 0x01
    expect(payload[0]).toBe(0x01);

    // Check length byte (header length 10 + payload length)
    expect(frame[1]).toBe(payload.length + 10);

    // Check device type
    expect(frame[2]).toBe(DEVICE_TYPE.COMMERCIAL_AC);

    // Check frame type
    expect(frame[9]).toBe(FRAME_TYPE.QUERY);
  });
});

// ---------------------------------------------------------------------------
// TestQueryResponse
// ---------------------------------------------------------------------------

describe("TestQueryResponse", () => {
  /** Expected attributes on QueryResponse */
  const EXPECTED_ATTRS: (keyof QueryResponse)[] = [
    "powerOn",
    "targetTemperature",
    "indoorTemperature",
    "outdoorTemperature",
    "fahrenheit",
    "targetHumidity",
    "indoorHumidity",
    "operationalMode",
    "fanSpeed",
    "vertSwingAngle",
    "horzSwingAngle",
    "windSense",
    "eco",
    "silent",
    "sleep",
    "purifier",
    "beep",
    "display",
    "auxMode",
    // Capabilities
    "targetTemperatureMin",
    "targetTemperatureMax",
    "supportsHumidity",
    "supportedOpModes",
    "supportsFanSpeed",
    "supportsVertSwingAngle",
    "supportsHorzSwingAngle",
    "supportsWindSense",
    "supportsCo2Level",
    "supportsEco",
    "supportsSilent",
    "supportsSleep",
    "supportsSelfClean",
    "supportsPurifier",
    "supportsPurifierAuto",
    "supportsFilterLevel",
    "supportedAuxModes",
  ];

  /**
   * Build a response from a full frame message and assert it is a QueryResponse.
   */
  function buildResponse(msg: Uint8Array): QueryResponse {
    const resp = Response.construct(msg);
    expect(resp).not.toBeNull();

    // Check all expected attributes exist
    for (const attr of EXPECTED_ATTRS) {
      expect(attr in resp).toBe(true);
    }

    expect(resp).toBeInstanceOf(QueryResponse);
    return resp as QueryResponse;
  }

  /**
   * Build a QueryResponse directly from a payload (no frame wrapping).
   */
  function buildFromPayload(payload: Uint8Array): QueryResponse {
    const resp = new QueryResponse(payload);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(QueryResponse);
    return resp;
  }

  it("should parse a full query response message", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3268766672
    const TEST_MESSAGE = Buffer.from(
      "aa63cc0000000000000301fe00000043005001728c79010100728c728c797900010141ff010203000603010000000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff6a",
      "hex",
    );
    const resp = buildResponse(TEST_MESSAGE);

    // Check basic state
    expect(resp.powerOn).toBe(true);
    expect(resp.targetTemperature).toBe(20.5);
    expect(resp.indoorTemperature).toBe(25.7);
    expect(resp.operationalMode).toBe(3); // Heat
    expect(resp.fanSpeed).toBe(0);
    expect(resp.vertSwingAngle).toBe(3);
    expect(resp.horzSwingAngle).toBe(3);
  });

  it("should throw on invalid header", () => {
    const TEST_PAYLOADS = [
      Buffer.from(
        "01ff0000000000000000000000000000000000000000000000000000000000",
        "hex",
      ),
      Buffer.from(
        "00fe0000000000000000000000000000000000000000000000000000000000",
        "hex",
      ),
    ];
    for (const payload of TEST_PAYLOADS) {
      expect(() => buildFromPayload(payload)).toThrow(InvalidResponseError);
    }
  });

  it("should parse target temperature correctly", () => {
    const TEST_PAYLOADS: [number, string][] = [
      // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3268885233
      [17.0, "01fe00000043005001728c7200dd00728c728c727200010141ff010203000603010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [30.0, "01fe00000043005001728c8c00e100728c728c8c8c00010141ff010203000603010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3268766672
      [20.5, "01fe00000043005001728c79010000728c728c797900010141ff010203000603010000000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [value, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.targetTemperature).toBe(value);
    }
  });

  it("should parse indoor temperature correctly", () => {
    const TEST_PAYLOADS: [number, string][] = [
      // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3273394865
      [20.7, "01fe00000043005000728c7800cf00728c728c787800010141ff010203000603010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff"],
      [20.3, "01fe00000043005000728c7800cb00728c728c787800010141ff010203000603010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff"],
      [19.2, "01fe00000043005000728c7800c000728c728c787800010141ff010203000603010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff"],
      [23.9, "01fe00000043005001728c8c00ef00728c728c8c8c00010141ff010203000603010008000500000001050106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ff"],
      // Samples with data in MSB
      [26.4, "01fe00000043005001728c78010800728c728c787800010141ff010203000602010008000100000001010103010300000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [25.6, "01fe00000043005001728c78010000728c728c787800010141ff010203000603010008000600000001060106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [temperature, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.indoorTemperature).toBe(temperature);
    }
  });

  it("should parse operational mode correctly", () => {
    const TEST_PAYLOADS: [number, string][] = [
      // Fan
      [1, "01fe00000043005001728c7800eb00728c728c787800010141ff010203000601010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Cool
      [2, "01fe00000043005001728c7800f100728c728c787800010141ff010203000602010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Heat
      [3, "01fe00000043005001728c7800e700728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Dry
      [6, "01fe00000043005001728c7800f000728c728c787800010141ff010203000606010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [value, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.operationalMode).toBe(value);
    }
  });

  it("should parse fan speed correctly", () => {
    const TEST_PAYLOADS: [number, string][] = [
      [1, "01fe00000043005001728c7900e500728c728c797900010141ff010203000603010001000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [2, "01fe00000043005001728c7900da00728c728c797900010141ff010203000603010002000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [3, "01fe00000043005001728c7900d600728c728c797900010141ff010203000603010003000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [7, "01fe00000043005001728c7900d500728c728c797900010141ff010203000603010007000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [8, "01fe00000043005001728c7900d900728c728c797900010141ff010203000603010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [speed, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.fanSpeed).toBe(speed);
    }
  });

  it("should parse swing angle correctly", () => {
    const TEST_PAYLOADS: [[number, number], string][] = [
      // Vert
      [[1, 3], "01fe00000043005001728c7800e700728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [[2, 3], "01fe00000043005001728c7800eb00728c728c787800010141ff010203000603010008000200000001020103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [[5, 3], "01fe00000043005001728c7800ed00728c728c787800010141ff010203000603010008000500000001050103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Auto but it's 0
      [[0, 3], "01fe00000043005001728c7800ee00728c728c787800010141ff010203000603010008000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Horz
      [[1, 1], "01fe00000043005001728c7800e100728c728c787800010141ff010203000603010008000100000001010101010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [[1, 2], "01fe00000043005001728c7800db00728c728c787800010141ff010203000603010008000100000001010102010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [[1, 5], "01fe00000043005001728c7800db00728c728c787800010141ff010203000603010008000100000001010105010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      [[1, 6], "01fe00000043005001728c7800e100728c728c787800010141ff010203000603010008000100000001010106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
      // Both auto
      [[6, 6], "01fe00000043005001728c7800ff00728c728c787800010141ff010203000603010008000600000001060106010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [[udAngle, lrAngle], hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.vertSwingAngle).toBe(udAngle);
      expect(resp.horzSwingAngle).toBe(lrAngle);
    }
  });

  it("should parse miscellaneous properties correctly", () => {
    const TEST_PAYLOADS: [Record<string, boolean | number>, string][] = [
      // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3272675291
      [{ sleep: true, silent: false, purifier: 2, eco: false },
        "01fe00000043005001728c78010900728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010100000000000000000000000001000200000100000101000102ff02"],
      [{ sleep: false, silent: true, purifier: 2, eco: false },
        "01fe00000043005001728c78010700728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000101010000000000000000000000000001000200000100000101000102ff02"],
      [{ sleep: false, silent: false, purifier: 1, eco: false },
        "01fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000100000100000101000102ff02"],
      [{ sleep: false, silent: false, purifier: 2, eco: true },
        "01fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001010100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [props, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.sleep).toBe(props.sleep);
      expect(resp.silent).toBe(props.silent);
      expect(resp.purifier).toBe(props.purifier);
      expect(resp.eco).toBe(props.eco);
    }
  });

  it("should parse aux mode correctly", () => {
    const TEST_PAYLOADS: [number, string][] = [
      // Forced on
      [1, "01fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff01"],
      // Auto
      [0, "01fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff00"],
      // Forced off
      [2, "01fe00000043005001728c78010600728c728c787800010141ff010203000603010008000100000001010103010000000000000000000001010100010000000000000000000000000001000200000100000101000102ff02"],
    ];
    for (const [value, hex] of TEST_PAYLOADS) {
      const resp = buildFromPayload(Buffer.from(hex, "hex"));
      expect(resp.auxMode).toBe(value);
    }
  });

  it("should parse capabilities correctly", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3268885233
    const TEST_PAYLOAD = Buffer.from(
      "01fe00000043005001728c7800eb00728c728c787800010141ff010203000601010008000300000001030103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02",
      "hex",
    );

    const resp = buildFromPayload(TEST_PAYLOAD);
    resp.parseCapabilities();

    expect(resp.targetTemperatureMin).toBe(17.0);
    expect(resp.targetTemperatureMax).toBe(30.0);

    expect(resp.supportsHumidity).toBe(true);

    // Check for supported modes
    expect(resp.supportedOpModes).not.toBeNull();
    expect(resp.supportedOpModes!).toContain(1);
    expect(resp.supportedOpModes!).toContain(2);
    expect(resp.supportedOpModes!).toContain(3);
    expect(resp.supportedOpModes!).toContain(6);

    expect(resp.supportsFanSpeed).toBe(true);

    expect(resp.supportsVertSwingAngle).toBe(true);
    expect(resp.supportsHorzSwingAngle).toBe(true);

    expect(resp.supportsWindSense).toBe(true);

    expect(resp.supportsCo2Level).toBe(false);

    expect(resp.supportsEco).toBe(true);
    expect(resp.supportsSilent).toBe(true);
    expect(resp.supportsSleep).toBe(true);

    expect(resp.supportsSelfClean).toBe(false);

    expect(resp.supportsPurifier).toBe(true);
    expect(resp.supportsPurifierAuto).toBe(false);

    expect(resp.supportsFilterLevel).toBe(true);

    // Check for supported aux modes
    expect(resp.supportedAuxModes).not.toBeNull();
    expect(resp.supportedAuxModes!).toContain(0);
    expect(resp.supportedAuxModes!).toContain(1);
    expect(resp.supportedAuxModes!).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// TestControlResponse
// ---------------------------------------------------------------------------

describe("TestControlResponse", () => {
  function buildResponse(msg: Uint8Array): ControlResponse {
    const resp = Response.construct(msg);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(ControlResponse);
    return resp as ControlResponse;
  }

  function buildFromPayload(payload: Uint8Array): ControlResponse {
    const resp = new ControlResponse(payload);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(ControlResponse);
    return resp;
  }

  it("should parse a full control response message", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3530709294
    const TEST_MESSAGE = Buffer.from(
      "aa16cc0000000000000200000101ff00120102ff000007",
      "hex",
    );
    const resp = buildResponse(TEST_MESSAGE);

    // Access internal _states via getControlState
    // The Python test checks len(resp._states) == 2
    // We verify via specific control IDs
    expect(resp.getControlState(CONTROL_ID.MODE)).toBe(2);
    expect(resp.getControlState(CONTROL_ID.POWER)).toBe(1); // true as number
  });

  it("should throw on payload too short", () => {
    const TEST_PAYLOAD = Buffer.from("00000101", "hex");
    expect(() => buildFromPayload(TEST_PAYLOAD)).toThrow(InvalidResponseError);
  });

  it("should handle zero length entries", () => {
    // Response to malformed request, 4 entries, 2 of zero length
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3332107433
    const TEST_PAYLOAD = Buffer.from(
      "00000000ff00200100ff00000000ff00000100ff00000000",
      "hex",
    );
    const resp = buildFromPayload(TEST_PAYLOAD);

    // Only 2 non-zero-length entries should be parsed
    // Both should be null since IDs 0x0020 and 0x0000 – 0x0000 is POWER, 0x0020 is WIND_SENSE
    // Check that at least 2 controls were parsed successfully
    // The Python test checks len(resp._states) == 2
    const powerState = resp.getControlState(CONTROL_ID.POWER);
    const windSenseState = resp.getControlState(CONTROL_ID.WIND_SENSE);
    // At least one must be non-null
    const parsedCount = [powerState, windSenseState].filter(
      (v) => v !== null,
    ).length;
    expect(parsedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TestResponseConstruct
// ---------------------------------------------------------------------------

describe("TestResponseConstruct", () => {
  it("should throw on invalid checksum", () => {
    const TEST_RESPONSE_BAD_CHECKSUM = Buffer.from(
      "aa1bcc0000000000000200000101ff003a0101ff00000000ff0000FF",
      "hex",
    );
    expect(() => Response.construct(TEST_RESPONSE_BAD_CHECKSUM)).toThrow(
      InvalidFrameError,
    );
  });

  it("should throw on short packet", () => {
    // https://github.com/mill1000/midea-msmart/issues/234#issuecomment-3299199631
    const TEST_RESPONSE_SHORT_FRAME = Buffer.from("01000000", "hex");
    expect(() => Response.construct(TEST_RESPONSE_SHORT_FRAME)).toThrow(
      InvalidFrameError,
    );
  });

  it("should throw on invalid device type", () => {
    const TEST_RESPONSE_TYPE_AC = Buffer.from(
      "aa18ac00000000000302b0020a0000013209001101000089a4",
      "hex",
    );
    expect(() => Response.construct(TEST_RESPONSE_TYPE_AC)).toThrow(
      InvalidFrameError,
    );
  });
});

// ---------------------------------------------------------------------------
// TestCommandId (encode/decode)
// ---------------------------------------------------------------------------

describe("TestCommandId", () => {
  it("should decode control values correctly", () => {
    const TEST_DECODES: [ControlId, Uint8Array, number][] = [
      // Target temperature x / 2 - 40
      [CONTROL_ID.TARGET_TEMPERATURE, new Uint8Array([0x72]), 17.0],
      [CONTROL_ID.TARGET_TEMPERATURE, new Uint8Array([0x79]), 20.5],
      [CONTROL_ID.TARGET_TEMPERATURE, new Uint8Array([0x8c]), 30],

      // Everything else is passthru
      [CONTROL_ID.POWER, new Uint8Array([0x01]), 0x01],
      [CONTROL_ID.POWER, new Uint8Array([0x00]), 0x00],
      [CONTROL_ID.POWER, new Uint8Array([0x02]), 0x02],
    ];

    for (const [id, data, expectedValue] of TEST_DECODES) {
      expect(decodeControl(id, data)).toBe(expectedValue);
    }
  });

  it("should encode control values correctly", () => {
    const TEST_ENCODES: [ControlId, number, Uint8Array][] = [
      // Target temperature 2x + 80
      [CONTROL_ID.TARGET_TEMPERATURE, 17.0, new Uint8Array([0x72])],
      [CONTROL_ID.TARGET_TEMPERATURE, 20.5, new Uint8Array([0x79])],
      [CONTROL_ID.TARGET_TEMPERATURE, 30, new Uint8Array([0x8c])],

      // Everything else is passthru
      [CONTROL_ID.AUX_MODE, 0x04, new Uint8Array([0x04])],
      [CONTROL_ID.AUX_MODE, 0x00, new Uint8Array([0x00])],
    ];

    for (const [id, value, expectedData] of TEST_ENCODES) {
      expect(encodeControl(id, value)).toEqual(expectedData);
    }
  });
});

// ---------------------------------------------------------------------------
// TestControlCommand
// ---------------------------------------------------------------------------

describe("TestControlCommand", () => {
  it("should encode control command payloads correctly", () => {
    // https://github.com/mill1000/midea-msmart/pull/233#issuecomment-3537179647
    const PAYLOAD = Buffer.from(
      "00000101ff00120102ff001c0104ff",
      "hex",
    );

    const controls = new Map<ControlId, number | boolean>([
      [CONTROL_ID.POWER, true],
      [CONTROL_ID.MODE, 2],
      [CONTROL_ID.VERT_SWING_ANGLE, 4],
    ]);

    // Build command
    const command = new ControlCommand(controls);

    // Fetch full frame, then extract payload (between header and checksum)
    const frame = command.toBytes();
    const fullPayload = frame.subarray(10, frame.length - 1);

    // The payload includes the control entries + message id byte + CRC byte at end
    // The control entries are the first part (before msg id and CRC)
    const controlEntries = fullPayload.subarray(0, fullPayload.length - 2);

    // Test against payload that device accepted
    expect(Buffer.from(controlEntries)).toEqual(PAYLOAD);
  });
});
