/**
 * AirConditioner device class for 0xAC (Air Conditioner) devices.
 *
 * Ported from msmart/device/AC/device.py
 * @module
 */

import { Device } from "../../base-device.ts";
import type { Token, Key } from "../../base-device.ts";
import { DEVICE_TYPE } from "../../const.ts";
import { InvalidFrameError } from "../../frame.ts";
import { CapabilityManager, getFromValue, listValues } from "../../utils.ts";
import {
  CapabilitiesResponse,
  Command,
  EnergyUsageResponse,
  GetCapabilitiesCommand,
  GetEnergyUsageCommand,
  GetGroup5Command,
  GetPropertiesCommand,
  GetStateCommand,
  Group5Response,
  InvalidResponseError,
  PROPERTY_ID,
  PropertiesResponse,
  Response,
  SetPropertiesCommand,
  SetStateCommand,
  StateResponse,
  ToggleDisplayCommand,
} from "./command.ts";
import type { PropertyId } from "./command.ts";

// ---------------------------------------------------------------------------
// Const objects & derived union types
// ---------------------------------------------------------------------------

/** Fan speed constants for AirConditioner devices. */
export const FAN_SPEED = {
  AUTO: 102,
  MAX: 100,
  HIGH: 80,
  MEDIUM: 60,
  LOW: 40,
  SILENT: 20,
} as const;

export type FanSpeed = (typeof FAN_SPEED)[keyof typeof FAN_SPEED];

/** Default fan speed value. */
const FAN_SPEED_DEFAULT: FanSpeed = FAN_SPEED.AUTO;

/** Operational mode constants. */
export const OPERATIONAL_MODE = {
  AUTO: 1,
  COOL: 2,
  DRY: 3,
  HEAT: 4,
  FAN_ONLY: 5,
  SMART_DRY: 6,
} as const;

export type OperationalMode =
  (typeof OPERATIONAL_MODE)[keyof typeof OPERATIONAL_MODE];

/** Default operational mode. */
const OPERATIONAL_MODE_DEFAULT: OperationalMode = OPERATIONAL_MODE.FAN_ONLY;

/** Swing mode constants. */
export const SWING_MODE = {
  OFF: 0x0,
  VERTICAL: 0xc,
  HORIZONTAL: 0x3,
  BOTH: 0xf,
} as const;

export type SwingMode = (typeof SWING_MODE)[keyof typeof SWING_MODE];

/** Default swing mode. */
const SWING_MODE_DEFAULT: SwingMode = SWING_MODE.OFF;

/** Swing angle constants. */
export const SWING_ANGLE = {
  OFF: 0,
  POS_1: 1,
  POS_2: 25,
  POS_3: 50,
  POS_4: 75,
  POS_5: 100,
} as const;

export type SwingAngle = (typeof SWING_ANGLE)[keyof typeof SWING_ANGLE];

/** Default swing angle. */
const SWING_ANGLE_DEFAULT: SwingAngle = SWING_ANGLE.OFF;

/** Cascade mode constants. */
export const CASCADE_MODE = {
  OFF: 0,
  UP: 1,
  DOWN: 2,
} as const;

export type CascadeMode = (typeof CASCADE_MODE)[keyof typeof CASCADE_MODE];

/** Default cascade mode. */
const CASCADE_MODE_DEFAULT: CascadeMode = CASCADE_MODE.OFF;

/** Rate select constants. */
export const RATE_SELECT = {
  OFF: 100,
  GEAR_50: 50,
  GEAR_75: 75,
  LEVEL_1: 1,
  LEVEL_2: 20,
  LEVEL_3: 40,
  LEVEL_4: 60,
  LEVEL_5: 80,
} as const;

export type RateSelect = (typeof RATE_SELECT)[keyof typeof RATE_SELECT];

/** Default rate select. */
const RATE_SELECT_DEFAULT: RateSelect = RATE_SELECT.OFF;

/** Breeze mode constants. */
export const BREEZE_MODE = {
  OFF: 1,
  BREEZE_AWAY: 2,
  BREEZE_MILD: 3,
  BREEZELESS: 4,
} as const;

export type BreezeMode = (typeof BREEZE_MODE)[keyof typeof BREEZE_MODE];

/** Default breeze mode. */
const BREEZE_MODE_DEFAULT: BreezeMode = BREEZE_MODE.OFF;

/** Auxiliary heating mode constants. */
export const AUX_HEAT_MODE = {
  OFF: 0,
  AUX_HEAT: 1,
  AUX_ONLY: 2,
} as const;

export type AuxHeatMode = (typeof AUX_HEAT_MODE)[keyof typeof AUX_HEAT_MODE];

/** Default aux heat mode. */
const AUX_HEAT_MODE_DEFAULT: AuxHeatMode = AUX_HEAT_MODE.OFF;

/** Energy data format constants. */
export const ENERGY_DATA_FORMAT = {
  BCD: 0,
  BINARY: 1,
} as const;

export type EnergyDataFormat =
  (typeof ENERGY_DATA_FORMAT)[keyof typeof ENERGY_DATA_FORMAT];

// ---------------------------------------------------------------------------
// AC_CAPABILITY — Bitmask flags
// ---------------------------------------------------------------------------

/** Bitmask capability flags for AirConditioner features. */
export const AC_CAPABILITY = {
  CUSTOM_FAN_SPEED: 1 << 0,
  ECO: 1 << 1,
  FREEZE_PROTECTION: 1 << 2,
  IECO: 1 << 3,
  TURBO: 1 << 4,
  DISPLAY_CONTROL: 1 << 5,
  ENERGY_STATS: 1 << 6,
  FILTER_REMINDER: 1 << 7,
  HUMIDITY: 1 << 8,
  TARGET_HUMIDITY: 1 << 9,
  SWING_HORIZONTAL_ANGLE: 1 << 10,
  SWING_VERTICAL_ANGLE: 1 << 11,
  BREEZE_AWAY: 1 << 12,
  BREEZE_CONTROL: 1 << 13,
  BREEZELESS: 1 << 14,
  CASCADE: 1 << 15,
  JET_COOL: 1 << 16,
  OUT_SILENT: 1 << 17,
  PURIFIER: 1 << 18,
  SELF_CLEAN: 1 << 19,
} as const;

export type AcCapability = (typeof AC_CAPABILITY)[keyof typeof AC_CAPABILITY];

/** Default capabilities for devices that don't report them. */
const AC_CAPABILITY_DEFAULT =
  AC_CAPABILITY.CUSTOM_FAN_SPEED |
  AC_CAPABILITY.ECO |
  AC_CAPABILITY.TURBO |
  AC_CAPABILITY.FREEZE_PROTECTION |
  AC_CAPABILITY.DISPLAY_CONTROL |
  AC_CAPABILITY.FILTER_REMINDER |
  AC_CAPABILITY.PURIFIER;

// ---------------------------------------------------------------------------
// Energy usage storage
// ---------------------------------------------------------------------------

interface EnergyUsageData {
  [ENERGY_DATA_FORMAT.BCD]: number | null;
  [ENERGY_DATA_FORMAT.BINARY]: number | null;
}

// ---------------------------------------------------------------------------
// Helper: return value or default if null/undefined
// ---------------------------------------------------------------------------

function orDefault<T>(v: T | null | undefined, d: T): T {
  return v != null ? v : d;
}

// ---------------------------------------------------------------------------
// AirConditioner class
// ---------------------------------------------------------------------------

/**
 * Midea Air Conditioner device (type 0xAC).
 *
 * Manages device state, capabilities, and communication for AC units.
 */
export class AirConditioner extends Device {
  // ---- Property map: maps PropertyId to a function that returns the current value ----
  private static readonly _PROPERTY_MAP = new Map<
    PropertyId,
    (self: AirConditioner) => number | boolean
  >([
    [PROPERTY_ID.BREEZE_AWAY, (s) => s._breezeMode === BREEZE_MODE.BREEZE_AWAY],
    [PROPERTY_ID.BREEZE_CONTROL, (s) => s._breezeMode as number],
    [PROPERTY_ID.BREEZELESS, (s) => s._breezeMode === BREEZE_MODE.BREEZELESS],
    [PROPERTY_ID.CASCADE, (s) => s._cascadeMode as number],
    [PROPERTY_ID.IECO, (s) => s._ieco as unknown as number],
    [PROPERTY_ID.JET_COOL, (s) => s._flashCool as unknown as number],
    [PROPERTY_ID.OUT_SILENT, (s) => s._outSilent as unknown as number],
    [PROPERTY_ID.RATE_SELECT, (s) => s._rateSelect as number],
    [PROPERTY_ID.SWING_LR_ANGLE, (s) => s._horizontalSwingAngle as number],
    [PROPERTY_ID.SWING_UD_ANGLE, (s) => s._verticalSwingAngle as number],
  ]);

  // ---- Supported capability overrides ----
  protected static override readonly _SUPPORTED_CAPABILITY_OVERRIDES: Record<
    string,
    [string, string]
  > = {
    min_target_temperature: ["_minTargetTemperature", "float"],
    max_target_temperature: ["_maxTargetTemperature", "float"],
    supported_modes: ["_supportedOpModes", "OperationalMode"],
    supported_swing_modes: ["_supportedSwingModes", "SwingMode"],
    supported_fan_speeds: ["_supportedFanSpeeds", "FanSpeed"],
    supported_aux_modes: ["_supportedAuxModes", "AuxHeatMode"],
    supported_rate_selects: ["_supportedRateSelects", "RateSelect"],
    additional_capabilities: ["_capabilities", "Capability"],
  };

  // ---- Basic controls ----
  private _beepOn = false;
  private _powerState: boolean | null = false;
  private _targetTemperature: number | null = 17.0;
  private _targetHumidity: number | null = 40;

  private _operationalMode: OperationalMode = OPERATIONAL_MODE.AUTO;
  private _fanSpeed: FanSpeed | number = FAN_SPEED.AUTO;
  private _swingMode: SwingMode = SWING_MODE.OFF;

  private _eco: boolean | null = false;
  private _turbo: boolean | null = false;
  private _freezeProtection: boolean | null = false;
  private _sleep: boolean | null = false;

  private _fahrenheitUnit: boolean | null = false;
  private _displayOn: boolean | null = false;

  // ---- Advanced controls ----
  private _followMe: boolean | null = false;
  private _purifier: boolean | null = false;
  private _ieco: boolean | null = false;
  private _flashCool: boolean | null = false;
  private _outSilent: boolean | null = false;

  private _horizontalSwingAngle: SwingAngle = SWING_ANGLE.OFF;
  private _verticalSwingAngle: SwingAngle = SWING_ANGLE.OFF;
  private _cascadeMode: CascadeMode = CASCADE_MODE.OFF;
  private _rateSelect: RateSelect = RATE_SELECT.OFF;
  private _breezeMode: BreezeMode = BREEZE_MODE.OFF;
  private _auxMode: AuxHeatMode = AUX_HEAT_MODE.OFF;

  // ---- Sensors ----
  private _indoorTemperature: number | null = null;
  private _indoorHumidity: number | null = null;
  private _outdoorTemperature: number | null = null;

  private _filterAlert: boolean | null = null;
  private _errorCode: number | null = null;
  private _selfCleanActive: boolean | null = null;
  private _defrostActive: boolean | null = null;
  private _outdoorFanSpeed: number | null = null;

  // ---- Energy usage ----
  private _totalEnergyUsage: EnergyUsageData = {
    [ENERGY_DATA_FORMAT.BCD]: null,
    [ENERGY_DATA_FORMAT.BINARY]: null,
  };
  private _currentEnergyUsage: EnergyUsageData = {
    [ENERGY_DATA_FORMAT.BCD]: null,
    [ENERGY_DATA_FORMAT.BINARY]: null,
  };
  private _realTimePowerUsage: EnergyUsageData = {
    [ENERGY_DATA_FORMAT.BCD]: null,
    [ENERGY_DATA_FORMAT.BINARY]: null,
  };

  // ---- Capabilities ----
  private _minTargetTemperature = 16;
  private _maxTargetTemperature = 30;

  private _capabilities = new CapabilityManager<number>(AC_CAPABILITY_DEFAULT);

  private _supportedOpModes: OperationalMode[] = listValues(OPERATIONAL_MODE);
  private _supportedSwingModes: SwingMode[] = listValues(SWING_MODE);
  private _supportedFanSpeeds: (FanSpeed | number)[] = listValues(FAN_SPEED);
  private _supportedRateSelects: RateSelect[] = [RATE_SELECT.OFF];
  private _supportedAuxModes: AuxHeatMode[] = [AUX_HEAT_MODE.OFF];

  // ---- Misc ----
  private _requestEnergyUsage = false;
  private _requestGroup5Data = false;

  /** Properties the device supports (based on capabilities). */
  private _supportedProperties = new Set<PropertyId>();

  /** Properties that have been modified and need to be sent to the device. */
  private _updatedProperties = new Set<PropertyId>();

  constructor(opts: {
    ip: string;
    port: number;
    deviceId: number;
    deviceType?: number;
    sn?: string | null;
    name?: string | null;
    version?: number | null;
  }) {
    super({
      ip: opts.ip,
      port: opts.port,
      deviceId: opts.deviceId,
      deviceType: DEVICE_TYPE.AIR_CONDITIONER,
      sn: opts.sn,
      name: opts.name,
      version: opts.version,
    });
  }

  // =========================================================================
  // State update
  // =========================================================================

  /**
   * Update the local state from a device response.
   * @internal
   */
  private _updateState(res: Response): void {
    if (res instanceof StateResponse) {
      this._powerState = res.powerOn;

      this._targetTemperature = res.targetTemperature;
      this._operationalMode =
        getFromValue(OPERATIONAL_MODE, res.operationalMode) ??
        OPERATIONAL_MODE_DEFAULT;

      if (this.supportsCustomFanSpeed) {
        // Attempt to resolve fan speed as known enum, fallback to raw int
        const resolved = getFromValue(FAN_SPEED, res.fanSpeed);
        this._fanSpeed = resolved ?? res.fanSpeed ?? FAN_SPEED_DEFAULT;
      } else {
        this._fanSpeed =
          getFromValue(FAN_SPEED, res.fanSpeed) ?? FAN_SPEED_DEFAULT;
      }

      this._swingMode =
        getFromValue(SWING_MODE, res.swingMode) ?? SWING_MODE_DEFAULT;

      this._eco = res.eco;
      this._turbo = res.turbo;
      this._freezeProtection = res.freezeProtection;
      this._sleep = res.sleep;

      this._indoorTemperature = res.indoorTemperature;
      this._outdoorTemperature = res.outdoorTemperature;

      this._displayOn = res.displayOn;
      this._fahrenheitUnit = res.fahrenheit;

      this._filterAlert = res.filterAlert;

      this._followMe = res.followMe;
      this._purifier = res.purifier;

      this._targetHumidity = res.targetHumidity;

      if (res.independentAuxHeat) {
        this._auxMode = AUX_HEAT_MODE.AUX_ONLY;
      } else if (res.auxHeat) {
        this._auxMode = AUX_HEAT_MODE.AUX_HEAT;
      } else {
        this._auxMode = AUX_HEAT_MODE.OFF;
      }

      this._errorCode = res.errorCode;
    } else if (res instanceof PropertiesResponse) {
      const swingLR = res.getProperty(PROPERTY_ID.SWING_LR_ANGLE);
      if (swingLR != null) {
        this._horizontalSwingAngle =
          getFromValue(SWING_ANGLE, swingLR as number) ?? SWING_ANGLE_DEFAULT;
      }

      const swingUD = res.getProperty(PROPERTY_ID.SWING_UD_ANGLE);
      if (swingUD != null) {
        this._verticalSwingAngle =
          getFromValue(SWING_ANGLE, swingUD as number) ?? SWING_ANGLE_DEFAULT;
      }

      const cascade = res.getProperty(PROPERTY_ID.CASCADE);
      if (cascade != null) {
        this._cascadeMode =
          getFromValue(CASCADE_MODE, cascade as number) ?? CASCADE_MODE_DEFAULT;
      }

      const selfClean = res.getProperty(PROPERTY_ID.SELF_CLEAN);
      if (selfClean != null) {
        this._selfCleanActive = selfClean as boolean;
      }

      const rate = res.getProperty(PROPERTY_ID.RATE_SELECT);
      if (rate != null) {
        this._rateSelect =
          getFromValue(RATE_SELECT, rate as number) ?? RATE_SELECT_DEFAULT;
      }

      // Breeze control supersedes breeze away and breezeless
      const breezeControl = res.getProperty(PROPERTY_ID.BREEZE_CONTROL);
      if (breezeControl != null) {
        const breezeValues = listValues(BREEZE_MODE);
        this._breezeMode = breezeValues.includes(breezeControl as BreezeMode)
          ? (breezeControl as BreezeMode)
          : BREEZE_MODE.OFF;
      } else {
        const breezeAway = res.getProperty(PROPERTY_ID.BREEZE_AWAY);
        if (breezeAway != null) {
          this._breezeMode = breezeAway
            ? BREEZE_MODE.BREEZE_AWAY
            : BREEZE_MODE.OFF;
        }

        const breezeless = res.getProperty(PROPERTY_ID.BREEZELESS);
        if (breezeless != null) {
          this._breezeMode = breezeless
            ? BREEZE_MODE.BREEZELESS
            : BREEZE_MODE.OFF;
        }
      }

      const ieco = res.getProperty(PROPERTY_ID.IECO);
      if (ieco != null) {
        this._ieco = ieco as boolean;
      }

      const jetCool = res.getProperty(PROPERTY_ID.JET_COOL);
      if (jetCool != null) {
        this._flashCool = jetCool as boolean;
      }

      const outSilent = res.getProperty(PROPERTY_ID.OUT_SILENT);
      if (outSilent != null) {
        this._outSilent = outSilent as boolean;
      }
    } else if (res instanceof EnergyUsageResponse) {
      this._totalEnergyUsage = {
        [ENERGY_DATA_FORMAT.BCD]: res.totalEnergy,
        [ENERGY_DATA_FORMAT.BINARY]: res.totalEnergyBinary,
      };

      this._currentEnergyUsage = {
        [ENERGY_DATA_FORMAT.BCD]: res.currentEnergy,
        [ENERGY_DATA_FORMAT.BINARY]: res.currentEnergyBinary,
      };

      this._realTimePowerUsage = {
        [ENERGY_DATA_FORMAT.BCD]: res.realTimePower,
        [ENERGY_DATA_FORMAT.BINARY]: res.realTimePowerBinary,
      };
    } else if (res instanceof Group5Response) {
      this._indoorHumidity = res.humidity;
      this._outdoorFanSpeed = res.outdoorFanSpeed;
      this._defrostActive = res.defrost;
    }
    // else: unknown response type — silently ignored
  }

  // =========================================================================
  // Capabilities
  // =========================================================================

  /**
   * Update device capabilities from a capabilities response.
   * @internal
   */
  private _updateCapabilities(res: CapabilitiesResponse): void {
    // Build list of supported operation modes
    const opModes: OperationalMode[] = [OPERATIONAL_MODE.FAN_ONLY];
    if (res.dryMode) opModes.push(OPERATIONAL_MODE.DRY);
    if (res.coolMode) opModes.push(OPERATIONAL_MODE.COOL);
    if (res.heatMode) opModes.push(OPERATIONAL_MODE.HEAT);
    if (res.autoMode) opModes.push(OPERATIONAL_MODE.AUTO);
    if (res.targetHumidity) {
      // Add SMART_DRY support if target humidity is supported
      opModes.push(OPERATIONAL_MODE.SMART_DRY);
    }
    this._supportedOpModes = opModes;

    // Build list of supported swing modes
    const swingModes: SwingMode[] = [SWING_MODE.OFF];
    if (res.swingHorizontal) swingModes.push(SWING_MODE.HORIZONTAL);
    if (res.swingVertical) swingModes.push(SWING_MODE.VERTICAL);
    if (res.swingBoth) swingModes.push(SWING_MODE.BOTH);
    this._supportedSwingModes = swingModes;

    // Build list of supported fan speeds
    const fanSpeeds: FanSpeed[] = [];
    if (res.fanSilent) fanSpeeds.push(FAN_SPEED.SILENT);
    if (res.fanLow) fanSpeeds.push(FAN_SPEED.LOW);
    if (res.fanMedium) fanSpeeds.push(FAN_SPEED.MEDIUM);
    if (res.fanHigh) fanSpeeds.push(FAN_SPEED.HIGH);
    if (res.fanAuto) fanSpeeds.push(FAN_SPEED.AUTO);
    if (res.fanCustom) {
      // Include additional MAX speed if custom speeds are supported
      fanSpeeds.push(FAN_SPEED.MAX);
    }
    this._supportedFanSpeeds = fanSpeeds;
    this._capabilities.set(
      AC_CAPABILITY.CUSTOM_FAN_SPEED as number,
      res.fanCustom,
    );

    this._capabilities.set(AC_CAPABILITY.ECO as number, res.eco);
    this._capabilities.set(AC_CAPABILITY.TURBO as number, res.turbo);
    this._capabilities.set(
      AC_CAPABILITY.FREEZE_PROTECTION as number,
      res.freezeProtection,
    );

    this._capabilities.set(
      AC_CAPABILITY.DISPLAY_CONTROL as number,
      res.displayControl,
    );
    this._capabilities.set(
      AC_CAPABILITY.FILTER_REMINDER as number,
      res.filterReminder,
    );

    this._capabilities.set(AC_CAPABILITY.PURIFIER as number, res.anion);

    // Build list of supported aux heating modes
    const auxModes: AuxHeatMode[] = [AUX_HEAT_MODE.OFF];
    if (res.auxElectricHeat || res.auxHeatMode) {
      auxModes.push(AUX_HEAT_MODE.AUX_HEAT);
    }
    if (res.auxMode) {
      auxModes.push(AUX_HEAT_MODE.AUX_ONLY);
    }
    this._supportedAuxModes = auxModes;

    this._minTargetTemperature = res.minTemperature;
    this._maxTargetTemperature = res.maxTemperature;

    // Allow capabilities to enable energy usage requests, but not disable them.
    // We've seen devices that claim no capability but return energy data.
    this._requestEnergyUsage = this._requestEnergyUsage || res.energyStats;

    this._capabilities.set(AC_CAPABILITY.HUMIDITY as number, res.humidity);
    this._capabilities.set(
      AC_CAPABILITY.TARGET_HUMIDITY as number,
      res.targetHumidity,
    );

    this._capabilities.set(
      AC_CAPABILITY.SWING_VERTICAL_ANGLE as number,
      res.swingVerticalAngle,
    );
    this._capabilities.set(
      AC_CAPABILITY.SWING_HORIZONTAL_ANGLE as number,
      res.swingHorizontalAngle,
    );

    this._capabilities.set(AC_CAPABILITY.CASCADE as number, res.cascade);

    this._capabilities.set(AC_CAPABILITY.SELF_CLEAN as number, res.selfClean);

    // Add supported rate select levels
    const rates = res.rateSelectLevels;
    if (rates != null) {
      if (rates > 2) {
        this._supportedRateSelects = [
          RATE_SELECT.OFF,
          RATE_SELECT.LEVEL_5,
          RATE_SELECT.LEVEL_4,
          RATE_SELECT.LEVEL_3,
          RATE_SELECT.LEVEL_2,
          RATE_SELECT.LEVEL_1,
        ];
      } else {
        this._supportedRateSelects = [
          RATE_SELECT.OFF,
          RATE_SELECT.GEAR_75,
          RATE_SELECT.GEAR_50,
        ];
      }
    }

    // Breeze control supersedes breeze away and breezeless
    this._capabilities.set(
      AC_CAPABILITY.BREEZE_CONTROL as number,
      res.breezeControl,
    );
    if (!res.breezeControl) {
      this._capabilities.set(
        AC_CAPABILITY.BREEZE_AWAY as number,
        res.breezeAway,
      );
      this._capabilities.set(
        AC_CAPABILITY.BREEZELESS as number,
        res.breezeless,
      );
    }

    this._capabilities.set(AC_CAPABILITY.IECO as number, res.ieco);
    this._capabilities.set(AC_CAPABILITY.JET_COOL as number, res.jetCool);

    this._capabilities.set(AC_CAPABILITY.OUT_SILENT as number, res.outSilent);

    // Update supported properties from capabilities
    this._updateSupportedProperties();
  }

  /**
   * Update supported properties based on device capabilities.
   * @internal
   */
  private _updateSupportedProperties(): void {
    // Map of capability flag to property ID
    const capabilityMap: ReadonlyMap<number, PropertyId> = new Map([
      [AC_CAPABILITY.BREEZE_AWAY, PROPERTY_ID.BREEZE_AWAY],
      [AC_CAPABILITY.BREEZE_CONTROL, PROPERTY_ID.BREEZE_CONTROL],
      [AC_CAPABILITY.BREEZELESS, PROPERTY_ID.BREEZELESS],
      [AC_CAPABILITY.CASCADE, PROPERTY_ID.CASCADE],
      [AC_CAPABILITY.IECO, PROPERTY_ID.IECO],
      [AC_CAPABILITY.JET_COOL, PROPERTY_ID.JET_COOL],
      [AC_CAPABILITY.OUT_SILENT, PROPERTY_ID.OUT_SILENT],
      [AC_CAPABILITY.SELF_CLEAN, PROPERTY_ID.SELF_CLEAN],
      [AC_CAPABILITY.SWING_HORIZONTAL_ANGLE, PROPERTY_ID.SWING_LR_ANGLE],
      [AC_CAPABILITY.SWING_VERTICAL_ANGLE, PROPERTY_ID.SWING_UD_ANGLE],
    ]);

    // Clear existing properties
    this._supportedProperties.clear();

    // Test each capability
    for (const [cap, prop] of capabilityMap) {
      if (this._capabilities.has(cap as number)) {
        this._supportedProperties.add(prop);
      }
    }

    // Rate select is a special case: property based but not controlled by a capability flag
    if (
      this._supportedRateSelects.length !== 1 ||
      this._supportedRateSelects[0] !== RATE_SELECT.OFF
    ) {
      this._supportedProperties.add(PROPERTY_ID.RATE_SELECT);
    }
  }

  // =========================================================================
  // Communication
  // =========================================================================

  /**
   * Send a list of commands and return all valid responses.
   * @internal
   */
  private async _sendCommandsGetResponses(
    commands: Command | Command[],
  ): Promise<Response[]> {
    const cmdList = Array.isArray(commands) ? commands : [commands];

    const rawResponses: Uint8Array[] = [];
    for (const cmd of cmdList) {
      const responses = await super._sendCommand(cmd);
      rawResponses.push(...responses);
    }

    // Device is online if any response received
    this._online = rawResponses.length > 0;

    const validResponses: Response[] = [];
    for (const data of rawResponses) {
      try {
        const response = Response.construct(data);
        validResponses.push(response);
      } catch (e) {
        if (
          e instanceof InvalidFrameError ||
          e instanceof InvalidResponseError
        ) {
          console.error(e.message);
          continue;
        }
        throw e;
      }
    }

    // Device is supported if online and any supported response is received
    this._supported =
      this._supported || (this._online && validResponses.length > 0);

    return validResponses;
  }

  /**
   * Send a command and return the first response of the requested class.
   * @internal
   */
  private async _sendCommandGetResponseWithClass<T extends Response>(
    command: Command,
    responseClass: new (...args: any[]) => T,
  ): Promise<T | null> {
    for (const response of await this._sendCommandsGetResponses(command)) {
      if (response instanceof responseClass) {
        return response as T;
      }
    }
    return null;
  }

  // =========================================================================
  // Public API – Device actions
  // =========================================================================

  /** Fetch the device capabilities. */
  async getCapabilities(): Promise<void> {
    // Send capabilities request and get a response
    const cmd = new GetCapabilitiesCommand();
    let response = await this._sendCommandGetResponseWithClass(
      cmd,
      CapabilitiesResponse,
    );
    if (response == null) {
      console.error(
        `Failed to query capabilities from device ${this.id}.`,
      );
      return;
    }

    // Send 2nd capabilities request if needed
    if (response.additionalCapabilities) {
      const additionalCmd = new GetCapabilitiesCommand(true);
      const additionalResponse = await this._sendCommandGetResponseWithClass(
        additionalCmd,
        CapabilitiesResponse,
      );
      if (additionalResponse) {
        // Merge additional capabilities
        response.merge(additionalResponse);
      } else {
        console.warn(
          `Failed to query additional capabilities from device ${this.id}.`,
        );
      }
    }

    // Update device capabilities
    this._updateCapabilities(response);
  }

  /** Toggle the device display if the device supports it. */
  async toggleDisplay(): Promise<void> {
    if (!this.supportsDisplayControl) {
      console.warn(
        `Device ${this.id} is not capable of display control.`,
      );
    }

    // Send the command and ignore all responses
    const cmd = new ToggleDisplayCommand();
    cmd.beepOn = this._beepOn;
    await this._sendCommandsGetResponses(cmd);

    // Force a refresh to get the updated display state
    await this.refresh();
  }

  /** Start a self cleaning if the device supports it. */
  async startSelfClean(): Promise<void> {
    // Start self clean via properties command
    await this._applyProperties(
      new Map<PropertyId, number | boolean>([
        [PROPERTY_ID.SELF_CLEAN, true],
      ]),
    );
  }

  /** Refresh the local copy of the device state by sending a GetState command. */
  override async refresh(): Promise<void> {
    const commands: Command[] = [];

    // Always request state updates
    commands.push(new GetStateCommand());

    // Fetch power stats if supported
    if (this._requestEnergyUsage) {
      commands.push(new GetEnergyUsageCommand());
    }

    // Request Group 5 data if humidity is supported or otherwise enabled
    if (this.supportsHumidity || this._requestGroup5Data) {
      commands.push(new GetGroup5Command());
    }

    // Update supported properties
    if (this._supportedProperties.size > 0) {
      commands.push(
        new GetPropertiesCommand([...this._supportedProperties]),
      );
    }

    // Send all commands and collect responses
    const responses = await this._sendCommandsGetResponses(commands);

    // Update state from responses
    for (const response of responses) {
      this._updateState(response);
    }
  }

  /**
   * Apply the provided properties to the device.
   * @internal
   */
  private async _applyProperties(
    properties: Map<PropertyId, number | boolean>,
  ): Promise<void> {
    // Warn if attempting to update a property that isn't supported
    for (const prop of properties.keys()) {
      if (!this._supportedProperties.has(prop)) {
        console.warn(
          `Device ${this.id} is not capable of property 0x${prop.toString(16).padStart(4, "0")}.`,
        );
      }
    }

    // Always add buzzer property
    properties.set(PROPERTY_ID.BUZZER, this._beepOn);

    // Build command with properties
    const cmd = new SetPropertiesCommand(properties);
    for (const response of await this._sendCommandsGetResponses(cmd)) {
      this._updateState(response);
    }
  }

  /** Apply the local state to the device. */
  override async apply(): Promise<void> {
    // Warn if trying to apply unsupported modes
    if (!this.supportedOperationModes.includes(this._operationalMode)) {
      console.warn(
        `Device ${this.id} is not capable of operational mode ${this._operationalMode}.`,
      );
    }

    if (
      !this.supportedFanSpeeds.includes(this._fanSpeed as FanSpeed) &&
      !this.supportsCustomFanSpeed
    ) {
      console.warn(
        `Device ${this.id} is not capable of fan speed ${this._fanSpeed}.`,
      );
    }

    if (!this.supportedSwingModes.includes(this._swingMode)) {
      console.warn(
        `Device ${this.id} is not capable of swing mode ${this._swingMode}.`,
      );
    }

    if (this._turbo && !this.supportsTurbo) {
      console.warn(
        `Device ${this.id} is not capable of turbo mode.`,
      );
    }

    if (this._eco && !this.supportsEco) {
      console.warn(
        `Device ${this.id} is not capable of eco mode.`,
      );
    }

    if (this._freezeProtection && !this.supportsFreezeProtection) {
      console.warn(
        `Device ${this.id} is not capable of freeze protection.`,
      );
    }

    if (
      this._rateSelect !== RATE_SELECT.OFF &&
      !this.supportedRateSelects.includes(this._rateSelect)
    ) {
      console.warn(
        `Device ${this.id} is not capable of rate select ${this._rateSelect}.`,
      );
    }

    if (
      this._auxMode !== AUX_HEAT_MODE.OFF &&
      !this.supportedAuxModes.includes(this._auxMode)
    ) {
      console.warn(
        `Device is not capable of aux mode ${this._auxMode}.`,
      );
    }

    const cmd = new SetStateCommand();
    cmd.beepOn = this._beepOn;
    cmd.powerOn = orDefault(this._powerState, false);
    cmd.targetTemperature = orDefault(this._targetTemperature, 25);
    cmd.operationalMode = this._operationalMode;
    cmd.fanSpeed = this._fanSpeed;
    cmd.swingMode = this._swingMode;
    cmd.eco = orDefault(this._eco, false);
    cmd.turbo = orDefault(this._turbo, false);
    cmd.freezeProtection = orDefault(this._freezeProtection, false);
    cmd.sleep = orDefault(this._sleep, false);
    cmd.fahrenheit = orDefault(this._fahrenheitUnit, false);
    cmd.followMe = orDefault(this._followMe, false);
    cmd.purifier = orDefault(this._purifier, false);
    cmd.targetHumidity = orDefault(this._targetHumidity, 40);
    cmd.auxHeat = this._auxMode === AUX_HEAT_MODE.AUX_HEAT;
    cmd.independentAuxHeat = this._auxMode === AUX_HEAT_MODE.AUX_ONLY;

    // Process any state responses from the device
    for (const response of await this._sendCommandsGetResponses(cmd)) {
      this._updateState(response);
    }

    // Done if no properties need updating
    if (this._updatedProperties.size === 0) {
      return;
    }

    // Get current state of updated properties
    const props = new Map<PropertyId, number | boolean>();
    for (const k of this._updatedProperties) {
      const getter = AirConditioner._PROPERTY_MAP.get(k);
      if (getter) {
        props.set(k, getter(this));
      }
    }

    // Apply new properties
    await this._applyProperties(props);

    // Reset updated properties set
    this._updatedProperties.clear();
  }

  /**
   * Override device capabilities via serialized dict.
   */
  override overrideCapabilities(
    overrides: Record<string, unknown>,
    opts?: { merge?: boolean },
  ): void {
    // Apply overrides
    super.overrideCapabilities(overrides, opts);

    // Update supported properties
    this._updateSupportedProperties();
  }

  // =========================================================================
  // Properties – basic controls
  // =========================================================================

  /** Whether the device should beep on commands. */
  get beep(): boolean {
    return this._beepOn;
  }

  set beep(tone: boolean) {
    this._beepOn = tone;
  }

  /** Device power state. */
  get powerState(): boolean | null {
    return this._powerState;
  }

  set powerState(state: boolean) {
    this._powerState = state;
  }

  /** Whether temperatures are displayed in Fahrenheit. */
  get fahrenheit(): boolean | null {
    return this._fahrenheitUnit;
  }

  set fahrenheit(enabled: boolean) {
    this._fahrenheitUnit = enabled;
  }

  /** Minimum allowed target temperature. */
  get minTargetTemperature(): number {
    return this._minTargetTemperature;
  }

  /** Maximum allowed target temperature. */
  get maxTargetTemperature(): number {
    return this._maxTargetTemperature;
  }

  /** Target temperature in Celsius. */
  get targetTemperature(): number | null {
    return this._targetTemperature;
  }

  set targetTemperature(temperatureCelsius: number) {
    this._targetTemperature = temperatureCelsius;
  }

  /** Current indoor temperature. */
  get indoorTemperature(): number | null {
    return this._indoorTemperature;
  }

  /** Current outdoor temperature. */
  get outdoorTemperature(): number | null {
    return this._outdoorTemperature;
  }

  // =========================================================================
  // Properties – operational mode
  // =========================================================================

  /** List of supported operational modes. */
  get supportedOperationModes(): OperationalMode[] {
    return this._supportedOpModes;
  }

  /** Current operational mode. */
  get operationalMode(): OperationalMode {
    return this._operationalMode;
  }

  set operationalMode(mode: OperationalMode) {
    this._operationalMode = mode;
  }

  // =========================================================================
  // Properties – fan speed
  // =========================================================================

  /** List of supported fan speeds. */
  get supportedFanSpeeds(): (FanSpeed | number)[] {
    return this._supportedFanSpeeds;
  }

  /** Whether the device supports custom (arbitrary) fan speeds. */
  get supportsCustomFanSpeed(): boolean {
    return this._capabilities.has(AC_CAPABILITY.CUSTOM_FAN_SPEED);
  }

  /** Current fan speed. */
  get fanSpeed(): FanSpeed | number {
    return this._fanSpeed;
  }

  set fanSpeed(speed: FanSpeed | number) {
    // Convert float if needed
    if (typeof speed === "number" && !Number.isInteger(speed)) {
      speed = Math.trunc(speed);
    }
    this._fanSpeed = speed;
  }

  // =========================================================================
  // Properties – breeze modes
  // =========================================================================

  /** Whether the device supports breeze away. */
  get supportsBreezeAway(): boolean {
    return this._capabilities.has(
      (AC_CAPABILITY.BREEZE_AWAY | AC_CAPABILITY.BREEZE_CONTROL) as number,
    );
  }

  /** Whether breeze away is active. */
  get breezeAway(): boolean {
    return this._breezeMode === BREEZE_MODE.BREEZE_AWAY;
  }

  set breezeAway(enable: boolean) {
    this._breezeMode = enable ? BREEZE_MODE.BREEZE_AWAY : BREEZE_MODE.OFF;
    this._updatedProperties.add(
      this._capabilities.has(AC_CAPABILITY.BREEZE_CONTROL)
        ? PROPERTY_ID.BREEZE_CONTROL
        : PROPERTY_ID.BREEZE_AWAY,
    );
  }

  /** Whether the device supports breeze mild. */
  get supportsBreezeMild(): boolean {
    return this._capabilities.has(AC_CAPABILITY.BREEZE_CONTROL);
  }

  /** Whether breeze mild is active. */
  get breezeMild(): boolean {
    return this._breezeMode === BREEZE_MODE.BREEZE_MILD;
  }

  set breezeMild(enable: boolean) {
    this._breezeMode = enable ? BREEZE_MODE.BREEZE_MILD : BREEZE_MODE.OFF;
    this._updatedProperties.add(PROPERTY_ID.BREEZE_CONTROL);
  }

  /** Whether the device supports breezeless mode. */
  get supportsBreezeless(): boolean {
    return this._capabilities.has(
      (AC_CAPABILITY.BREEZELESS | AC_CAPABILITY.BREEZE_CONTROL) as number,
    );
  }

  /** Whether breezeless is active. */
  get breezeless(): boolean {
    return this._breezeMode === BREEZE_MODE.BREEZELESS;
  }

  set breezeless(enable: boolean) {
    this._breezeMode = enable ? BREEZE_MODE.BREEZELESS : BREEZE_MODE.OFF;
    this._updatedProperties.add(
      this._capabilities.has(AC_CAPABILITY.BREEZE_CONTROL)
        ? PROPERTY_ID.BREEZE_CONTROL
        : PROPERTY_ID.BREEZELESS,
    );
  }

  // =========================================================================
  // Properties – swing modes
  // =========================================================================

  /** List of supported swing modes. */
  get supportedSwingModes(): SwingMode[] {
    return this._supportedSwingModes;
  }

  /** Current swing mode. */
  get swingMode(): SwingMode {
    return this._swingMode;
  }

  set swingMode(mode: SwingMode) {
    this._swingMode = mode;
  }

  /** Whether the device supports horizontal swing angle control. */
  get supportsHorizontalSwingAngle(): boolean {
    return this._capabilities.has(AC_CAPABILITY.SWING_HORIZONTAL_ANGLE);
  }

  /** Current horizontal swing angle. */
  get horizontalSwingAngle(): SwingAngle {
    return this._horizontalSwingAngle;
  }

  set horizontalSwingAngle(angle: SwingAngle) {
    this._horizontalSwingAngle = angle;
    this._updatedProperties.add(PROPERTY_ID.SWING_LR_ANGLE);
  }

  /** Whether the device supports vertical swing angle control. */
  get supportsVerticalSwingAngle(): boolean {
    return this._capabilities.has(AC_CAPABILITY.SWING_VERTICAL_ANGLE);
  }

  /** Current vertical swing angle. */
  get verticalSwingAngle(): SwingAngle {
    return this._verticalSwingAngle;
  }

  set verticalSwingAngle(angle: SwingAngle) {
    this._verticalSwingAngle = angle;
    this._updatedProperties.add(PROPERTY_ID.SWING_UD_ANGLE);
  }

  // =========================================================================
  // Properties – cascade
  // =========================================================================

  /** Whether the device supports cascade mode. */
  get supportsCascade(): boolean {
    return this._capabilities.has(AC_CAPABILITY.CASCADE);
  }

  /** Current cascade mode. */
  get cascadeMode(): CascadeMode {
    return this._cascadeMode;
  }

  set cascadeMode(mode: CascadeMode) {
    this._cascadeMode = mode;
    this._updatedProperties.add(PROPERTY_ID.CASCADE);
  }

  // =========================================================================
  // Properties – presets (eco, turbo, freeze protection, sleep)
  // =========================================================================

  /** Whether the device supports eco mode. */
  get supportsEco(): boolean {
    return this._capabilities.has(AC_CAPABILITY.ECO);
  }

  /** Whether eco mode is enabled. */
  get eco(): boolean | null {
    return this._eco;
  }

  set eco(enabled: boolean) {
    this._eco = enabled;
  }

  /** Whether the device supports iECO mode. */
  get supportsIeco(): boolean {
    return this._capabilities.has(AC_CAPABILITY.IECO);
  }

  /** Whether iECO mode is enabled. */
  get ieco(): boolean | null {
    return this._ieco;
  }

  set ieco(enabled: boolean) {
    this._ieco = enabled;
    this._updatedProperties.add(PROPERTY_ID.IECO);
  }

  /** Whether the device supports flash/jet cool. */
  get supportsFlashCool(): boolean {
    return this._capabilities.has(AC_CAPABILITY.JET_COOL);
  }

  /** Whether flash/jet cool is enabled. */
  get flashCool(): boolean | null {
    return this._flashCool;
  }

  set flashCool(enabled: boolean) {
    this._flashCool = enabled;
    this._updatedProperties.add(PROPERTY_ID.JET_COOL);
  }

  /** Whether the device supports turbo mode. */
  get supportsTurbo(): boolean {
    return this._capabilities.has(AC_CAPABILITY.TURBO);
  }

  /** Whether turbo mode is enabled. */
  get turbo(): boolean | null {
    return this._turbo;
  }

  set turbo(enabled: boolean) {
    this._turbo = enabled;
  }

  /** Whether the device supports freeze protection. */
  get supportsFreezeProtection(): boolean {
    return this._capabilities.has(AC_CAPABILITY.FREEZE_PROTECTION);
  }

  /** Whether freeze protection is enabled. */
  get freezeProtection(): boolean | null {
    return this._freezeProtection;
  }

  set freezeProtection(enabled: boolean) {
    this._freezeProtection = enabled;
  }

  /** Whether sleep mode is enabled. */
  get sleep(): boolean | null {
    return this._sleep;
  }

  set sleep(enabled: boolean) {
    this._sleep = enabled;
  }

  /** Whether follow-me mode is enabled. */
  get followMe(): boolean | null {
    return this._followMe;
  }

  set followMe(enabled: boolean) {
    this._followMe = enabled;
  }

  // =========================================================================
  // Properties – purifier
  // =========================================================================

  /** Whether the device supports the purifier/anion feature. */
  get supportsPurifier(): boolean {
    return this._capabilities.has(AC_CAPABILITY.PURIFIER);
  }

  /** Whether the purifier is enabled. */
  get purifier(): boolean | null {
    return this._purifier;
  }

  set purifier(enabled: boolean) {
    this._purifier = enabled;
  }

  // =========================================================================
  // Properties – display
  // =========================================================================

  /** Whether the device supports display on/off control. */
  get supportsDisplayControl(): boolean {
    return this._capabilities.has(AC_CAPABILITY.DISPLAY_CONTROL);
  }

  /** Whether the display is on. */
  get displayOn(): boolean | null {
    return this._displayOn;
  }

  // =========================================================================
  // Properties – filter reminder
  // =========================================================================

  /** Whether the device supports filter reminder. */
  get supportsFilterReminder(): boolean {
    return this._capabilities.has(AC_CAPABILITY.FILTER_REMINDER);
  }

  /** Whether the filter alert is active. */
  get filterAlert(): boolean | null {
    return this._filterAlert;
  }

  // =========================================================================
  // Properties – energy usage
  // =========================================================================

  /** Whether energy usage requests are enabled. */
  get enableEnergyUsageRequests(): boolean {
    return this._requestEnergyUsage;
  }

  set enableEnergyUsageRequests(enable: boolean) {
    this._requestEnergyUsage = enable;
  }

  /**
   * Get total energy usage.
   * @param format - The data format (BCD or BINARY). Defaults to BCD.
   */
  getTotalEnergyUsage(
    format: EnergyDataFormat = ENERGY_DATA_FORMAT.BCD,
  ): number | null {
    return this._totalEnergyUsage[format];
  }

  /**
   * Get current energy usage.
   * @param format - The data format (BCD or BINARY). Defaults to BCD.
   */
  getCurrentEnergyUsage(
    format: EnergyDataFormat = ENERGY_DATA_FORMAT.BCD,
  ): number | null {
    return this._currentEnergyUsage[format];
  }

  /**
   * Get real-time power usage.
   * @param format - The data format (BCD or BINARY). Defaults to BCD.
   */
  getRealTimePowerUsage(
    format: EnergyDataFormat = ENERGY_DATA_FORMAT.BCD,
  ): number | null {
    return this._realTimePowerUsage[format];
  }

  // =========================================================================
  // Properties – humidity
  // =========================================================================

  /** Whether the device supports humidity sensing. */
  get supportsHumidity(): boolean {
    return this._capabilities.has(AC_CAPABILITY.HUMIDITY);
  }

  /** Current indoor humidity. */
  get indoorHumidity(): number | null {
    return this._indoorHumidity;
  }

  /** Whether the device supports target humidity control. */
  get supportsTargetHumidity(): boolean {
    return this._capabilities.has(AC_CAPABILITY.TARGET_HUMIDITY);
  }

  /** Target humidity. */
  get targetHumidity(): number | null {
    return this._targetHumidity;
  }

  set targetHumidity(humidity: number) {
    this._targetHumidity = humidity;
  }

  // =========================================================================
  // Properties – self clean
  // =========================================================================

  /** Whether the device supports self-cleaning. */
  get supportsSelfClean(): boolean {
    return this._capabilities.has(AC_CAPABILITY.SELF_CLEAN);
  }

  /** Whether self-cleaning is currently active. */
  get selfCleanActive(): boolean | null {
    return this._selfCleanActive;
  }

  // =========================================================================
  // Properties – rate select
  // =========================================================================

  /** List of supported rate select levels. */
  get supportedRateSelects(): RateSelect[] {
    return this._supportedRateSelects;
  }

  /** Current rate select level. */
  get rateSelect(): RateSelect {
    return this._rateSelect;
  }

  set rateSelect(rate: RateSelect) {
    this._rateSelect = rate;
    this._updatedProperties.add(PROPERTY_ID.RATE_SELECT);
  }

  // =========================================================================
  // Properties – aux heat
  // =========================================================================

  /** List of supported auxiliary heating modes. */
  get supportedAuxModes(): AuxHeatMode[] {
    return this._supportedAuxModes;
  }

  /** Current auxiliary heating mode. */
  get auxMode(): AuxHeatMode {
    return this._auxMode;
  }

  set auxMode(mode: AuxHeatMode) {
    this._auxMode = mode;
  }

  // =========================================================================
  // Properties – error code
  // =========================================================================

  /** Current error code, or null. */
  get errorCode(): number | null {
    return this._errorCode;
  }

  // =========================================================================
  // Properties – group 5 data
  // =========================================================================

  /** Whether group 5 data requests are enabled. */
  get enableGroup5DataRequests(): boolean {
    return this._requestGroup5Data;
  }

  set enableGroup5DataRequests(enable: boolean) {
    this._requestGroup5Data = enable;
  }

  /** Whether defrost is currently active. */
  get defrostActive(): boolean | null {
    return this._defrostActive;
  }

  /** Outdoor fan speed. */
  get outdoorFanSpeed(): number | null {
    return this._outdoorFanSpeed;
  }

  // =========================================================================
  // Properties – outdoor silent
  // =========================================================================

  /** Whether the device supports outdoor silent mode. */
  get supportsOutSilent(): boolean {
    return this._capabilities.has(AC_CAPABILITY.OUT_SILENT);
  }

  /** Whether outdoor silent mode is enabled. */
  get outSilent(): boolean | null {
    return this._outSilent;
  }

  set outSilent(enabled: boolean) {
    this._outSilent = enabled;
    this._updatedProperties.add(PROPERTY_ID.OUT_SILENT);
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  /** Return all device state as a plain object. */
  override toDict(): Record<string, unknown> {
    return {
      ...super.toDict(),
      power: this.powerState,
      mode: this.operationalMode,
      fan_speed: this.fanSpeed,
      swing_mode: this.swingMode,
      horizontal_swing_angle: this.horizontalSwingAngle,
      vertical_swing_angle: this.verticalSwingAngle,
      cascade_mode: this.cascadeMode,
      target_temperature: this.targetTemperature,
      indoor_temperature: this.indoorTemperature,
      outdoor_temperature: this.outdoorTemperature,
      target_humidity: this.targetHumidity,
      indoor_humidity: this.indoorHumidity,
      eco: this.eco,
      turbo: this.turbo,
      freeze_protection: this.freezeProtection,
      sleep: this.sleep,
      display_on: this.displayOn,
      beep: this.beep,
      fahrenheit: this.fahrenheit,
      filter_alert: this.filterAlert,
      follow_me: this.followMe,
      purifier: this.purifier,
      self_clean: this.selfCleanActive,
      total_energy_usage: this.getTotalEnergyUsage(),
      current_energy_usage: this.getCurrentEnergyUsage(),
      real_time_power_usage: this.getRealTimePowerUsage(),
      rate_select: this.rateSelect,
      aux_mode: this.auxMode,
      error_code: this.errorCode,
      defrost: this.defrostActive,
      out_silent: this.outSilent,
    };
  }

  /** Return all device capabilities as a plain object. */
  override capabilitiesDict(): Record<string, unknown> {
    return {
      min_target_temperature: this.minTargetTemperature,
      max_target_temperature: this.maxTargetTemperature,
      supported_modes: this.supportedOperationModes,
      supported_swing_modes: this.supportedSwingModes,
      supported_fan_speeds: this.supportedFanSpeeds,
      supported_aux_modes: this.supportedAuxModes,
      supported_rate_selects: this.supportedRateSelects,
      additional_capabilities: this._capabilities.flags,
    };
  }
}
