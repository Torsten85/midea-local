/**
 * Command and response messages for 0xCC (Commercial AC) devices.
 *
 * Ported from msmart/device/CC/command.py
 * @module
 */

import { DEVICE_TYPE, FRAME_TYPE } from "../../const.ts";
import type { FrameType } from "../../const.ts";
import { Frame } from "../../frame.ts";
import { calculate as crc8Calculate } from "../../crc8.ts";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a response fails validation. */
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

// ---------------------------------------------------------------------------
// Const objects & derived union types
// ---------------------------------------------------------------------------

/** Control ID constants for CC device control TLVs. */
export const CONTROL_ID = {
  POWER: 0x0000,
  TARGET_TEMPERATURE: 0x0003,
  TEMPERATURE_UNIT: 0x000c,
  TARGET_HUMIDITY: 0x000f,
  MODE: 0x0012,
  FAN_SPEED: 0x0015,
  VERT_SWING_ANGLE: 0x001c,
  HORZ_SWING_ANGLE: 0x001e,
  WIND_SENSE: 0x0020,
  ECO: 0x0028,
  SILENT: 0x002a,
  SLEEP: 0x002c,
  SELF_CLEAN: 0x002e,
  PURIFIER: 0x003a,
  BEEP: 0x003f,
  DISPLAY: 0x0040,
  AUX_MODE: 0x0043,
} as const;

export type ControlId = (typeof CONTROL_ID)[keyof typeof CONTROL_ID];

/**
 * Decode raw control data into a convenient form.
 *
 * @param id   - The control ID.
 * @param data - The raw control data bytes.
 * @returns The decoded value.
 */
export function decodeControl(id: ControlId, data: Uint8Array): number {
  if (id === CONTROL_ID.TARGET_TEMPERATURE) {
    return data[0]! / 2.0 - 40;
  } else {
    return data[0]!;
  }
}

/**
 * Encode a control value into raw form.
 *
 * @param id   - The control ID.
 * @param args - The value(s) to encode.
 * @returns The encoded bytes.
 */
export function encodeControl(id: ControlId, ...args: unknown[]): Uint8Array {
  if (id === CONTROL_ID.TARGET_TEMPERATURE) {
    return new Uint8Array([Math.trunc(2 * (args[0] as number) + 80)]);
  } else {
    return new Uint8Array([args[0] as number]);
  }
}

// ---------------------------------------------------------------------------
// Module-level message ID counter (shared across all CC Command instances)
// ---------------------------------------------------------------------------

let messageId = 0;

function nextMessageId(): number {
  messageId += 1;
  return messageId & 0xff;
}

// ---------------------------------------------------------------------------
// Command classes
// ---------------------------------------------------------------------------

/** Base class for CC commands. */
export class Command extends Frame {
  constructor(frameType: FrameType) {
    super(DEVICE_TYPE.COMMERCIAL_AC, frameType);
  }

  /**
   * Serialise the command payload into a complete protocol frame.
   *
   * Appends a message ID byte and CRC8 checksum after the supplied data
   * before delegating to {@link Frame.toBytes}.
   */
  override toBytes(data: Uint8Array = new Uint8Array(0)): Uint8Array {
    // Append message ID to payload
    const withMsgId = new Uint8Array(data.length + 1);
    withMsgId.set(data, 0);
    withMsgId[data.length] = nextMessageId();

    // Append CRC
    const withCrc = new Uint8Array(withMsgId.length + 1);
    withCrc.set(withMsgId, 0);
    withCrc[withMsgId.length] = crc8Calculate(withMsgId);

    return super.toBytes(withCrc);
  }
}

/** Command to query state of the device. */
export class QueryCommand extends Command {
  constructor() {
    super(FRAME_TYPE.QUERY);
  }

  override toBytes(): Uint8Array {
    const payload = new Uint8Array(22);
    payload[0] = 0x01;
    return super.toBytes(payload);
  }
}

/** Command to control state of the device. */
export class ControlCommand extends Command {
  private readonly _controls: ReadonlyMap<ControlId, number | boolean>;

  constructor(controls: ReadonlyMap<ControlId, number | boolean>) {
    super(FRAME_TYPE.CONTROL);
    this._controls = controls;
  }

  override toBytes(): Uint8Array {
    const parts: Uint8Array[] = [];

    for (const [control, value] of this._controls) {
      // Control ID (big-endian uint16)
      const idBuf = new Uint8Array(2);
      const idView = new DataView(idBuf.buffer);
      idView.setUint16(0, control, false); // big-endian
      parts.push(idBuf);

      // Encode control value to bytes
      const encoded = encodeControl(control, value);

      parts.push(new Uint8Array([encoded.length]));
      parts.push(encoded);
      parts.push(new Uint8Array([0xff])); // terminator
    }

    // Concatenate all parts
    const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
    const payload = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      payload.set(part, offset);
      offset += part.length;
    }

    return super.toBytes(payload);
  }
}

// ---------------------------------------------------------------------------
// Response classes
// ---------------------------------------------------------------------------

/** Base class for CC responses. */
export class Response {
  private readonly _type: number;
  private readonly _payload: Uint8Array;

  constructor(payload: Uint8Array) {
    this._type = payload[0]!;
    this._payload = new Uint8Array(payload);
  }

  toString(): string {
    return Buffer.from(this._payload).toString("hex");
  }

  /** The response type byte. */
  get type(): number {
    return this._type;
  }

  /** Copy of the response payload. */
  get payload(): Uint8Array {
    return this._payload;
  }

  /** Validate the response (currently a no-op, matching Python). */
  static validate(_payload: Uint8Array): void {
    // TODO
  }

  /**
   * Construct a response object from a raw frame.
   *
   * Validates the frame, determines the response type from the frame type
   * byte, and returns the appropriate response subclass instance.
   */
  static construct(frame: Uint8Array): ControlResponse | QueryResponse | Response {
    // Validate the frame
    Frame.validate(frame, DEVICE_TYPE.COMMERCIAL_AC);

    // Default to base class
    let ResponseClass: new (payload: Uint8Array) => Response = Response;

    // Fetch the appropriate response class from the frame type
    const frameType = frame[9]!;
    if (frameType === FRAME_TYPE.QUERY || frameType === FRAME_TYPE.REPORT) {
      ResponseClass = QueryResponse;
    } else if (frameType === FRAME_TYPE.CONTROL) {
      ResponseClass = ControlResponse;
    }

    // Validate the payload
    Response.validate(frame.subarray(10, frame.length - 1));

    // Build the response (payload is frame[10 .. -1])
    return new ResponseClass(frame.subarray(10, frame.length - 1));
  }
}

// ---------------------------------------------------------------------------
// QueryResponse
// ---------------------------------------------------------------------------

/** Response to query command. */
export class QueryResponse extends Response {
  powerOn = false;
  targetTemperature = 24;
  indoorTemperature: number | null = null;
  outdoorTemperature: number | null = null;
  fahrenheit = false;
  targetHumidity = 40;
  indoorHumidity: number | null = null;
  operationalMode = 0;
  fanSpeed = 0;
  vertSwingAngle = 0;
  horzSwingAngle = 0;
  windSense = 0;
  eco = false;
  silent = false;
  sleep = false;
  purifier = 0;
  beep = false;
  display = false;
  auxMode = 0;

  // Capabilities
  targetTemperatureMin = 17;
  targetTemperatureMax = 30;
  supportsHumidity = false;
  supportedOpModes: number[] | null = null;
  supportsFanSpeed = false;
  supportsVertSwingAngle = false;
  supportsHorzSwingAngle = false;
  supportsWindSense = false;
  supportsCo2Level = false;
  supportsEco = false;
  supportsSilent = false;
  supportsSleep = false;
  supportsSelfClean = false;
  supportsPurifier = false;
  supportsPurifierAuto = false;
  supportsFilterLevel = false;
  supportedAuxModes: number[] | null = null;

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parseTemperature(data: number): number {
    return data / 2.0 - 40;
  }

  private _parse(payload: Uint8Array): void {
    // Validate header
    if (payload[0] !== 0x01 || payload[1] !== 0xfe) {
      throw new InvalidResponseError(
        `Query response payload '${Buffer.from(payload).toString("hex")}' ` +
          `lacks expected header 0x01FE.`,
      );
    }

    this.powerOn = Boolean(payload[8]);

    this.targetTemperature = this._parseTemperature(payload[11]!);

    this.indoorTemperature = ((payload[12]! << 8) | payload[13]!) / 10.0;

    // TODO unverified, sample device returned 0
    const outdoorTemp = payload[14]!;
    if (outdoorTemp) {
      this.outdoorTemperature = this._parseTemperature(outdoorTemp);
    } else {
      this.outdoorTemperature = null;
    }

    this.fahrenheit = Boolean(payload[21]);

    // TODO unverified
    this.targetHumidity = payload[24]!;
    const indoorHumidity = payload[25]!;
    if (indoorHumidity !== 0xff) {
      this.indoorHumidity = indoorHumidity;
    } else {
      this.indoorHumidity = null;
    }

    this.operationalMode = payload[31]!;
    this.fanSpeed = payload[34]!;

    this.vertSwingAngle = payload[41]!; // Replicated at payload[36]?
    this.horzSwingAngle = payload[43]!; // Not replicated?

    // 0 - "Close", 1 - Follow, 2 - Avoid, 3 - Soft, 4 - Strong
    this.windSense = payload[45]!;

    this.eco = Boolean(payload[56]);
    this.silent = Boolean(payload[58]);
    this.sleep = Boolean(payload[60]);

    this.purifier = payload[75]!; // 0 - Auto, 1 - On, 2 - Off

    // TODO unverified, sample device did not respond as expected
    this.beep = Boolean(payload[80]);
    this.display = Boolean(payload[81]);

    // 0 - Auto, 1 - On, 2 - Off, 4 - "Separate"
    this.auxMode = payload[87]!;
  }

  /** Parse capabilities from the query response payload. */
  parseCapabilities(): void {
    const payload = this.payload;

    // Additional cool/heat min/max temperatures available, but plugin only uses these
    this.targetTemperatureMin = this._parseTemperature(payload[9]!);
    this.targetTemperatureMax = this._parseTemperature(payload[10]!);

    this.supportsHumidity = Boolean(payload[23]); // TODO unverified

    this.supportedOpModes = Array.from(payload.subarray(26, 31));

    this.supportsFanSpeed = Boolean(payload[32]);

    this.supportsVertSwingAngle = Boolean(payload[40]);
    this.supportsHorzSwingAngle = Boolean(payload[42]);

    this.supportsWindSense = Boolean(payload[44]);

    this.supportsCo2Level = Boolean(payload[52]);

    this.supportsEco = Boolean(payload[55]);
    this.supportsSilent = Boolean(payload[57]);
    this.supportsSleep = Boolean(payload[59]);

    this.supportsSelfClean = Boolean(payload[61]); // TODO unverified

    this.supportsPurifier = Boolean(payload[73]);
    this.supportsPurifierAuto = Boolean(payload[74]); // TODO unverified

    this.supportsFilterLevel = Boolean(payload[78]); // TODO unverified

    const supportsAuxHeat = Boolean(payload[82]);
    if (supportsAuxHeat) {
      this.supportedAuxModes = Array.from(payload.subarray(83, 87));
    }
  }
}

// ---------------------------------------------------------------------------
// ControlResponse
// ---------------------------------------------------------------------------

/** Response to control command. */
export class ControlResponse extends Response {
  private _states: Map<ControlId, unknown> = new Map();

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parse(payload: Uint8Array): void {
    this._states.clear();

    if (payload.length < 6) {
      throw new InvalidResponseError(
        `Control response payload '${Buffer.from(payload).toString("hex")}' is too short.`,
      );
    }

    // Loop through each entry
    // Each entry is 2 byte ID, 1 byte length, N byte value, 1 byte terminator 0xFF
    let remaining = payload;

    while (remaining.length >= 5) {
      // Skip empty states
      const size = remaining[2]!;
      if (size === 0) {
        // Zero length values still are at least 1 byte
        remaining = remaining.subarray(5);
        continue;
      }

      // Unpack 16-bit ID (big-endian)
      const dv = new DataView(
        remaining.buffer,
        remaining.byteOffset,
        remaining.byteLength,
      );
      const rawId = dv.getUint16(0, false); // big-endian

      // Check if this is a known control ID
      const knownIds = new Set(Object.values(CONTROL_ID));
      if (!knownIds.has(rawId as ControlId)) {
        // Unknown control ID — skip
        remaining = remaining.subarray(4 + size);
        continue;
      }

      const controlId = rawId as ControlId;

      // Parse the control value
      try {
        const value = decodeControl(controlId, remaining.subarray(3));
        if (value !== null && value !== undefined) {
          this._states.set(controlId, value);
        }
      } catch {
        // Unsupported control — skip
      }

      // Advance to next entry
      remaining = remaining.subarray(4 + size);
    }
  }

  /**
   * Get a decoded control state by ID.
   *
   * @returns The decoded value, or `null` if the control was not present.
   */
  getControlState(id: ControlId): unknown {
    return this._states.get(id) ?? null;
  }
}
