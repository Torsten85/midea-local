/**
 * Command and response messages for 0xAC (Air Conditioner) devices.
 *
 * Ported from msmart/device/AC/command.py
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

/** Response ID constants identifying the type of AC response. */
export const RESPONSE_ID = {
  PROPERTIES_ACK: 0xb0,
  PROPERTIES: 0xb1,
  CAPABILITIES: 0xb5,
  STATE: 0xc0,
  GROUP_DATA: 0xc1,
} as const;

export type ResponseId = (typeof RESPONSE_ID)[keyof typeof RESPONSE_ID];

/** Capability ID constants for AC capability TLVs. */
export const CAPABILITY_ID = {
  SWING_UD_ANGLE: 0x0009,
  SWING_LR_ANGLE: 0x000a,
  BREEZELESS: 0x0018,
  SMART_EYE: 0x0030,
  WIND_ON_ME: 0x0032,
  WIND_OFF_ME: 0x0033,
  SELF_CLEAN: 0x0039,
  _UNKNOWN: 0x0040,
  BREEZE_AWAY: 0x0042,
  BREEZE_CONTROL: 0x0043,
  RATE_SELECT: 0x0048,
  FRESH_AIR: 0x004b,
  PARENT_CONTROL: 0x0051,
  PREVENT_STRAIGHT_WIND_SELECT: 0x0058,
  CASCADE: 0x0059,
  JET_COOL: 0x0067,
  ICHECK: 0x0091,
  EMERGENT_HEAT_WIND: 0x0093,
  HEAT_PTC_WIND: 0x0094,
  CVP: 0x0098,
  OUT_SILENT: 0x00cd,
  PRESET_IECO: 0x00e3,
  FAN_SPEED_CONTROL: 0x0210,
  PRESET_ECO: 0x0212,
  PRESET_FREEZE_PROTECTION: 0x0213,
  MODES: 0x0214,
  SWING_MODES: 0x0215,
  ENERGY: 0x0216,
  FILTER_REMIND: 0x0217,
  AUX_ELECTRIC_HEAT: 0x0219,
  PRESET_TURBO: 0x021a,
  FILTER_CHECK: 0x0221,
  ANION: 0x021e,
  HUMIDITY: 0x021f,
  FAHRENHEIT: 0x0222,
  DISPLAY_CONTROL: 0x0224,
  TEMPERATURES: 0x0225,
  BUZZER: 0x022c,
  MAIN_HORIZONTAL_GUIDE_STRIP: 0x0230,
  SUP_HORIZONTAL_GUIDE_STRIP: 0x0231,
  TWINS_MACHINE: 0x0232,
  GUIDE_STRIP_TYPE: 0x0233,
  BODY_CHECK: 0x0234,
} as const;

export type CapabilityId = (typeof CAPABILITY_ID)[keyof typeof CAPABILITY_ID];

/** Property ID constants for AC property TLVs. */
export const PROPERTY_ID = {
  SWING_UD_ANGLE: 0x0009,
  SWING_LR_ANGLE: 0x000a,
  INDOOR_HUMIDITY: 0x0015,
  BREEZELESS: 0x0018,
  BUZZER: 0x001a,
  SELF_CLEAN: 0x0039,
  BREEZE_AWAY: 0x0042,
  BREEZE_CONTROL: 0x0043,
  RATE_SELECT: 0x0048,
  FRESH_AIR: 0x004b,
  CASCADE: 0x0059,
  JET_COOL: 0x0067,
  OUT_SILENT: 0x00cd,
  IECO: 0x00e3,
  ANION: 0x021e,
} as const;

export type PropertyId = (typeof PROPERTY_ID)[keyof typeof PROPERTY_ID];

/** Set of supported (tested) property IDs. */
const SUPPORTED_PROPERTY_IDS: ReadonlySet<number> = new Set<number>([
  PROPERTY_ID.BREEZE_AWAY,
  PROPERTY_ID.BREEZE_CONTROL,
  PROPERTY_ID.BREEZELESS,
  PROPERTY_ID.BUZZER,
  PROPERTY_ID.CASCADE,
  PROPERTY_ID.IECO,
  PROPERTY_ID.JET_COOL,
  PROPERTY_ID.OUT_SILENT,
  PROPERTY_ID.RATE_SELECT,
  PROPERTY_ID.SELF_CLEAN,
  PROPERTY_ID.SWING_LR_ANGLE,
  PROPERTY_ID.SWING_UD_ANGLE,
]);

/**
 * Check if a property ID is supported/tested.
 */
function isPropertySupported(id: PropertyId): boolean {
  return SUPPORTED_PROPERTY_IDS.has(id);
}

/**
 * Decode raw property data into a convenient form.
 *
 * @param id   - The property ID.
 * @param data - The raw property data bytes.
 * @returns The decoded value, or `null` for properties that should not be decoded (e.g. buzzer).
 * @throws Error if the property ID is not supported.
 */
export function decodeProperty(id: PropertyId, data: Uint8Array): unknown {
  if (!isPropertySupported(id)) {
    throw new Error(`Property 0x${id.toString(16).padStart(4, "0")} decode is not supported.`);
  }

  if (
    id === PROPERTY_ID.BREEZELESS ||
    id === PROPERTY_ID.JET_COOL ||
    id === PROPERTY_ID.SELF_CLEAN
  ) {
    return Boolean(data[0]);
  } else if (id === PROPERTY_ID.BREEZE_AWAY) {
    return data[0] === 2;
  } else if (id === PROPERTY_ID.BUZZER) {
    return null; // Don't decode buzzer
  } else if (id === PROPERTY_ID.CASCADE) {
    // data[0] - wind_around, data[1] - wind_around_ud
    return data[0] ? data[1]! : 0;
  } else if (id === PROPERTY_ID.IECO) {
    // data[0] - ieco_number, data[1] - ieco_switch
    return Boolean(data[1]);
  } else if (id === PROPERTY_ID.OUT_SILENT) {
    return data[0] === 3;
  } else {
    return data[0]!;
  }
}

/**
 * Encode a property value into raw form.
 *
 * @param id    - The property ID.
 * @param args  - The value(s) to encode.
 * @returns The encoded bytes.
 * @throws Error if the property ID is not supported.
 */
export function encodeProperty(id: PropertyId, ...args: unknown[]): Uint8Array {
  if (!isPropertySupported(id)) {
    throw new Error(`Property 0x${id.toString(16).padStart(4, "0")} encode is not supported.`);
  }

  if (id === PROPERTY_ID.BREEZE_AWAY) {
    return new Uint8Array([args[0] ? 2 : 1]);
  } else if (id === PROPERTY_ID.CASCADE) {
    // data[0] - wind_around, data[1] - wind_around_ud
    const val = args[0] as number;
    return new Uint8Array([val ? 1 : 0, val]);
  } else if (id === PROPERTY_ID.IECO) {
    // ieco_frame, ieco_number, ieco_switch, ...
    const result = new Uint8Array(13);
    result[0] = 0;
    result[1] = 1;
    result[2] = args[0] as number;
    // remaining 10 bytes are zero
    return result;
  } else if (id === PROPERTY_ID.OUT_SILENT) {
    return new Uint8Array([args[0] ? 3 : 0]);
  } else {
    return new Uint8Array([args[0] as number]);
  }
}

/** Temperature type constants for state queries. */
export const TEMPERATURE_TYPE = {
  UNKNOWN: 0,
  INDOOR: 0x02,
  OUTDOOR: 0x03,
} as const;

export type TemperatureType =
  (typeof TEMPERATURE_TYPE)[keyof typeof TEMPERATURE_TYPE];

// ---------------------------------------------------------------------------
// Module-level message ID counter (shared across all AC Command instances)
// ---------------------------------------------------------------------------

let messageId = 0;

function nextMessageId(): number {
  messageId += 1;
  return messageId & 0xff;
}

// ---------------------------------------------------------------------------
// Command classes
// ---------------------------------------------------------------------------

/** Base class for AC commands. */
export class Command extends Frame {
  /** App control source identifier. */
  static readonly CONTROL_SOURCE = 0x02;

  constructor(frameType: FrameType) {
    super(DEVICE_TYPE.AIR_CONDITIONER, frameType);
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

/** Command to query capabilities of the device. */
export class GetCapabilitiesCommand extends Command {
  private readonly _additional: boolean;

  constructor(additional: boolean = false) {
    super(FRAME_TYPE.QUERY);
    this._additional = additional;
  }

  override toBytes(): Uint8Array {
    let payload: Uint8Array;
    if (!this._additional) {
      // Get capabilities
      payload = new Uint8Array([0xb5, 0x01, 0x00]);
    } else {
      // Get more capabilities
      payload = new Uint8Array([0xb5, 0x01, 0x01, 0x01]);
    }
    return super.toBytes(payload);
  }
}

/** Command to query basic state of the device. */
export class GetStateCommand extends Command {
  temperatureType: TemperatureType;

  constructor() {
    super(FRAME_TYPE.QUERY);
    this.temperatureType = TEMPERATURE_TYPE.INDOOR;
  }

  override toBytes(): Uint8Array {
    return super.toBytes(
      new Uint8Array([
        // Get state
        0x41,
        // Unknown
        0x81, 0x00, 0xff, 0x03, 0xff, 0x00,
        // Temperature request
        this.temperatureType,
        // Unknown
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        // Unknown
        0x03,
      ]),
    );
  }
}

/** Command to query energy usage from device. */
export class GetEnergyUsageCommand extends Command {
  constructor() {
    super(FRAME_TYPE.QUERY);
  }

  override toBytes(): Uint8Array {
    const payload = new Uint8Array(20);
    payload[0] = 0x41;
    payload[1] = 0x21;
    payload[2] = 0x01;
    payload[3] = 0x44;
    return super.toBytes(payload);
  }
}

/** Command to query group 5 data from device. */
export class GetGroup5Command extends Command {
  constructor() {
    super(FRAME_TYPE.QUERY);
  }

  override toBytes(): Uint8Array {
    const payload = new Uint8Array(20);
    payload[0] = 0x41;
    payload[1] = 0x21;
    payload[2] = 0x01;
    payload[3] = 0x45;
    return super.toBytes(payload);
  }
}

/** Command to set basic state of the device. */
export class SetStateCommand extends Command {
  beepOn = true;
  powerOn = false;
  targetTemperature = 25.0;
  operationalMode = 0;
  fanSpeed = 0;
  eco = true;
  swingMode = 0;
  turbo = false;
  fahrenheit = true;
  sleep = false;
  freezeProtection = false;
  followMe = false;
  purifier = false;
  targetHumidity = 40;
  auxHeat = false;
  forceAuxHeat = false;
  independentAuxHeat = false;

  constructor() {
    super(FRAME_TYPE.CONTROL);
  }

  override toBytes(): Uint8Array {
    // Build beep and power status bytes
    const beep = this.beepOn ? 0x40 : 0;
    const power = this.powerOn ? 0x01 : 0;

    // Get integer and fraction components of target temp
    const integralTempRaw = Math.trunc(this.targetTemperature);
    const fractionalTemp = this.targetTemperature - integralTempRaw;

    let temperature: number;
    let temperatureAlt: number;

    if (integralTempRaw >= 17 && integralTempRaw <= 30) {
      // Use primary method
      temperature = (integralTempRaw - 16) & 0x0f;
      temperatureAlt = 0;
    } else {
      // Out of range, use alternate method
      temperature = 0;
      temperatureAlt = (integralTempRaw - 12) & 0x1f;
    }

    // Set half degree bit
    temperature |= fractionalTemp > 0 ? 0x10 : 0;

    const mode = (this.operationalMode & 0x07) << 5;

    // Build swing mode byte
    const swingMode = 0x30 | (this.swingMode & 0x3f);

    // Build eco mode, purifier, and aux heat byte
    const eco = this.eco ? 0x80 : 0;
    const purifier = this.purifier ? 0x20 : 0;
    const auxHeat = this.auxHeat ? 0x08 : 0;
    const forceAuxHeat = this.forceAuxHeat ? 0x10 : 0;

    // Build sleep, turbo and fahrenheit byte
    const sleep = this.sleep ? 0x01 : 0;
    const turbo = this.turbo ? 0x02 : 0;
    const fahrenheit = this.fahrenheit ? 0x04 : 0;

    // Build alternate turbo byte
    const turboAlt = this.turbo ? 0x20 : 0;
    const followMe = this.followMe ? 0x80 : 0;

    // Build target humidity byte
    const humidity = this.targetHumidity & 0x7f;

    // Build freeze protection byte
    const freezeProtect = this.freezeProtection ? 0x80 : 0;

    // Build independent aux heat
    const independentAuxHeat = this.independentAuxHeat ? 0x08 : 0;

    return super.toBytes(
      new Uint8Array([
        // Set state
        0x40,
        // Beep and power state
        Command.CONTROL_SOURCE | beep | power,
        // Temperature and operational mode
        temperature | mode,
        // Fan speed
        this.fanSpeed,
        // Timer
        0x7f, 0x7f, 0x00,
        // Swing mode
        swingMode,
        // Follow me and alternate turbo mode
        followMe | turboAlt,
        // ECO mode, purifier/anion, and aux heat
        eco | purifier | forceAuxHeat | auxHeat,
        // Sleep mode, turbo mode and fahrenheit
        sleep | turbo | fahrenheit,
        // Unknown
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00,
        // Alternate temperature
        temperatureAlt,
        // Target humidity
        humidity,
        // Unknown
        0x00,
        // Frost/freeze protection
        freezeProtect,
        // Independent aux heat
        independentAuxHeat,
        // Unknown
        0x00,
      ]),
    );
  }
}

/** Command to toggle the LED display of the device. */
export class ToggleDisplayCommand extends Command {
  beepOn = true;

  constructor() {
    // For whatever reason, toggle display uses a request type...
    super(FRAME_TYPE.QUERY);
  }

  override toBytes(): Uint8Array {
    // Set beep bit
    const beep = this.beepOn ? 0x40 : 0;

    return super.toBytes(
      new Uint8Array([
        // Get state
        0x41,
        // Beep and other flags
        Command.CONTROL_SOURCE | beep,
        // Unknown
        0x00, 0xff, 0x02,
        0x00, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
  }
}

/** Command to query specific properties from the device. */
export class GetPropertiesCommand extends Command {
  private readonly _properties: readonly PropertyId[];

  constructor(props: readonly PropertyId[]) {
    super(FRAME_TYPE.QUERY);
    this._properties = props;
  }

  override toBytes(): Uint8Array {
    const payload = new Uint8Array(2 + this._properties.length * 2);
    payload[0] = 0xb1; // Property request
    payload[1] = this._properties.length;

    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (let i = 0; i < this._properties.length; i++) {
      dv.setUint16(2 + i * 2, this._properties[i]!, true); // little-endian
    }

    return super.toBytes(payload);
  }
}

/** Command to set specific properties of the device. */
export class SetPropertiesCommand extends Command {
  private readonly _properties: ReadonlyMap<PropertyId, number | boolean>;

  constructor(props: ReadonlyMap<PropertyId, number | boolean>) {
    super(FRAME_TYPE.CONTROL);
    this._properties = props;
  }

  override toBytes(): Uint8Array {
    // Calculate total payload size
    const parts: Uint8Array[] = [];
    const header = new Uint8Array([0xb0, this._properties.size]);
    parts.push(header);

    for (const [prop, value] of this._properties) {
      // Property ID (little-endian uint16)
      const idBuf = new Uint8Array(2);
      const idView = new DataView(idBuf.buffer);
      idView.setUint16(0, prop, true);
      parts.push(idBuf);

      // Encode property value to bytes
      const encoded = encodeProperty(prop, value);
      parts.push(new Uint8Array([encoded.length]));
      parts.push(encoded);
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

/** Base class for AC responses. */
export class Response {
  private readonly _id: number;
  private readonly _payload: Uint8Array;

  constructor(payload: Uint8Array) {
    this._id = payload[0]!;
    this._payload = new Uint8Array(payload);
  }

  toString(): string {
    return Buffer.from(this._payload).toString("hex");
  }

  /** The response ID byte. */
  get id(): number {
    return this._id;
  }

  /** Copy of the response payload. */
  get payload(): Uint8Array {
    return this._payload;
  }

  /**
   * Validate a response by checking the payload CRC and/or checksum.
   *
   * Some devices use CRC8, others use the frame checksum. Accept either.
   */
  static validate(payload: Uint8Array): void {
    const body = payload.subarray(0, payload.length - 1);
    const payloadCrc = crc8Calculate(body);
    const payloadChecksum = Frame.checksum(body);
    const received = payload[payload.length - 1]!;
    if (payloadCrc !== received && payloadChecksum !== received) {
      throw new InvalidResponseError(
        `Payload '${Buffer.from(payload).toString("hex")}' failed CRC and checksum. ` +
          `Received: 0x${received.toString(16).toUpperCase()}, ` +
          `Expected: 0x${payloadCrc.toString(16).toUpperCase()} or ` +
          `0x${payloadChecksum.toString(16).toUpperCase()}.`,
      );
    }
  }

  /**
   * Construct a response object from a raw frame.
   *
   * Validates the frame, determines the response type from the response ID
   * byte, validates the payload CRC, and returns the appropriate response
   * subclass instance.
   */
  static construct(frame: Uint8Array): Response {
    // Validate the frame
    Frame.validate(frame, DEVICE_TYPE.AIR_CONDITIONER);

    // Determine response class from ID
    let ResponseClass: new (payload: Uint8Array) => Response = Response;

    const frameType = frame[9]!;
    const responseId = frame[10]!;

    if (responseId === RESPONSE_ID.STATE) {
      ResponseClass = StateResponse;
    } else if (
      responseId === RESPONSE_ID.CAPABILITIES &&
      frameType === FRAME_TYPE.QUERY
    ) {
      // Some devices have unsolicited "capabilities" responses with a frame type of 0x5
      ResponseClass = CapabilitiesResponse;
    } else if (
      responseId === RESPONSE_ID.PROPERTIES ||
      responseId === RESPONSE_ID.PROPERTIES_ACK
    ) {
      ResponseClass = PropertiesResponse;
    } else if (responseId === RESPONSE_ID.GROUP_DATA) {
      // Response type depends on an additional "group" byte
      const group = frame[13]! & 0x0f;
      if (group === 4) {
        ResponseClass = EnergyUsageResponse;
      } else if (group === 5) {
        ResponseClass = Group5Response;
      }
    }

    // Validate the payload CRC
    // ...except for properties which certain devices send invalid CRCs
    if (ResponseClass !== PropertiesResponse) {
      Response.validate(frame.subarray(10, frame.length - 1));
    }

    // Build the response (payload is frame[10 .. -2])
    return new ResponseClass(frame.subarray(10, frame.length - 2));
  }
}

// ---------------------------------------------------------------------------
// Capability decoder helpers
// ---------------------------------------------------------------------------

interface CapabilityReader {
  name: string;
  read: (v: number) => boolean;
}

function getValue(w: number): (v: number) => boolean {
  return (v: number) => v === w;
}

/** Map of capability ID → reader(s). */
const CAPABILITY_READERS: ReadonlyMap<
  number,
  CapabilityReader | CapabilityReader[]
> = new Map<number, CapabilityReader | CapabilityReader[]>([
  [CAPABILITY_ID.ANION, { name: "anion", read: getValue(1) }],
  [CAPABILITY_ID.AUX_ELECTRIC_HEAT, { name: "aux_electric_heat", read: getValue(1) }],
  [CAPABILITY_ID.BREEZE_AWAY, { name: "breeze_away", read: getValue(1) }],
  [CAPABILITY_ID.BREEZE_CONTROL, { name: "breeze_control", read: getValue(1) }],
  [CAPABILITY_ID.BREEZELESS, { name: "breezeless", read: getValue(1) }],
  [CAPABILITY_ID.BUZZER, { name: "buzzer", read: getValue(1) }],
  [CAPABILITY_ID.CASCADE, { name: "cascade", read: getValue(1) }],
  [
    CAPABILITY_ID.DISPLAY_CONTROL,
    { name: "display_control", read: (v) => [1, 2, 100].includes(v) },
  ],
  [
    CAPABILITY_ID.ENERGY,
    [
      { name: "energy_stats", read: (v) => [2, 3, 4, 5].includes(v) },
      { name: "energy_setting", read: (v) => [3, 5].includes(v) },
      { name: "energy_bcd", read: (v) => [2, 3].includes(v) },
    ],
  ],
  [CAPABILITY_ID.FAHRENHEIT, { name: "fahrenheit", read: getValue(0) }],
  [
    CAPABILITY_ID.FAN_SPEED_CONTROL,
    [
      { name: "fan_silent", read: getValue(6) },
      { name: "fan_low", read: (v) => [3, 4, 5, 6, 7].includes(v) },
      { name: "fan_medium", read: (v) => [5, 6, 7].includes(v) },
      { name: "fan_high", read: (v) => [3, 4, 5, 6, 7].includes(v) },
      { name: "fan_auto", read: (v) => [4, 5, 6].includes(v) },
      { name: "fan_custom", read: getValue(1) },
    ],
  ],
  [
    CAPABILITY_ID.FILTER_REMIND,
    [
      { name: "filter_notice", read: (v) => [1, 2, 4].includes(v) },
      { name: "filter_clean", read: (v) => [3, 4].includes(v) },
    ],
  ],
  [
    CAPABILITY_ID.HUMIDITY,
    [
      { name: "humidity_auto_set", read: (v) => [1, 2].includes(v) },
      { name: "humidity_manual_set", read: (v) => [2, 3].includes(v) },
    ],
  ],
  [CAPABILITY_ID.JET_COOL, { name: "jet_cool", read: getValue(1) }],
  [
    CAPABILITY_ID.MODES,
    [
      {
        name: "heat_mode",
        read: (v) => [1, 2, 4, 6, 7, 9, 10, 11, 12, 13].includes(v),
      },
      { name: "cool_mode", read: (v) => ![2, 10, 12].includes(v) },
      { name: "dry_mode", read: (v) => [0, 1, 5, 6, 9, 11, 13].includes(v) },
      {
        name: "auto_mode",
        read: (v) => [0, 1, 2, 7, 8, 9, 13].includes(v),
      },
      { name: "aux_heat_mode", read: (v) => v === 9 },
      { name: "aux_mode", read: (v) => [9, 10, 11, 13].includes(v) },
    ],
  ],
  [
    CAPABILITY_ID.OUT_SILENT,
    { name: "out_silent", read: (v) => [1, 3].includes(v) },
  ],
  [
    CAPABILITY_ID.PRESET_ECO,
    { name: "eco", read: (v) => [1, 2].includes(v) },
  ],
  [
    CAPABILITY_ID.PRESET_FREEZE_PROTECTION,
    { name: "freeze_protection", read: getValue(1) },
  ],
  [CAPABILITY_ID.PRESET_IECO, { name: "ieco", read: getValue(1) }],
  [
    CAPABILITY_ID.PRESET_TURBO,
    [
      { name: "turbo_heat", read: (v) => [1, 3].includes(v) },
      { name: "turbo_cool", read: (v) => v < 2 },
    ],
  ],
  [
    CAPABILITY_ID.RATE_SELECT,
    [
      { name: "rate_select_2_level", read: getValue(1) },
      { name: "rate_select_5_level", read: (v) => [2, 3].includes(v) },
    ],
  ],
  [CAPABILITY_ID.SELF_CLEAN, { name: "self_clean", read: getValue(1) }],
  [CAPABILITY_ID.SMART_EYE, { name: "smart_eye", read: getValue(1) }],
  [
    CAPABILITY_ID.SWING_LR_ANGLE,
    { name: "swing_horizontal_angle", read: getValue(1) },
  ],
  [
    CAPABILITY_ID.SWING_UD_ANGLE,
    { name: "swing_vertical_angle", read: getValue(1) },
  ],
  [
    CAPABILITY_ID.SWING_MODES,
    [
      { name: "swing_horizontal", read: (v) => [1, 3].includes(v) },
      { name: "swing_vertical", read: (v) => v < 2 },
    ],
  ],
  // TEMPERATURES handled separately
  [CAPABILITY_ID.WIND_OFF_ME, { name: "wind_off_me", read: getValue(1) }],
  [CAPABILITY_ID.WIND_ON_ME, { name: "wind_on_me", read: getValue(1) }],
]);

// ---------------------------------------------------------------------------
// CapabilitiesResponse
// ---------------------------------------------------------------------------

/** Response to capabilities query. */
export class CapabilitiesResponse extends Response {
  private _capabilities: Map<string, unknown> = new Map();
  private _additionalCapabilities = false;

  constructor(payload: Uint8Array) {
    super(payload);
    this._parseCapabilities(payload);
  }

  /** Raw capabilities map. */
  get rawCapabilities(): ReadonlyMap<string, unknown> {
    return this._capabilities;
  }

  private _parseCapabilities(payload: Uint8Array): void {
    this._capabilities.clear();

    const count = payload[1]!;
    let caps = payload.subarray(2);

    for (let i = 0; i < count; i++) {
      // Stop if out of data
      if (caps.length < 3) break;

      // Skip empty capabilities
      const size = caps[2]!;
      if (size === 0) {
        caps = caps.subarray(3);
        continue;
      }

      // Unpack 16-bit ID (little-endian)
      const dv = new DataView(caps.buffer, caps.byteOffset, caps.byteLength);
      const rawId = dv.getUint16(0, true);

      // Check if this is a known capability ID
      const knownIds = new Set(Object.values(CAPABILITY_ID));
      if (!knownIds.has(rawId as CapabilityId)) {
        // Unknown capability ID — skip
        caps = caps.subarray(3 + size);
        continue;
      }

      const capabilityId = rawId as CapabilityId;

      // Fetch first cap value
      const value = caps[3]!;

      // Apply predefined capability reader if it exists
      const reader = CAPABILITY_READERS.get(capabilityId);
      if (reader !== undefined) {
        if (Array.isArray(reader)) {
          for (const r of reader) {
            this._capabilities.set(r.name, r.read(value));
          }
        } else {
          this._capabilities.set(reader.name, reader.read(value));
        }
      } else if (capabilityId === CAPABILITY_ID.TEMPERATURES) {
        // Skip if capability size is too small
        if (size >= 6) {
          this._capabilities.set("cool_min_temperature", caps[3]! * 0.5);
          this._capabilities.set("cool_max_temperature", caps[4]! * 0.5);
          this._capabilities.set("auto_min_temperature", caps[5]! * 0.5);
          this._capabilities.set("auto_max_temperature", caps[6]! * 0.5);
          this._capabilities.set("heat_min_temperature", caps[7]! * 0.5);
          this._capabilities.set("heat_max_temperature", caps[8]! * 0.5);

          this._capabilities.set(
            "decimals",
            (size > 6 ? caps[9]! : caps[2]!) !== 0,
          );
        }
      } else if (capabilityId === CAPABILITY_ID._UNKNOWN) {
        // Suppress warnings from unknown capability
      }
      // else: unsupported capability, silently skip

      // Advance to next capability
      caps = caps.subarray(3 + size);
    }

    // Check if there are additional capabilities
    if (caps.length > 1) {
      this._additionalCapabilities = Boolean(caps[caps.length - 2]);
    }
  }

  private _getFanSpeed(speed: string): boolean {
    // If any fan_ capability was received, check against them
    const hasFanCap = [...this._capabilities.keys()].some((k) =>
      k.startsWith("fan_"),
    );
    if (hasFanCap) {
      // Assume that a fan capable of custom speeds is capable of any speed
      return (
        (this._capabilities.get(`fan_${speed}`) as boolean) ||
        (this._capabilities.get("fan_custom") as boolean) ||
        false
      );
    }

    // Otherwise return a default set for devices that don't send the capability
    return ["low", "medium", "high", "auto"].includes(speed);
  }

  /** Merge another CapabilitiesResponse's capabilities into this one. */
  merge(other: CapabilitiesResponse): void {
    for (const [k, v] of other._capabilities) {
      this._capabilities.set(k, v);
    }
  }

  /** Whether there are additional capabilities to query. */
  get additionalCapabilities(): boolean {
    return this._additionalCapabilities;
  }

  get anion(): boolean {
    return (this._capabilities.get("anion") as boolean) ?? false;
  }

  get fanSilent(): boolean {
    return this._getFanSpeed("silent");
  }

  get fanLow(): boolean {
    return this._getFanSpeed("low");
  }

  get fanMedium(): boolean {
    return this._getFanSpeed("medium");
  }

  get fanHigh(): boolean {
    return this._getFanSpeed("high");
  }

  get fanAuto(): boolean {
    return this._getFanSpeed("auto");
  }

  get fanCustom(): boolean {
    return (this._capabilities.get("fan_custom") as boolean) ?? false;
  }

  get breezeAway(): boolean {
    return (this._capabilities.get("breeze_away") as boolean) ?? false;
  }

  get breezeControl(): boolean {
    return (this._capabilities.get("breeze_control") as boolean) ?? false;
  }

  get breezeless(): boolean {
    return (this._capabilities.get("breezeless") as boolean) ?? false;
  }

  get cascade(): boolean {
    return (this._capabilities.get("cascade") as boolean) ?? false;
  }

  get swingHorizontalAngle(): boolean {
    return (this._capabilities.get("swing_horizontal_angle") as boolean) ?? false;
  }

  get swingVerticalAngle(): boolean {
    return (this._capabilities.get("swing_vertical_angle") as boolean) ?? false;
  }

  get swingHorizontal(): boolean {
    return (this._capabilities.get("swing_horizontal") as boolean) ?? false;
  }

  get swingVertical(): boolean {
    return (this._capabilities.get("swing_vertical") as boolean) ?? false;
  }

  get swingBoth(): boolean {
    return this.swingVertical && this.swingHorizontal;
  }

  get dryMode(): boolean {
    return (this._capabilities.get("dry_mode") as boolean) ?? false;
  }

  get coolMode(): boolean {
    return (this._capabilities.get("cool_mode") as boolean) ?? false;
  }

  get heatMode(): boolean {
    return (this._capabilities.get("heat_mode") as boolean) ?? false;
  }

  get autoMode(): boolean {
    return (this._capabilities.get("auto_mode") as boolean) ?? false;
  }

  get auxHeatMode(): boolean {
    return (this._capabilities.get("aux_heat_mode") as boolean) ?? false;
  }

  get auxMode(): boolean {
    return (this._capabilities.get("aux_mode") as boolean) ?? false;
  }

  get auxElectricHeat(): boolean {
    return (this._capabilities.get("aux_electric_heat") as boolean) ?? false;
  }

  get eco(): boolean {
    return (this._capabilities.get("eco") as boolean) ?? false;
  }

  get ieco(): boolean {
    return (this._capabilities.get("ieco") as boolean) ?? false;
  }

  get jetCool(): boolean {
    return (this._capabilities.get("jet_cool") as boolean) ?? false;
  }

  get turbo(): boolean {
    return (
      ((this._capabilities.get("turbo_heat") as boolean) ?? false) ||
      ((this._capabilities.get("turbo_cool") as boolean) ?? false)
    );
  }

  get freezeProtection(): boolean {
    return (this._capabilities.get("freeze_protection") as boolean) ?? false;
  }

  get displayControl(): boolean {
    return (this._capabilities.get("display_control") as boolean) ?? false;
  }

  get filterReminder(): boolean {
    return (this._capabilities.get("filter_notice") as boolean) ?? false;
  }

  get minTemperature(): number {
    const modes = ["cool", "auto", "heat"];
    return Math.min(
      ...modes.map(
        (m) => (this._capabilities.get(`${m}_min_temperature`) as number) ?? 16,
      ),
    );
  }

  get maxTemperature(): number {
    const modes = ["cool", "auto", "heat"];
    return Math.max(
      ...modes.map(
        (m) => (this._capabilities.get(`${m}_max_temperature`) as number) ?? 30,
      ),
    );
  }

  get energyStats(): boolean {
    return (this._capabilities.get("energy_stats") as boolean) ?? false;
  }

  get humidity(): boolean {
    return (
      ((this._capabilities.get("humidity_auto_set") as boolean) ?? false) ||
      ((this._capabilities.get("humidity_manual_set") as boolean) ?? false)
    );
  }

  get targetHumidity(): boolean {
    return (this._capabilities.get("humidity_manual_set") as boolean) ?? false;
  }

  get selfClean(): boolean {
    return (this._capabilities.get("self_clean") as boolean) ?? false;
  }

  get rateSelectLevels(): number | null {
    if ((this._capabilities.get("rate_select_5_level") as boolean) ?? false) {
      return 5;
    } else if (
      (this._capabilities.get("rate_select_2_level") as boolean) ?? false
    ) {
      return 2;
    }
    return null;
  }

  get outSilent(): boolean {
    return (this._capabilities.get("out_silent") as boolean) ?? false;
  }
}

// ---------------------------------------------------------------------------
// StateResponse
// ---------------------------------------------------------------------------

/** Response to state query. */
export class StateResponse extends Response {
  powerOn: boolean | null = null;
  targetTemperature: number | null = null;
  operationalMode: number | null = null;
  fanSpeed: number | null = null;
  swingMode: number | null = null;
  turbo: boolean | null = null;
  eco: boolean | null = null;
  sleep: boolean | null = null;
  fahrenheit: boolean | null = null;
  indoorTemperature: number | null = null;
  outdoorTemperature: number | null = null;
  filterAlert: boolean | null = null;
  displayOn: boolean | null = null;
  freezeProtection: boolean | null = null;
  followMe: boolean | null = null;
  purifier: boolean | null = null;
  targetHumidity: number | null = null;
  auxHeat: boolean | null = null;
  independentAuxHeat: boolean | null = null;
  errorCode: number | null = null;

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parseTemperature(
    data: number,
    decimals: number,
    fahrenheit: boolean,
  ): number | null {
    if (data === 0xff) return null;

    // Temperature parsing lifted from https://github.com/dudanov/MideaUART
    const temperature = (data - 50) / 2;

    // In Celsius, use additional precision from decimals if present
    if (!fahrenheit && decimals) {
      return (
        Math.trunc(temperature) + (temperature >= 0 ? decimals : -decimals)
      );
    }

    if (decimals >= 0.5) {
      return Math.trunc(temperature) + (temperature >= 0 ? 0.5 : -0.5);
    }

    return temperature;
  }

  private _parse(payload: Uint8Array): void {
    this.powerOn = Boolean(payload[1]! & 0x01);

    // Unpack target temp and mode byte
    this.targetTemperature = (payload[2]! & 0x0f) + 16.0;
    this.targetTemperature += payload[2]! & 0x10 ? 0.5 : 0.0;
    this.operationalMode = (payload[2]! >> 5) & 0x07;

    // Fan speed
    this.fanSpeed = payload[3]! & 0x7f;

    // Swing mode
    this.swingMode = payload[7]! & 0x0f;

    this.turbo = Boolean(payload[8]! & 0x20);
    this.independentAuxHeat = Boolean(payload[8]! & 0x40);
    this.followMe = Boolean(payload[8]! & 0x80);

    this.eco = Boolean(payload[9]! & 0x10);
    this.purifier = Boolean(payload[9]! & 0x20);
    this.auxHeat = Boolean(payload[9]! & 0x08);

    this.sleep = Boolean(payload[10]! & 0x01);
    this.turbo = this.turbo || Boolean(payload[10]! & 0x02);
    this.fahrenheit = Boolean(payload[10]! & 0x04);

    // Decode temperatures using additional precision bits
    this.indoorTemperature = this._parseTemperature(
      payload[11]!,
      (payload[15]! & 0x0f) / 10,
      this.fahrenheit,
    );
    this.outdoorTemperature = this._parseTemperature(
      payload[12]!,
      (payload[15]! >> 4) / 10,
      this.fahrenheit,
    );

    // Decode alternate target temperature
    const targetTemperatureAlt = payload[13]! & 0x1f;
    if (targetTemperatureAlt !== 0) {
      this.targetTemperature = targetTemperatureAlt + 12;
      this.targetTemperature += payload[2]! & 0x10 ? 0.5 : 0.0;
    }

    this.filterAlert = Boolean(payload[13]! & 0x20);

    this.displayOn = payload[14] !== 0x70;

    this.errorCode = payload[16]!;

    if (payload.length < 20) return;

    this.targetHumidity = payload[19]! & 0x7f;

    if (payload.length < 22) return;

    this.freezeProtection = Boolean(payload[21]! & 0x80);
  }
}

// ---------------------------------------------------------------------------
// PropertiesResponse
// ---------------------------------------------------------------------------

/** Response to properties query. */
export class PropertiesResponse extends Response {
  private _properties: Map<PropertyId, unknown> = new Map();

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parse(payload: Uint8Array): void {
    this._properties.clear();

    const count = payload[1]!;
    let props = payload.subarray(2);

    for (let i = 0; i < count; i++) {
      // Stop if out of data
      if (props.length < 4) break;

      // Skip empty properties
      const size = props[3]!;
      if (size === 0) {
        props = props.subarray(4);
        continue;
      }

      // Unpack 16-bit ID (little-endian)
      const dv = new DataView(props.buffer, props.byteOffset, props.byteLength);
      const rawId = dv.getUint16(0, true);

      // Check if this is a known property ID
      const knownIds = new Set(Object.values(PROPERTY_ID));
      if (!knownIds.has(rawId as PropertyId)) {
        // Unknown property ID — skip
        props = props.subarray(4 + size);
        continue;
      }

      const propertyId = rawId as PropertyId;

      // Check execution result and log any errors
      const error = props[2]! & 0x10;
      if (error) {
        // Property failed — skip silently in TS port (Python logs error)
      }

      // Parse the property
      try {
        const value = decodeProperty(propertyId, props.subarray(4));
        if (value !== null) {
          this._properties.set(propertyId, value);
        }
      } catch {
        // Unsupported property — skip
      }

      // Advance to next property
      props = props.subarray(4 + size);
    }
  }

  /**
   * Get a decoded property value by ID.
   *
   * @returns The decoded value, or `null` if the property was not present.
   */
  getProperty(id: PropertyId): unknown {
    return this._properties.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// EnergyUsageResponse
// ---------------------------------------------------------------------------

/** Response to a {@link GetEnergyUsageCommand}. */
export class EnergyUsageResponse extends Response {
  totalEnergy: number | null = null;
  currentEnergy: number | null = null;
  realTimePower: number | null = null;

  totalEnergyBinary: number | null = null;
  currentEnergyBinary: number | null = null;
  realTimePowerBinary: number | null = null;

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parse(payload: Uint8Array): void {
    function decodeBcd(d: number): number {
      return 10 * (d >> 4) + (d & 0x0f);
    }

    function parseEnergy(d: Uint8Array): [number, number] {
      const bcd =
        10000 * decodeBcd(d[0]!) +
        100 * decodeBcd(d[1]!) +
        1 * decodeBcd(d[2]!) +
        0.01 * decodeBcd(d[3]!);
      const binary =
        ((d[0]! << 24) + (d[1]! << 16) + (d[2]! << 8) + d[3]!) / 10;
      return [bcd, binary];
    }

    function parsePower(d: Uint8Array): [number, number] {
      const bcd =
        1000 * decodeBcd(d[0]!) +
        10 * decodeBcd(d[1]!) +
        0.1 * decodeBcd(d[2]!);
      const binary = ((d[0]! << 16) + (d[1]! << 8) + d[2]!) / 10;
      return [bcd, binary];
    }

    // Total energy in bytes 4-7
    const [totalEnergyBcd, totalEnergyBinary] = parseEnergy(
      payload.subarray(4, 8),
    );

    // Current run energy consumption bytes 12-15
    const [currentEnergyBcd, currentEnergyBinary] = parseEnergy(
      payload.subarray(12, 16),
    );

    // Real time power usage bytes 16-18
    const [realTimePowerBcd, realTimePowerBinary] = parsePower(
      payload.subarray(16, 19),
    );

    // Assume energy monitoring is valid if at least one stat is non-zero
    const valid = totalEnergyBcd || currentEnergyBcd || realTimePowerBcd;

    this.totalEnergy = valid ? totalEnergyBcd : null;
    this.currentEnergy = valid ? currentEnergyBcd : null;
    this.realTimePower = valid ? realTimePowerBcd : null;

    this.totalEnergyBinary = valid ? totalEnergyBinary : null;
    this.currentEnergyBinary = valid ? currentEnergyBinary : null;
    this.realTimePowerBinary = valid ? realTimePowerBinary : null;
  }
}

// ---------------------------------------------------------------------------
// Group5Response
// ---------------------------------------------------------------------------

/** Group 5 response with humidity, defrost and more. */
export class Group5Response extends Response {
  humidity: number | null = null;
  defrost: boolean | null = null;
  outdoorFanSpeed: number | null = null;

  constructor(payload: Uint8Array) {
    super(payload);
    this._parse(payload);
  }

  private _parse(payload: Uint8Array): void {
    this.humidity = payload[4] !== 0 ? payload[4]! : null;
    this.outdoorFanSpeed = 8 * payload[8]!;
    this.defrost = Boolean(payload[10]);
  }
}
