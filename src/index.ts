/**
 * msmart-ng \u2014 Local control of Midea smart air conditioners.
 *
 * Ported from the Python msmart-ng package.
 * @module
 */

// Core types and constants
export {
  DEVICE_TYPE,
  type DeviceType,
  FRAME_TYPE,
  type FrameType,
  DISCOVERY_MSG,
  DEVICE_INFO_MSG,
  DEFAULT_CLOUD_REGION,
} from "./const.ts";

// Utilities
export { CapabilityManager, getFromValue, getFromName, listValues } from "./utils.ts";

// CRC
export { calculate as calculateCrc8, CRC8_854_TABLE } from "./crc8.ts";

// Frame
export { Frame, InvalidFrameError } from "./frame.ts";

// Security
export { Security } from "./security.ts";

// LAN Protocol
export { Lan, Packet, LanProtocol, LanProtocolV3, ProtocolError, AuthenticationError } from "./lan.ts";

// Cloud API
export { BaseCloud, SmartHomeCloud, NetHomePlusCloud, CloudError, ApiError } from "./cloud.ts";

// Base Device
export { Device } from "./base-device.ts";
export type { Token, Key } from "./base-device.ts";

// Device types
export { AirConditioner, CommercialAirConditioner } from "./device/index.ts";

// AC enums and types
export {
  FAN_SPEED,
  OPERATIONAL_MODE,
  SWING_MODE,
  SWING_ANGLE,
  CASCADE_MODE,
  RATE_SELECT,
  BREEZE_MODE,
  AUX_HEAT_MODE,
  ENERGY_DATA_FORMAT,
  AC_CAPABILITY,
} from "./device/ac/device.ts";

// CC enums and types
export {
  CC_FAN_SPEED,
  CC_OPERATIONAL_MODE,
  CC_SWING_MODE,
  CC_SWING_ANGLE,
  CC_PURIFIER_MODE,
  CC_AUX_HEAT_MODE,
  CC_CAPABILITY,
} from "./device/cc/device.ts";

// Discovery
export { Discover, DiscoverError } from "./discover.ts";
