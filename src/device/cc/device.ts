/**
 * Commercial Air Conditioner (0xCC) device class.
 *
 * Ported from msmart/device/CC/device.py
 * @module
 */

import { Device } from "../../base-device.ts";
import { DEVICE_TYPE } from "../../const.ts";
import type { DeviceType } from "../../const.ts";
import { InvalidFrameError } from "../../frame.ts";
import { CapabilityManager, getFromValue, listValues } from "../../utils.ts";
import {
  Command,
  ControlCommand,
  CONTROL_ID,
  InvalidResponseError,
  QueryCommand,
  QueryResponse,
  Response,
} from "./command.ts";
import type { ControlId } from "./command.ts";

// ---------------------------------------------------------------------------
// Const objects & derived union types
// ---------------------------------------------------------------------------

/** Fan speed levels for CC devices. */
export const CC_FAN_SPEED = {
  L1: 0x01,
  L2: 0x02,
  L3: 0x03,
  L4: 0x04,
  L5: 0x05,
  L6: 0x06,
  L7: 0x07,
  AUTO: 0x08,
} as const;

export type CcFanSpeed = (typeof CC_FAN_SPEED)[keyof typeof CC_FAN_SPEED];

/** Default fan speed. */
const CC_FAN_SPEED_DEFAULT: CcFanSpeed = CC_FAN_SPEED.AUTO;

/** Operational modes for CC devices. */
export const CC_OPERATIONAL_MODE = {
  FAN: 0x01,
  COOL: 0x02,
  HEAT: 0x03,
  AUTO: 0x05,
  DRY: 0x06,
} as const;

export type CcOperationalMode =
  (typeof CC_OPERATIONAL_MODE)[keyof typeof CC_OPERATIONAL_MODE];

/** Default operational mode. */
const CC_OPERATIONAL_MODE_DEFAULT: CcOperationalMode = CC_OPERATIONAL_MODE.FAN;

/** Swing modes for CC devices. */
export const CC_SWING_MODE = {
  OFF: 0x0,
  VERTICAL: 0x1,
  HORIZONTAL: 0x2,
  BOTH: 0x3,
} as const;

export type CcSwingMode =
  (typeof CC_SWING_MODE)[keyof typeof CC_SWING_MODE];

/** Default swing mode. */
const CC_SWING_MODE_DEFAULT: CcSwingMode = CC_SWING_MODE.OFF;

/** Swing angle positions for CC devices. */
export const CC_SWING_ANGLE = {
  CLOSE: 0x00,
  POS_1: 0x01,
  POS_2: 0x02,
  POS_3: 0x03,
  POS_4: 0x04,
  POS_5: 0x05,
  AUTO: 0x06,
} as const;

export type CcSwingAngle =
  (typeof CC_SWING_ANGLE)[keyof typeof CC_SWING_ANGLE];

/** Default swing angle. */
const CC_SWING_ANGLE_DEFAULT: CcSwingAngle = CC_SWING_ANGLE.POS_3;

/** Purifier modes for CC devices. */
export const CC_PURIFIER_MODE = {
  AUTO: 0x00,
  ON: 0x01,
  OFF: 0x02,
} as const;

export type CcPurifierMode =
  (typeof CC_PURIFIER_MODE)[keyof typeof CC_PURIFIER_MODE];

/** Default purifier mode. */
const CC_PURIFIER_MODE_DEFAULT: CcPurifierMode = CC_PURIFIER_MODE.OFF;

/** Aux heat modes for CC devices. */
export const CC_AUX_HEAT_MODE = {
  AUTO: 0x00,
  ON: 0x01,
  OFF: 0x02,
} as const;

export type CcAuxHeatMode =
  (typeof CC_AUX_HEAT_MODE)[keyof typeof CC_AUX_HEAT_MODE];

/** Default aux heat mode. */
const CC_AUX_HEAT_MODE_DEFAULT: CcAuxHeatMode = CC_AUX_HEAT_MODE.OFF;

/** Capability bitmask flags for CC devices. */
export const CC_CAPABILITY = {
  ECO: 1 << 0,
  SILENT: 1 << 1,
  SLEEP: 1 << 2,
  SWING_HORIZONTAL_ANGLE: 1 << 3,
  SWING_VERTICAL_ANGLE: 1 << 4,
  HUMIDITY: 1 << 5,
  PURIFIER: 1 << 6,
} as const;

export type CcCapability =
  (typeof CC_CAPABILITY)[keyof typeof CC_CAPABILITY];

/** Default capability flags (all except PURIFIER). */
const CC_CAPABILITY_DEFAULT: number =
  CC_CAPABILITY.ECO |
  CC_CAPABILITY.SILENT |
  CC_CAPABILITY.SLEEP |
  CC_CAPABILITY.SWING_HORIZONTAL_ANGLE |
  CC_CAPABILITY.SWING_VERTICAL_ANGLE |
  CC_CAPABILITY.HUMIDITY;

// ---------------------------------------------------------------------------
// Control map helper type
// ---------------------------------------------------------------------------

type ControlMapFn = (device: CommercialAirConditioner) => number | boolean;

const CONTROL_MAP: Record<number, ControlMapFn> = {
  [CONTROL_ID.POWER]: (s) => s["_powerState"],
  [CONTROL_ID.TARGET_TEMPERATURE]: (s) => s["_targetTemperature"],
  [CONTROL_ID.TEMPERATURE_UNIT]: (s) => s["_fahrenheit"],
  [CONTROL_ID.TARGET_HUMIDITY]: (s) => s["_targetHumidity"],
  [CONTROL_ID.MODE]: (s) => s["_operationalMode"],
  [CONTROL_ID.FAN_SPEED]: (s) => s["_fanSpeed"],
  [CONTROL_ID.HORZ_SWING_ANGLE]: (s) => s["_horizontalSwingAngle"],
  [CONTROL_ID.VERT_SWING_ANGLE]: (s) => s["_verticalSwingAngle"],
  [CONTROL_ID.ECO]: (s) => s["_eco"],
  [CONTROL_ID.SILENT]: (_s) => false,
  [CONTROL_ID.SLEEP]: (_s) => false,
  [CONTROL_ID.PURIFIER]: (s) => s["_purifier"],
  [CONTROL_ID.AUX_MODE]: (s) => s["_auxMode"],
};

// ---------------------------------------------------------------------------
// CommercialAirConditioner
// ---------------------------------------------------------------------------

/**
 * Device class for 0xCC (commercial air conditioner) appliances.
 *
 * Manages state synchronisation, capability detection, and control dispatch
 * for Midea commercial AC units.
 */
export class CommercialAirConditioner extends Device {
  /** Supported capability override keys for this device class. */
  protected static override _SUPPORTED_CAPABILITY_OVERRIDES: Record<
    string,
    [string, string]
  > = {
    min_target_temperature: ["_minTargetTemperature", "float"],
    max_target_temperature: ["_maxTargetTemperature", "float"],
    supported_modes: ["_supportedOpModes", "CcOperationalMode"],
    supported_swing_modes: ["_supportedSwingModes", "CcSwingMode"],
    supported_fan_speeds: ["_supportedFanSpeeds", "CcFanSpeed"],
    supported_aux_modes: ["_supportedAuxModes", "CcAuxHeatMode"],
    supported_purifier_modes: ["_supportedPurifierModes", "CcPurifierMode"],
    additional_capabilities: ["_capabilities", "CcCapability"],
  };

  // Basic controls
  private _powerState = false;
  private _targetTemperature = 17.0;
  private _targetHumidity = 40;

  private _operationalMode: CcOperationalMode | number =
    CC_OPERATIONAL_MODE_DEFAULT;
  private _fanSpeed: CcFanSpeed | number = CC_FAN_SPEED_DEFAULT;
  private _horizontalSwingAngle: CcSwingAngle | number =
    CC_SWING_ANGLE_DEFAULT;
  private _verticalSwingAngle: CcSwingAngle | number = CC_SWING_ANGLE_DEFAULT;

  private _eco = false;
  private _silent = false;
  private _sleep = false;
  private _purifier: CcPurifierMode | number = CC_PURIFIER_MODE_DEFAULT;
  private _auxMode: CcAuxHeatMode | number = CC_AUX_HEAT_MODE_DEFAULT;

  private _fahrenheit = false;

  // Sensors
  private _indoorTemperature: number | null = null;
  private _outdoorTemperature: number | null = null;
  private _indoorHumidity: number | null = null;

  private _updatedControls: Set<ControlId> = new Set();

  // Capabilities
  private _minTargetTemperature = 17;
  private _maxTargetTemperature = 30;

  private _capabilities = new CapabilityManager<number>(CC_CAPABILITY_DEFAULT);

  private _supportedOpModes: CcOperationalMode[] = listValues(
    CC_OPERATIONAL_MODE,
  ) as CcOperationalMode[];

  private _supportedSwingModes: CcSwingMode[] = listValues(
    CC_SWING_MODE,
  ) as CcSwingMode[];

  private _supportedFanSpeeds: (CcFanSpeed | number)[] = listValues(
    CC_FAN_SPEED,
  ) as CcFanSpeed[];

  private _supportedPurifierModes: CcPurifierMode[] = [
    CC_PURIFIER_MODE.OFF,
    CC_PURIFIER_MODE.ON,
    CC_PURIFIER_MODE.AUTO,
  ];

  private _supportedAuxModes: (CcAuxHeatMode | number)[] = listValues(
    CC_AUX_HEAT_MODE,
  ) as CcAuxHeatMode[];

  constructor(opts: {
    ip: string;
    port: number;
    deviceId: number;
    deviceType?: DeviceType;
    sn?: string | null;
    name?: string | null;
    version?: number | null;
  }) {
    super({
      ip: opts.ip,
      port: opts.port,
      deviceId: opts.deviceId,
      deviceType: opts.deviceType ?? DEVICE_TYPE.COMMERCIAL_AC,
      sn: opts.sn,
      name: opts.name,
      version: opts.version,
    });
  }

  // ── State update from responses ────────────────────────────────────

  private _updateState(res: Response): void {
    if (res instanceof QueryResponse) {
      console.debug(
        `Query response payload from device ${this.id}: ${res}`,
      );

      this._powerState = res.powerOn;

      this._targetTemperature = res.targetTemperature;
      this._indoorTemperature = res.indoorTemperature;
      this._outdoorTemperature = res.outdoorTemperature;
      this._fahrenheit = res.fahrenheit;
      this._targetHumidity = res.targetHumidity;
      this._indoorHumidity = res.indoorHumidity;

      this._operationalMode =
        getFromValue(CC_OPERATIONAL_MODE, res.operationalMode) ??
        CC_OPERATIONAL_MODE_DEFAULT;

      this._fanSpeed =
        getFromValue(CC_FAN_SPEED, res.fanSpeed) ?? CC_FAN_SPEED_DEFAULT;

      this._verticalSwingAngle =
        getFromValue(CC_SWING_ANGLE, res.vertSwingAngle) ??
        CC_SWING_ANGLE_DEFAULT;

      this._horizontalSwingAngle =
        getFromValue(CC_SWING_ANGLE, res.horzSwingAngle) ??
        CC_SWING_ANGLE_DEFAULT;

      this._eco = res.eco;
      this._silent = res.silent;
      this._sleep = res.sleep;

      this._purifier =
        getFromValue(CC_PURIFIER_MODE, res.purifier) ??
        CC_PURIFIER_MODE_DEFAULT;

      this._auxMode =
        getFromValue(CC_AUX_HEAT_MODE, res.auxMode) ??
        CC_AUX_HEAT_MODE_DEFAULT;
    } else {
      console.debug(
        `Ignored unknown response from device ${this.id}: ${res}`,
      );
    }
  }

  private _updateCapabilities(res: QueryResponse): void {
    this._minTargetTemperature = res.targetTemperatureMin;
    this._maxTargetTemperature = res.targetTemperatureMax;

    this._capabilities.set(
      CC_CAPABILITY.HUMIDITY as number,
      res.supportsHumidity,
    );

    // Build list of supported operation modes
    const opModeValues = new Set(
      Object.values(CC_OPERATIONAL_MODE) as number[],
    );
    if (res.supportedOpModes) {
      this._supportedOpModes = res.supportedOpModes
        .filter((mode) => opModeValues.has(mode))
        .map(
          (mode) =>
            getFromValue(CC_OPERATIONAL_MODE, mode)!,
        );
    }

    // Build list of supported fan speeds
    if (res.supportsFanSpeed) {
      this._supportedFanSpeeds = listValues(CC_FAN_SPEED) as CcFanSpeed[];
    } else {
      this._supportedFanSpeeds = [CC_FAN_SPEED.AUTO];
    }

    // Build list of supported swing modes
    const swingModes: CcSwingMode[] = [CC_SWING_MODE.OFF];
    if (res.supportsHorzSwingAngle) {
      swingModes.push(CC_SWING_MODE.HORIZONTAL);
    }
    if (res.supportsVertSwingAngle) {
      swingModes.push(CC_SWING_MODE.VERTICAL);
    }
    if (res.supportsHorzSwingAngle && res.supportsVertSwingAngle) {
      swingModes.push(CC_SWING_MODE.BOTH);
    }
    this._supportedSwingModes = swingModes;

    // If device can swing, it can control the angle
    this._capabilities.set(
      CC_CAPABILITY.SWING_HORIZONTAL_ANGLE as number,
      this._supportedSwingModes.includes(CC_SWING_MODE.HORIZONTAL),
    );
    this._capabilities.set(
      CC_CAPABILITY.SWING_VERTICAL_ANGLE as number,
      this._supportedSwingModes.includes(CC_SWING_MODE.VERTICAL),
    );

    this._capabilities.set(CC_CAPABILITY.ECO as number, res.supportsEco);
    this._capabilities.set(
      CC_CAPABILITY.SILENT as number,
      res.supportsSilent,
    );
    this._capabilities.set(CC_CAPABILITY.SLEEP as number, res.supportsSleep);

    // Build list of supported purifier modes
    const purifierModes: CcPurifierMode[] = [CC_PURIFIER_MODE.OFF];
    if (res.supportsPurifier) {
      purifierModes.push(CC_PURIFIER_MODE.ON);
    }
    if (res.supportsPurifierAuto) {
      purifierModes.push(CC_PURIFIER_MODE.AUTO);
    }
    this._supportedPurifierModes = purifierModes;

    // Build list of supported aux heating modes
    const auxModeValues = new Set(
      Object.values(CC_AUX_HEAT_MODE) as number[],
    );
    if (res.supportedAuxModes) {
      this._supportedAuxModes = res.supportedAuxModes
        .filter((mode) => auxModeValues.has(mode))
        .map(
          (mode) =>
            getFromValue(CC_AUX_HEAT_MODE, mode)!,
        );
    }
  }

  // ── Command sending ────────────────────────────────────────────────

  private async _sendCommandsGetResponses(
    commands: Command | Command[],
  ): Promise<Response[]> {
    const cmds = Array.isArray(commands) ? commands : [commands];
    const rawResponses: Uint8Array[] = [];

    for (const cmd of cmds) {
      const responses = await this._sendCommand(cmd);
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

    // Device is supported if we can process any response
    this._supported ||= this._online && validResponses.length > 0;

    return validResponses;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Fetch the device capabilities. */
  async getCapabilities(): Promise<void> {
    const cmd = new QueryCommand();
    const responses = await this._sendCommandsGetResponses(cmd);

    if (responses.length === 0) {
      console.error(
        `Failed to query capabilities from device ${this.id}.`,
      );
      return;
    }

    const response = responses[0]!;
    if (!(response instanceof QueryResponse)) {
      console.error(`Unexpected response from device ${this.id}.`);
      return;
    }

    console.debug(
      `Parsing capabilities from query response payload from device ${this.id}: ${response}`,
    );
    response.parseCapabilities();

    this._updateCapabilities(response);
  }

  /** Refresh the local copy of the device state by sending a query command. */
  override async refresh(): Promise<void> {
    const commands: Command[] = [];
    commands.push(new QueryCommand());

    const responses = await this._sendCommandsGetResponses(commands);

    for (const response of responses) {
      this._updateState(response);
    }
  }

  /** Apply the local state to the device. */
  override async apply(): Promise<void> {
    if (this._updatedControls.size === 0) {
      return;
    }

    // Warn if trying to apply unsupported modes
    if (
      this._updatedControls.has(CONTROL_ID.MODE) &&
      !this.supportedOperationModes.includes(
        this._operationalMode as CcOperationalMode,
      )
    ) {
      console.warn(
        `Device ${this.id} is not capable of operational mode ${this._operationalMode}.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.FAN_SPEED) &&
      !this.supportedFanSpeeds.includes(this._fanSpeed)
    ) {
      console.warn(
        `Device ${this.id} is not capable of fan speed ${this._fanSpeed}.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.ECO) &&
      this._eco &&
      !this.supportsEco
    ) {
      console.warn(
        `Device ${this.id} is not capable of eco preset.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.SILENT) &&
      this._silent &&
      !this.supportsSilent
    ) {
      console.warn(
        `Device ${this.id} is not capable of silent preset.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.SLEEP) &&
      this._sleep &&
      !this.supportsSleep
    ) {
      console.warn(
        `Device ${this.id} is not capable of sleep preset.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.PURIFIER) &&
      this._purifier !== CC_PURIFIER_MODE.OFF &&
      !this.supportedPurifierModes.includes(
        this._purifier as CcPurifierMode,
      )
    ) {
      console.warn(
        `Device ${this.id} is not capable of purifier mode ${this._purifier}.`,
      );
    }

    if (
      this._updatedControls.has(CONTROL_ID.AUX_MODE) &&
      this._auxMode !== CC_AUX_HEAT_MODE.OFF &&
      !this.supportedAuxModes.includes(this._auxMode)
    ) {
      console.warn(
        `Device ${this.id} is not capable of aux mode ${this._auxMode}.`,
      );
    }

    // Get current state of updated controls
    const controlMapKeys = new Set(
      Object.keys(CONTROL_MAP).map(Number),
    );
    const controls = new Map<ControlId, number | boolean>();
    for (const controlId of this._updatedControls) {
      if (controlMapKeys.has(controlId)) {
        controls.set(controlId, CONTROL_MAP[controlId]!(this));
      }
    }

    // If powering off device, only send the power control
    const cmds: Command[] = [];
    if (controls.get(CONTROL_ID.POWER) === false) {
      if (controls.size > 1) {
        const dropped: Record<number, number | boolean> = {};
        for (const [k, v] of controls) {
          if (k !== CONTROL_ID.POWER) dropped[k] = v;
        }
        console.warn(
          `Device ${this.id} powering off. Dropped additional control updates:`,
          dropped,
        );
      }
      cmds.push(
        new ControlCommand(
          new Map<ControlId, number | boolean>([
            [CONTROL_ID.POWER, false],
          ]),
        ),
      );
    } else {
      cmds.push(new ControlCommand(controls));
    }

    // Process any state responses from the device
    for (const response of await this._sendCommandsGetResponses(cmds)) {
      this._updateState(response);
    }

    // Clear controls
    this._updatedControls.clear();
  }

  // ── Properties ─────────────────────────────────────────────────────

  /** Get the power state. */
  get powerState(): boolean {
    return this._powerState;
  }

  /** Set the power state. */
  set powerState(state: boolean) {
    this._powerState = state;
    this._updatedControls.add(CONTROL_ID.POWER);
  }

  /** Get the minimum target temperature. */
  get minTargetTemperature(): number {
    return this._minTargetTemperature;
  }

  /** Get the maximum target temperature. */
  get maxTargetTemperature(): number {
    return this._maxTargetTemperature;
  }

  /** Get the target temperature. */
  get targetTemperature(): number {
    return this._targetTemperature;
  }

  /** Set the target temperature (in Celsius). */
  set targetTemperature(temperatureCelsius: number) {
    this._targetTemperature = temperatureCelsius;
    this._updatedControls.add(CONTROL_ID.TARGET_TEMPERATURE);
  }

  /** Get the indoor temperature. */
  get indoorTemperature(): number | null {
    return this._indoorTemperature;
  }

  /** Get the outdoor temperature. */
  get outdoorTemperature(): number | null {
    return this._outdoorTemperature;
  }

  /** Get whether Fahrenheit mode is active. */
  get fahrenheit(): boolean {
    return this._fahrenheit;
  }

  /** Set whether Fahrenheit mode is active. */
  set fahrenheit(enabled: boolean) {
    this._fahrenheit = enabled;
    this._updatedControls.add(CONTROL_ID.TEMPERATURE_UNIT);
  }

  /** Whether the device supports humidity. */
  get supportsHumidity(): boolean {
    return this._capabilities.has(CC_CAPABILITY.HUMIDITY as number);
  }

  /** Get the target humidity. */
  get targetHumidity(): number {
    return this._targetHumidity;
  }

  /** Set the target humidity. */
  set targetHumidity(humidity: number) {
    this._targetHumidity = humidity;
    this._updatedControls.add(CONTROL_ID.TARGET_HUMIDITY);
  }

  /** Get the indoor humidity. */
  get indoorHumidity(): number | null {
    return this._indoorHumidity;
  }

  /** Get supported operation modes. */
  get supportedOperationModes(): CcOperationalMode[] {
    return this._supportedOpModes;
  }

  /** Get the current operational mode. */
  get operationalMode(): CcOperationalMode | number {
    return this._operationalMode;
  }

  /** Set the operational mode. */
  set operationalMode(mode: CcOperationalMode | number) {
    this._operationalMode = mode;
    this._updatedControls.add(CONTROL_ID.MODE);
  }

  /** Get supported fan speeds. */
  get supportedFanSpeeds(): (CcFanSpeed | number)[] {
    return this._supportedFanSpeeds;
  }

  /** Get the current fan speed. */
  get fanSpeed(): CcFanSpeed | number {
    return this._fanSpeed;
  }

  /** Set the fan speed. */
  set fanSpeed(speed: CcFanSpeed | number) {
    if (typeof speed === "number" && !Number.isInteger(speed)) {
      speed = Math.trunc(speed);
    }
    this._fanSpeed = speed;
    this._updatedControls.add(CONTROL_ID.FAN_SPEED);
  }

  /** Get supported swing modes. */
  get supportedSwingModes(): CcSwingMode[] {
    return this._supportedSwingModes;
  }

  /** Get the current swing mode (computed from swing angles). */
  get swingMode(): CcSwingMode {
    let mode: number = CC_SWING_MODE.OFF;

    if (this._horizontalSwingAngle === CC_SWING_ANGLE.AUTO) {
      mode |= CC_SWING_MODE.HORIZONTAL;
    }

    if (this._verticalSwingAngle === CC_SWING_ANGLE.AUTO) {
      mode |= CC_SWING_MODE.VERTICAL;
    }

    return mode as CcSwingMode;
  }

  /** Set the swing mode (updates horizontal/vertical swing angles accordingly). */
  set swingMode(mode: CcSwingMode) {
    const getAngle = (
      swing: number,
      enumVal: number,
      state: CcSwingAngle | number,
    ): CcSwingAngle | null => {
      if (swing & enumVal) {
        return CC_SWING_ANGLE.AUTO;
      } else if (state === CC_SWING_ANGLE.AUTO) {
        return CC_SWING_ANGLE_DEFAULT;
      }
      return null;
    };

    const horzAngle = getAngle(
      mode,
      CC_SWING_MODE.HORIZONTAL,
      this._horizontalSwingAngle,
    );
    if (horzAngle !== null) {
      this._horizontalSwingAngle = horzAngle;
      this._updatedControls.add(CONTROL_ID.HORZ_SWING_ANGLE);
    }

    const vertAngle = getAngle(
      mode,
      CC_SWING_MODE.VERTICAL,
      this._verticalSwingAngle,
    );
    if (vertAngle !== null) {
      this._verticalSwingAngle = vertAngle;
      this._updatedControls.add(CONTROL_ID.VERT_SWING_ANGLE);
    }
  }

  /** Whether horizontal swing angle control is supported. */
  get supportsHorizontalSwingAngle(): boolean {
    return this._capabilities.has(
      CC_CAPABILITY.SWING_HORIZONTAL_ANGLE as number,
    );
  }

  /** Get the current horizontal swing angle. */
  get horizontalSwingAngle(): CcSwingAngle | number {
    return this._horizontalSwingAngle;
  }

  /** Set the horizontal swing angle. */
  set horizontalSwingAngle(angle: CcSwingAngle | number) {
    this._horizontalSwingAngle = angle;
    this._updatedControls.add(CONTROL_ID.HORZ_SWING_ANGLE);
  }

  /** Whether vertical swing angle control is supported. */
  get supportsVerticalSwingAngle(): boolean {
    return this._capabilities.has(
      CC_CAPABILITY.SWING_VERTICAL_ANGLE as number,
    );
  }

  /** Get the current vertical swing angle. */
  get verticalSwingAngle(): CcSwingAngle | number {
    return this._verticalSwingAngle;
  }

  /** Set the vertical swing angle. */
  set verticalSwingAngle(angle: CcSwingAngle | number) {
    this._verticalSwingAngle = angle;
    this._updatedControls.add(CONTROL_ID.VERT_SWING_ANGLE);
  }

  /** Whether eco preset is supported. */
  get supportsEco(): boolean {
    return this._capabilities.has(CC_CAPABILITY.ECO as number);
  }

  /** Get the eco state. */
  get eco(): boolean {
    return this._eco;
  }

  /** Set the eco state. */
  set eco(enabled: boolean) {
    this._eco = enabled;
    this._updatedControls.add(CONTROL_ID.ECO);
  }

  /** Whether silent preset is supported. */
  get supportsSilent(): boolean {
    return this._capabilities.has(CC_CAPABILITY.SILENT as number);
  }

  /** Get the silent state. */
  get silent(): boolean {
    return this._silent;
  }

  /** Set the silent state. */
  set silent(enabled: boolean) {
    this._silent = enabled;
    this._updatedControls.add(CONTROL_ID.SILENT);
  }

  /** Whether sleep preset is supported. */
  get supportsSleep(): boolean {
    return this._capabilities.has(CC_CAPABILITY.SLEEP as number);
  }

  /** Get the sleep state. */
  get sleep(): boolean {
    return this._sleep;
  }

  /** Set the sleep state. */
  set sleep(enabled: boolean) {
    this._sleep = enabled;
    this._updatedControls.add(CONTROL_ID.SLEEP);
  }

  /** Get supported purifier modes. */
  get supportedPurifierModes(): CcPurifierMode[] {
    return this._supportedPurifierModes;
  }

  /** Get the current purifier mode. */
  get purifier(): CcPurifierMode | number {
    return this._purifier;
  }

  /** Set the purifier mode. */
  set purifier(mode: CcPurifierMode | number) {
    this._purifier = mode;
    this._updatedControls.add(CONTROL_ID.PURIFIER);
  }

  /** Get supported aux heat modes. */
  get supportedAuxModes(): (CcAuxHeatMode | number)[] {
    return this._supportedAuxModes;
  }

  /** Get the current aux heat mode. */
  get auxMode(): CcAuxHeatMode | number {
    return this._auxMode;
  }

  /** Set the aux heat mode. */
  set auxMode(mode: CcAuxHeatMode | number) {
    this._auxMode = mode;
    this._updatedControls.add(CONTROL_ID.AUX_MODE);
  }

  // ── Serialization ──────────────────────────────────────────────────

  /** Return a dictionary representation of the device state. */
  override toDict(): Record<string, unknown> {
    return {
      ...super.toDict(),
      power: this.powerState,
      target_temperature: this.targetTemperature,
      indoor_temperature: this.indoorTemperature,
      outdoor_temperature: this.outdoorTemperature,
      fahrenheit: this.fahrenheit,
      target_humidity: this.targetHumidity,
      indoor_humidity: this.indoorHumidity,
      mode: this.operationalMode,
      fan_speed: this.fanSpeed,
      swing_mode: this.swingMode,
      horizontal_swing_angle: this.horizontalSwingAngle,
      vertical_swing_angle: this.verticalSwingAngle,
      eco: this.eco,
      silent: this.silent,
      sleep: this.sleep,
      purifier: this.purifier,
      aux_mode: this.auxMode,
    };
  }

  /** Return a dictionary of device capabilities. */
  override capabilitiesDict(): Record<string, unknown> {
    return {
      min_target_temperature: this.minTargetTemperature,
      max_target_temperature: this.maxTargetTemperature,
      supported_modes: this.supportedOperationModes,
      supported_swing_modes: this.supportedSwingModes,
      supported_fan_speeds: this.supportedFanSpeeds,
      supported_aux_modes: this.supportedAuxModes,
      supported_purifier_modes: this.supportedPurifierModes,
      additional_capabilities: this._capabilities.flags,
    };
  }
}
