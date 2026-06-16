/**
 * Tests for AC command and response classes.
 *
 * Ported from python/msmart/device/AC/test_command.py
 */

import { describe, it, expect } from 'bun:test';

import { DEVICE_TYPE, FRAME_TYPE } from '../src/const.ts';
import { Frame, InvalidFrameError } from '../src/frame.ts';
import {
  CAPABILITY_ID,
  PROPERTY_ID,
  CapabilitiesResponse,
  Command,
  EnergyUsageResponse,
  GetCapabilitiesCommand,
  GetPropertiesCommand,
  GetStateCommand,
  Group5Response,
  InvalidResponseError,
  PropertiesResponse,
  Response,
  SetPropertiesCommand,
  StateResponse,
  decodeProperty,
  encodeProperty,
} from '../src/device/ac/command.ts';
import type { PropertyId } from '../src/device/ac/command.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a response from a full frame and assert it exists.
 */
function buildResponse(msg: Uint8Array): Response {
  const resp = Response.construct(msg);
  expect(resp).not.toBeNull();
  return resp;
}

// ---------------------------------------------------------------------------
// TestCommand
// ---------------------------------------------------------------------------

describe('TestCommand', () => {
  it('should frame a command properly', () => {
    // NOTE: The Python test sets Command._message_id = 0x10 to get a
    // deterministic message ID. In the TS port, messageId is a module-level
    // counter that we can't easily reset. Instead we validate the frame
    // structurally.

    // Build frame from command
    const command = new GetStateCommand();
    const frame = command.toBytes();
    expect(frame).not.toBeNull();

    // Assert that frame is valid
    Frame.validate(frame, DEVICE_TYPE.AIR_CONDITIONER);

    // Extract payload (frame[10..-1])
    const payload = frame.subarray(10, frame.length - 1);

    // Check the first byte of the payload is the state request ID
    expect(payload[0]).toBe(0x41);

    // Check length byte
    expect(frame[1]).toBe(payload.length + 10); // HEADER_LENGTH = 10

    // Check device type
    expect(frame[2]).toBe(DEVICE_TYPE.AIR_CONDITIONER);

    // Check frame type
    expect(frame[9]).toBe(FRAME_TYPE.QUERY);
  });
});

// ---------------------------------------------------------------------------
// TestStateResponse
// ---------------------------------------------------------------------------

describe('TestStateResponse', () => {
  // Attributes expected in state response objects
  const EXPECTED_KEYS: (keyof StateResponse)[] = [
    'powerOn',
    'targetTemperature',
    'operationalMode',
    'fanSpeed',
    'swingMode',
    'turbo',
    'eco',
    'sleep',
    'fahrenheit',
    'indoorTemperature',
    'outdoorTemperature',
    'filterAlert',
    'displayOn',
    'freezeProtection',
    'followMe',
    'purifier',
    'targetHumidity',
    'auxHeat',
    'independentAuxHeat',
    'errorCode',
  ];

  function testResponse(msg: Uint8Array): StateResponse {
    const resp = buildResponse(msg);
    // Check attributes exist
    for (const key of EXPECTED_KEYS) {
      expect(key in resp).toBe(true);
    }
    return resp as StateResponse;
  }

  it('should decode message with checksum as CRC (V3, shorter than expected)', () => {
    // https://github.com/mill1000/midea-ac-py/issues/11#issuecomment-1650647625
    const msg = Buffer.from(
      'aa1eac00000000000003c0004b1e7f7f000000000069630000000000000d33',
      'hex',
    );
    const resp = testResponse(msg);

    expect(resp).toBeInstanceOf(StateResponse);
    expect(resp.targetTemperature).toBe(27.0);
    expect(resp.indoorTemperature).toBe(27.5);
    expect(resp.outdoorTemperature).toBe(24.5);
  });

  it('should decode V2 state response', () => {
    const msg = Buffer.from(
      'aa22ac00000000000303c0014566000000300010045eff00000000000000000069fdb9',
      'hex',
    );
    const resp = testResponse(msg);

    expect(resp).toBeInstanceOf(StateResponse);
    expect(resp.targetTemperature).toBe(21.0);
    expect(resp.indoorTemperature).toBe(22.0);
    expect(resp.outdoorTemperature).toBeNull();
  });

  it('should decode V3 state response', () => {
    const msg = Buffer.from(
      'aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79',
      'hex',
    );
    const resp = testResponse(msg);

    expect(resp).toBeInstanceOf(StateResponse);
    expect(resp.targetTemperature).toBe(21.0);
    expect(resp.indoorTemperature).toBe(21.0);
    expect(resp.outdoorTemperature).toBe(28.5);
  });

  it('should decode temperatures with additional precision from full messages', () => {
    const TEST_MESSAGES: [number, number, number, string][] = [
      // [target, indoor, outdoor, hex]
      [24.0, 24.6, 9.5, 'aa23ac00000000000203c00188647f7f000000000063450c0056190000000000000497c3'],
      [24.0, 26.5, 9.7, 'aa23ac00000000000203c00188647f7f000000000067450c00750000000000000001a3b0'],
      [24.0, 25.0, 9.5, 'aa23ac00000000000203c00188647f7f000080000064450c00501d00000000000001508e'],
    ];

    for (const [target, indoor, outdoor, hex] of TEST_MESSAGES) {
      const resp = testResponse(Buffer.from(hex, 'hex'));
      expect(resp).toBeInstanceOf(StateResponse);
      expect(resp.targetTemperature).toBe(target);
      expect(resp.indoorTemperature).toBe(indoor);
      expect(resp.outdoorTemperature).toBe(outdoor);
    }
  });

  it('should decode temperatures with additional precision from raw payloads', () => {
    const TEST_RESPONSES: [number, number, number, string][] = [
      // [target, indoor, outdoor, hex]
      [16.0, 23.2, 18.4, 'c00181667f7f003c00000060560400420000000000000048'],
      [16.5, 23.4, 18.4, 'c00191667f7f003c00000060560400440000000000000049'],
      [17.0, 23.6, 18.3, 'c00181667f7f003c0000006156050036000000000000004a'],
      [17.5, 23.8, 18.2, 'c00191667f7f003c0000006156050028000000000000004b'],
      [18.0, 23.8, 18.2, 'c00182667f7f003c0000006156060028000000000000004c'],
      [18.5, 23.8, 18.2, 'c00192667f7f003c0000006156060028000000000000004d'],
      [19.0, 23.8, 18.2, 'c00183667f7f003c0000006156070028000000000000004e'],
      [19.5, 23.5, 18.5, 'c00193667f7f003c00000061570700550000000000000050'],
    ];

    for (const [target, indoor, outdoor, hex] of TEST_RESPONSES) {
      const payload = Buffer.from(hex, 'hex');
      const resp = new StateResponse(payload);
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(StateResponse);
      expect(resp.targetTemperature).toBe(target);
      expect(resp.indoorTemperature).toBe(indoor);
      expect(resp.outdoorTemperature).toBe(outdoor);
    }
  });

  it('should decode target temperature from various payloads', () => {
    // Note: In Python dict, duplicate keys override earlier ones.
    // 16.0 and 16.5 are redefined by Midea U-Shaped entries, so we test the last values.
    const TEST_PAYLOADS: [number, string][] = [
      // Midea U-Shaped (overrides earlier 16.0/16.5)
      [16.0, 'c00040660000003c00000062680400000000000000000004'],
      [16.5, 'c00050660000003c00000062670400000000000000000004'],
    ];

    for (const [target, hex] of TEST_PAYLOADS) {
      const payload = Buffer.from(hex, 'hex');
      const resp = new StateResponse(payload);
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(StateResponse);
      expect(resp.targetTemperature).toBe(target);
    }
  });
});

// ---------------------------------------------------------------------------
// TestCapabilitiesResponse
// ---------------------------------------------------------------------------

describe('TestCapabilitiesResponse', () => {
  // Expected attributes on CapabilitiesResponse
  const EXPECTED_ATTRS = [
    'anion',
    'fanSilent', 'fanLow', 'fanMedium', 'fanHigh', 'fanAuto', 'fanCustom',
    'breezeAway', 'breezeControl', 'breezeless', 'cascade',
    'swingHorizontalAngle', 'swingVerticalAngle',
    'swingHorizontal', 'swingVertical', 'swingBoth',
    'dryMode', 'coolMode', 'heatMode', 'autoMode',
    'auxHeatMode', 'auxMode', 'auxElectricHeat',
    'eco', 'ieco', 'turbo', 'freezeProtection',
    'displayControl', 'filterReminder',
    'minTemperature', 'maxTemperature',
    'energyStats', 'humidity', 'targetHumidity', 'selfClean',
    'rateSelectLevels', 'outSilent',
  ] as const;

  it('should have expected properties', () => {
    // Construct from a dummy payload with no caps
    const data = Buffer.from([0xb5, 0x00]);
    const resp = new CapabilitiesResponse(data);
    expect(resp).not.toBeNull();

    // Check that the object has all the expected properties
    for (const attr of EXPECTED_ATTRS) {
      expect(attr in resp).toBe(true);
    }
  });

  it('should parse generic capabilities parsers (bool, get_value)', () => {
    function buildCapabilityResponse(cap: number, value: number): CapabilitiesResponse {
      const buf = Buffer.alloc(6);
      buf[0] = 0xba;
      buf[1] = 0x01;
      buf.writeUint16LE(cap, 2);
      buf[4] = 0x01; // size
      buf[5] = value;
      return new CapabilitiesResponse(buf);
    }

    // Test BREEZELESS capability which uses a get_value parser. e.g. X == 1
    expect(buildCapabilityResponse(CAPABILITY_ID.BREEZELESS, 0).rawCapabilities.get('breezeless')).toBe(false);
    expect(buildCapabilityResponse(CAPABILITY_ID.BREEZELESS, 1).rawCapabilities.get('breezeless')).toBe(true);
    expect(buildCapabilityResponse(CAPABILITY_ID.BREEZELESS, 100).rawCapabilities.get('breezeless')).toBe(false);

    // Test PRESET_ECO capability which uses an array parser
    expect(buildCapabilityResponse(CAPABILITY_ID.PRESET_ECO, 0).rawCapabilities.get('eco')).toBe(false);
    expect(buildCapabilityResponse(CAPABILITY_ID.PRESET_ECO, 1).rawCapabilities.get('eco')).toBe(true);
    expect(buildCapabilityResponse(CAPABILITY_ID.PRESET_ECO, 2).rawCapabilities.get('eco')).toBe(true);

    // Test PRESET_TURBO capability which uses 2 custom parsers
    let resp = buildCapabilityResponse(CAPABILITY_ID.PRESET_TURBO, 0);
    expect(resp.rawCapabilities.get('turbo_heat')).toBe(false);
    expect(resp.rawCapabilities.get('turbo_cool')).toBe(true);

    resp = buildCapabilityResponse(CAPABILITY_ID.PRESET_TURBO, 1);
    expect(resp.rawCapabilities.get('turbo_heat')).toBe(true);
    expect(resp.rawCapabilities.get('turbo_cool')).toBe(true);

    resp = buildCapabilityResponse(CAPABILITY_ID.PRESET_TURBO, 3);
    expect(resp.rawCapabilities.get('turbo_heat')).toBe(true);
    expect(resp.rawCapabilities.get('turbo_cool')).toBe(false);

    resp = buildCapabilityResponse(CAPABILITY_ID.PRESET_TURBO, 4);
    expect(resp.rawCapabilities.get('turbo_heat')).toBe(false);
    expect(resp.rawCapabilities.get('turbo_cool')).toBe(false);
  });

  it('should decode capabilities response (test 1)', () => {
    // https://github.com/mill1000/midea-ac-py/issues/13#issuecomment-1657485359
    const msg = Buffer.from(
      'aa29ac00000000000303b5071202010113020101140201011502010116020101170201001a020101dedb',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    const EXPECTED_RAW: Record<string, unknown> = {
      eco: true,
      freeze_protection: true, heat_mode: true,
      cool_mode: true, dry_mode: true,
      aux_heat_mode: false, aux_mode: false,
      auto_mode: true,
      swing_horizontal: true, swing_vertical: true,
      energy_stats: false, energy_setting: false, energy_bcd: false,
      filter_notice: false, filter_clean: false,
      turbo_heat: true, turbo_cool: true,
    };
    expect(Object.fromEntries(resp.rawCapabilities)).toEqual(EXPECTED_RAW);

    // Check capabilities properties
    expect(resp.anion).toBe(false);
    expect(resp.fanSilent).toBe(false);
    expect(resp.fanLow).toBe(true);
    expect(resp.fanMedium).toBe(true);
    expect(resp.fanHigh).toBe(true);
    expect(resp.fanAuto).toBe(true);
    expect(resp.fanCustom).toBe(false);
    expect(resp.breezeAway).toBe(false);
    expect(resp.breezeControl).toBe(false);
    expect(resp.breezeless).toBe(false);
    expect(resp.cascade).toBe(false);
    expect(resp.swingHorizontalAngle).toBe(false);
    expect(resp.swingVerticalAngle).toBe(false);
    expect(resp.swingHorizontal).toBe(true);
    expect(resp.swingVertical).toBe(true);
    expect(resp.swingBoth).toBe(true);
    expect(resp.dryMode).toBe(true);
    expect(resp.coolMode).toBe(true);
    expect(resp.heatMode).toBe(true);
    expect(resp.autoMode).toBe(true);
    expect(resp.auxHeatMode).toBe(false);
    expect(resp.auxMode).toBe(false);
    expect(resp.auxElectricHeat).toBe(false);
    expect(resp.eco).toBe(true);
    expect(resp.ieco).toBe(false);
    expect(resp.turbo).toBe(true);
    expect(resp.freezeProtection).toBe(true);
    expect(resp.displayControl).toBe(false);
    expect(resp.filterReminder).toBe(false);
    expect(resp.minTemperature).toBe(16.0);
    expect(resp.maxTemperature).toBe(30.0);
    expect(resp.energyStats).toBe(false);
    expect(resp.humidity).toBe(false);
    expect(resp.targetHumidity).toBe(false);
    expect(resp.selfClean).toBe(false);
    expect(resp.rateSelectLevels).toBeNull();
    expect(resp.outSilent).toBe(false);

    // Check if there are additional capabilities
    expect(resp.additionalCapabilities).toBe(false);
  });

  it('should decode capabilities response (test 2)', () => {
    // https://github.com/mac-zhou/midea-ac-py/pull/177#issuecomment-1259772244
    const msg = Buffer.from(
      'aa3dac00000000000203b50a12020101180001001402010115020101160201001a020101100201011f020100250207203c203c203c00400001000100c83a',
      'hex',
    );
    // This message includes unknown capability 0x40 – the TS code silently skips it
    const resp = buildResponse(msg) as CapabilitiesResponse;

    const EXPECTED_RAW: Record<string, unknown> = {
      eco: true, breezeless: false,
      heat_mode: true, cool_mode: true, dry_mode: true,
      aux_heat_mode: false, aux_mode: false,
      auto_mode: true, swing_horizontal: true, swing_vertical: true,
      energy_stats: false, energy_setting: false, energy_bcd: false,
      turbo_heat: true, turbo_cool: true,
      fan_custom: true, fan_silent: false, fan_low: false,
      fan_medium: false, fan_high: false, fan_auto: false,
      humidity_auto_set: false, humidity_manual_set: false,
      cool_min_temperature: 16.0, cool_max_temperature: 30.0,
      auto_min_temperature: 16.0, auto_max_temperature: 30.0,
      heat_min_temperature: 16.0, heat_max_temperature: 30.0,
      decimals: false,
    };
    expect(Object.fromEntries(resp.rawCapabilities)).toEqual(EXPECTED_RAW);

    // Check capabilities properties
    expect(resp.fanSilent).toBe(true); // fan_custom enables all fan speeds
    expect(resp.fanLow).toBe(true);
    expect(resp.fanMedium).toBe(true);
    expect(resp.fanHigh).toBe(true);
    expect(resp.fanAuto).toBe(true);
    expect(resp.fanCustom).toBe(true);
    expect(resp.swingBoth).toBe(true);
    expect(resp.eco).toBe(true);
    expect(resp.turbo).toBe(true);
    expect(resp.freezeProtection).toBe(false);
    expect(resp.minTemperature).toBe(16.0);
    expect(resp.maxTemperature).toBe(30.0);

    // Check if there are additional capabilities
    expect(resp.additionalCapabilities).toBe(true);
  });

  it('should decode capabilities response (test 3 - Toshiba Smart Window)', () => {
    const msg = Buffer.from(
      'aa29ac00000000000303b507120201021402010015020102170201021a0201021002010524020101990d',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    const EXPECTED_RAW: Record<string, unknown> = {
      eco: true, heat_mode: false,
      cool_mode: true, dry_mode: true, auto_mode: true,
      aux_heat_mode: false, aux_mode: false,
      swing_horizontal: false, swing_vertical: false,
      filter_notice: true, filter_clean: false, turbo_heat: false,
      turbo_cool: false,
      fan_custom: false, fan_silent: false, fan_low: true,
      fan_medium: true, fan_high: true, fan_auto: true,
      display_control: true,
    };
    expect(Object.fromEntries(resp.rawCapabilities)).toEqual(EXPECTED_RAW);

    // Check capabilities properties
    expect(resp.fanSilent).toBe(false);
    expect(resp.fanLow).toBe(true);
    expect(resp.swingHorizontal).toBe(false);
    expect(resp.swingVertical).toBe(false);
    expect(resp.swingBoth).toBe(false);
    expect(resp.heatMode).toBe(false);
    expect(resp.turbo).toBe(false);
    expect(resp.displayControl).toBe(true);
    expect(resp.filterReminder).toBe(true);

    expect(resp.additionalCapabilities).toBe(false);
  });

  it('should decode capabilities response (test 4 - Midea U-shaped Window)', () => {
    const msg = Buffer.from(
      'aa39ac00000000000303b50912020102130201001402010015020100170201021a02010010020101250207203c203c203c00240201010102a1a0',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.eco).toBe(true);
    expect(resp.heatMode).toBe(false);
    expect(resp.coolMode).toBe(true);
    expect(resp.swingVertical).toBe(true);
    expect(resp.swingHorizontal).toBe(false);
    expect(resp.turbo).toBe(true);
    expect(resp.fanCustom).toBe(true);
    expect(resp.displayControl).toBe(true);
    expect(resp.filterReminder).toBe(true);
    expect(resp.minTemperature).toBe(16.0);
    expect(resp.maxTemperature).toBe(30.0);

    expect(resp.additionalCapabilities).toBe(true);
  });

  it('should decode and merge additional capabilities', () => {
    // https://github.com/mill1000/midea-ac-py/issues/60#issuecomment-1867498321
    const msg = Buffer.from(
      'aa3dac00000000000303b50a12020101430001011402010115020101160201001a020101100201011f020103250207203c203c203c05400001000100c805',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.rawCapabilities.get('eco')).toBe(true);
    expect(resp.rawCapabilities.get('breeze_control')).toBe(true);
    expect(resp.rawCapabilities.get('decimals')).toBe(true);
    expect(resp.additionalCapabilities).toBe(true);

    // Additional capabilities response
    const additionalMsg = Buffer.from(
      'aa23ac00000000000303b5051e020101130201012202010019020100390001010000febe',
      'hex',
    );
    const additionalResp = buildResponse(additionalMsg) as CapabilitiesResponse;

    const EXPECTED_ADDITIONAL: Record<string, unknown> = {
      freeze_protection: true,
      fahrenheit: true,
      aux_electric_heat: false,
      self_clean: true,
      anion: true,
    };
    expect(Object.fromEntries(additionalResp.rawCapabilities)).toEqual(EXPECTED_ADDITIONAL);
    expect(additionalResp.additionalCapabilities).toBe(false);

    // Merge
    resp.merge(additionalResp);

    // Check merged capabilities
    expect(resp.anion).toBe(true);
    expect(resp.eco).toBe(true);
    expect(resp.breezeControl).toBe(true);
    expect(resp.freezeProtection).toBe(true);
    expect(resp.selfClean).toBe(true);
    expect(resp.humidity).toBe(true);
    expect(resp.targetHumidity).toBe(true);
    expect(resp.turbo).toBe(true);
    expect(resp.swingBoth).toBe(true);
    expect(resp.minTemperature).toBe(16.0);
    expect(resp.maxTemperature).toBe(30.0);
  });

  it('should decode capabilities with aux heat', () => {
    // https://github.com/mill1000/midea-ac-py/issues/297#issuecomment-2622720960
    const msg = Buffer.from(
      'aa29ac00000000000303b50514020109150201021a020101250207203c203c203c003402010101007b1d',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.rawCapabilities.get('aux_heat_mode')).toBe(true);
    expect(resp.rawCapabilities.get('aux_mode')).toBe(true);
    expect(resp.additionalCapabilities).toBe(true);

    // Additional capabilities response
    const additionalMsg = Buffer.from(
      'aa2fac00000000000303b508100201051f020100300001001302010019020101390001009300010194000101000095ca',
      'hex',
    );
    const additionalResp = buildResponse(additionalMsg) as CapabilitiesResponse;
    expect(additionalResp.rawCapabilities.get('aux_electric_heat')).toBe(true);
    expect(additionalResp.additionalCapabilities).toBe(false);

    resp.merge(additionalResp);

    expect(resp.auxHeatMode).toBe(true);
    expect(resp.auxMode).toBe(true);
    expect(resp.auxElectricHeat).toBe(true);
  });

  it('should decode capabilities with jet cool', () => {
    // https://github.com/mill1000/midea-ac-py/issues/343#issuecomment-2864149742
    const msg = Buffer.from(
      'aa39ac00000000000303b5091202010214020100150201001e020100170201021a02010210020101250207203c203c203c002402010101019b9a',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.rawCapabilities.get('anion')).toBe(false);
    expect(resp.rawCapabilities.get('turbo_heat')).toBe(false);
    expect(resp.rawCapabilities.get('turbo_cool')).toBe(false);
    expect(resp.additionalCapabilities).toBe(true);

    // Additional capabilities response
    const additionalMsg = Buffer.from(
      'aa27ac00000000000303b5051f0201002c020101670001011602010451000101e30001010004f564',
      'hex',
    );
    const additionalResp = buildResponse(additionalMsg) as CapabilitiesResponse;
    expect(additionalResp.rawCapabilities.get('jet_cool')).toBe(true);
    expect(additionalResp.additionalCapabilities).toBe(false);

    resp.merge(additionalResp);

    expect(resp.jetCool).toBe(true);
    expect(resp.energyStats).toBe(true);
    expect(resp.turbo).toBe(false);
  });

  it('should decode capabilities with cascade', () => {
    // https://github.com/mill1000/midea-ac-py/issues/359#issuecomment-3028509967
    const msg = Buffer.from(
      'aa3dac00000000000303b50a12020101430001001402010115020101160201001a020101100201011f020103250207203c203c203c05400001000100e1ed',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.rawCapabilities.get('breeze_control')).toBe(false);
    expect(resp.rawCapabilities.get('eco')).toBe(true);
    expect(resp.additionalCapabilities).toBe(true);

    // Additional capabilities response
    const additionalMsg = Buffer.from(
      'aa3bac00000000000303b50a1e02010113020101220201001902010039000101580001024200010159000101090001010a000101000000000000cfbf',
      'hex',
    );
    const additionalResp = buildResponse(additionalMsg) as CapabilitiesResponse;

    expect(additionalResp.rawCapabilities.get('cascade')).toBe(true);
    expect(additionalResp.rawCapabilities.get('breeze_away')).toBe(true);
    expect(additionalResp.rawCapabilities.get('swing_horizontal_angle')).toBe(true);
    expect(additionalResp.rawCapabilities.get('swing_vertical_angle')).toBe(true);
    expect(additionalResp.additionalCapabilities).toBe(false);

    resp.merge(additionalResp);

    expect(resp.cascade).toBe(true);
    expect(resp.breezeAway).toBe(true);
    expect(resp.swingHorizontalAngle).toBe(true);
    expect(resp.swingVerticalAngle).toBe(true);
    expect(resp.eco).toBe(true);
    expect(resp.freezeProtection).toBe(true);
    expect(resp.selfClean).toBe(true);
    expect(resp.humidity).toBe(true);
    expect(resp.targetHumidity).toBe(true);
  });

  it('should decode OUT_SILENT capability from PortaSplit payload', () => {
    const msg = Buffer.from(
      'aa2fac00000000000803b5081f0201002c020101160201043900010151000101e300010113020101cd0001030002365b',
      'hex',
    );
    const resp = buildResponse(msg) as CapabilitiesResponse;

    expect(resp.rawCapabilities.has('out_silent')).toBe(true);
    expect(resp.outSilent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TestGetPropertiesCommand
// ---------------------------------------------------------------------------

describe('TestGetPropertiesCommand', () => {
  it('should encode properties payload correctly', () => {
    const PROPS: PropertyId[] = [PROPERTY_ID.INDOOR_HUMIDITY, PROPERTY_ID.SWING_UD_ANGLE];

    // Build command
    const command = new GetPropertiesCommand(PROPS);
    const frame = command.toBytes();
    const payload = frame.subarray(10, frame.length - 1);

    // Assert payload header looks correct
    expect(payload[0]).toBe(0xb1);
    expect(payload[1]).toBe(PROPS.length);

    // Assert that property ID was packed correctly (little-endian)
    expect(payload[2]).toBe(PROPERTY_ID.INDOOR_HUMIDITY & 0xff);
    expect(payload[3]).toBe((PROPERTY_ID.INDOOR_HUMIDITY >> 8) & 0xff);
  });
});

// ---------------------------------------------------------------------------
// TestSetPropertiesCommand
// ---------------------------------------------------------------------------

describe('TestSetPropertiesCommand', () => {
  it('should encode property values to bytes correctly', () => {
    // Test encode for various properties
    const TEST_ENCODES: [PropertyId, unknown, number[]][] = [
      // Breeze away: 0x02 - On, 0x01 - Off
      [PROPERTY_ID.BREEZE_AWAY, true, [0x02]],
      [PROPERTY_ID.BREEZE_AWAY, false, [0x01]],

      // Breezeless: Boolean
      [PROPERTY_ID.BREEZELESS, true, [0x01]],
      [PROPERTY_ID.BREEZELESS, false, [0x00]],

      // Breeze control: Passthru
      [PROPERTY_ID.BREEZE_CONTROL, 0x04, [0x04]],
      [PROPERTY_ID.BREEZE_CONTROL, 0x00, [0x00]],

      // IECO: 13 bytes ieco_frame, ieco_number, ieco_switch, ...
      [PROPERTY_ID.IECO, true, [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      [PROPERTY_ID.IECO, false, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],

      // Cascade: 2 bytes wind_around, wind_around_ud
      [PROPERTY_ID.CASCADE, 0, [0, 0]],
      [PROPERTY_ID.CASCADE, 1, [1, 1]],
      [PROPERTY_ID.CASCADE, 2, [1, 2]],

      // Out Silent: 0x03 - On, 0x00 - Off
      [PROPERTY_ID.OUT_SILENT, true, [0x03]],
      [PROPERTY_ID.OUT_SILENT, false, [0x00]],
    ];

    for (const [prop, value, expected] of TEST_ENCODES) {
      const result = encodeProperty(prop, value);
      expect(Array.from(result)).toEqual(expected);
    }

    // Validate "unsupported" properties raise exceptions
    expect(() => encodeProperty(PROPERTY_ID.ANION, true)).toThrow();
  });

  it('should encode set properties payload correctly', () => {
    const PROPS = new Map<PropertyId, number | boolean>([
      [PROPERTY_ID.SWING_UD_ANGLE, 25],
      [PROPERTY_ID.SWING_LR_ANGLE, 75],
    ]);

    // Build command
    const command = new SetPropertiesCommand(PROPS);
    const frame = command.toBytes();
    const payload = frame.subarray(10, frame.length - 1);

    // Assert payload header looks correct
    expect(payload[0]).toBe(0xb0);
    expect(payload[1]).toBe(PROPS.size);

    // Assert that property ID was packed correctly (little-endian)
    expect(payload[2]).toBe(PROPERTY_ID.SWING_UD_ANGLE & 0xff);
    expect(payload[3]).toBe((PROPERTY_ID.SWING_UD_ANGLE >> 8) & 0xff);

    // Assert length is correct and data is correct
    expect(payload[4]).toBe(1);
    expect(payload[5]).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// TestPropertiesResponse
// ---------------------------------------------------------------------------

describe('TestPropertiesResponse', () => {
  it('should decode property values from bytes correctly', () => {
    const TEST_DECODES: [PropertyId, number[], unknown][] = [
      // Breeze away 0x02 - On, 0x01 - Off
      [PROPERTY_ID.BREEZE_AWAY, [0x02], true],
      [PROPERTY_ID.BREEZE_AWAY, [0x01], false],

      // Breezeless: Boolean
      [PROPERTY_ID.BREEZELESS, [0x01], true],
      [PROPERTY_ID.BREEZELESS, [0x00], false],
      [PROPERTY_ID.BREEZELESS, [0x02], true],

      // Breeze control: Passthru
      [PROPERTY_ID.BREEZE_CONTROL, [0x04], 0x04],
      [PROPERTY_ID.BREEZE_CONTROL, [0x00], 0x00],

      // Buzzer: Don't decode
      [PROPERTY_ID.BUZZER, [0x00], null],

      // IECO: 2 bytes
      [PROPERTY_ID.IECO, [0x00, 0x00], false],
      [PROPERTY_ID.IECO, [0x00, 0x01], true],

      // Cascade: 2 bytes
      [PROPERTY_ID.CASCADE, [0x00, 0x00], 0],
      [PROPERTY_ID.CASCADE, [0x01, 0x01], 1],
      [PROPERTY_ID.CASCADE, [0x01, 0x02], 2],

      // Out Silent: 0x03 - On, 0x00 - Off
      [PROPERTY_ID.OUT_SILENT, [0x03], true],
      [PROPERTY_ID.OUT_SILENT, [0x00], false],
    ];

    for (const [prop, data, expected] of TEST_DECODES) {
      const result = decodeProperty(prop, new Uint8Array(data));
      expect(result).toEqual(expected);
    }

    // Validate "unsupported" properties raise exceptions
    expect(() => decodeProperty(PROPERTY_ID.INDOOR_HUMIDITY, new Uint8Array([1]))).toThrow();
  });

  it('should decode properties responses correctly', () => {
    // https://github.com/mill1000/midea-ac-py/issues/60#issuecomment-1936976587
    const msg = Buffer.from(
      'aa21ac00000000000303b10409000001000a00000100150000012b1e020000005fa3',
      'hex',
    );
    // Response contains an unsupported property (INDOOR_HUMIDITY) – TS silently skips it
    const resp = buildResponse(msg) as PropertiesResponse;

    expect(resp).toBeInstanceOf(PropertiesResponse);
    expect(resp.getProperty(PROPERTY_ID.SWING_LR_ANGLE)).toBe(0);
    expect(resp.getProperty(PROPERTY_ID.SWING_UD_ANGLE)).toBe(0);
  });

  it('should decode properties ack from set properties command', () => {
    // https://github.com/mill1000/midea-msmart/issues/97#issuecomment-1949495900
    const msg = Buffer.from(
      'aa18ac00000000000302b0020a0000013209001101000089a4',
      'hex',
    );
    // Device did not support SWING_UD_ANGLE – TS skips failed properties
    const resp = buildResponse(msg) as PropertiesResponse;

    expect(resp).toBeInstanceOf(PropertiesResponse);
    expect(resp.getProperty(PROPERTY_ID.SWING_LR_ANGLE)).toBe(50);
    // SWING_UD_ANGLE failed so it should either be 0 or not present
    expect(resp.getProperty(PROPERTY_ID.SWING_UD_ANGLE)).toBe(0);
  });

  it('should ignore property notifications', () => {
    // https://github.com/mill1000/midea-msmart/issues/122
    const msg = Buffer.from(
      'aa1aac00000000000205b50310060101090001010a000101dcbcb4',
      'hex',
    );
    const resp = buildResponse(msg);

    // Assert response is generic Response (not PropertiesResponse)
    expect(resp.constructor).toBe(Response);
  });

  it('should handle unknown and invalid properties', () => {
    // https://github.com/mill1000/midea-ac-py/issues/128#issuecomment-2098342003
    const msg = Buffer.from(
      'aa1bac00000000000202b0021e001004001000001a00000100000e18',
      'hex',
    );
    const resp = buildResponse(msg) as PropertiesResponse;
    expect(resp).toBeInstanceOf(PropertiesResponse);

    // Assert that the buzzer property is not decoded
    expect(resp.getProperty(PROPERTY_ID.BUZZER)).toBeNull();
  });

  it('should handle properties with execution failure', () => {
    // https://github.com/mill1000/midea-msmart/issues/161#issuecomment-2282839178
    const msg = Buffer.from(
      'aa18ac00000000000302b00243001101041a00000100002ce5',
      'hex',
    );
    const resp = buildResponse(msg) as PropertiesResponse;
    expect(resp).toBeInstanceOf(PropertiesResponse);
  });
});

// ---------------------------------------------------------------------------
// TestResponseConstruct
// ---------------------------------------------------------------------------

describe('TestResponseConstruct', () => {
  it('should throw on invalid checksum', () => {
    const msg = Buffer.from(
      'aa14ac00000000000303b10109000001003c0000FF',
      'hex',
    );
    expect(() => Response.construct(msg)).toThrow(InvalidFrameError);
  });

  it('should accept PropertiesResponse with invalid CRC but reject StateResponse with invalid CRC', () => {
    // PropertiesResponse with invalid CRC should be accepted
    const propsMsg = Buffer.from(
      'aa14ac00000000000303b10109000001003c000042',
      'hex',
    );
    // StateResponse with invalid CRC should be rejected
    const stateMsg = Buffer.from(
      'aa22ac00000000000303c0014566000000300010045eff00000000000000000069aa0c',
      'hex',
    );

    // Assert that constructing a StateResponse with invalid CRC raises an exception
    expect(() => Response.construct(stateMsg)).toThrow(InvalidResponseError);

    // PropertiesResponse with invalid CRC should succeed
    const resp = Response.construct(propsMsg);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(PropertiesResponse);
  });

  it('should throw on short packet', () => {
    const msg = Buffer.from('01000000', 'hex');
    expect(() => Response.construct(msg)).toThrow(InvalidFrameError);
  });

  it('should throw on invalid device type', () => {
    // https://github.com/mill1000/midea-ac-py/issues/374#issuecomment-3240831784
    const msg = Buffer.from(
      'aa63cc0000000000000301fe00000043005000728c8000bc00728c728c808000010141ff010203000603010000000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ffa2',
      'hex',
    );
    expect(() => Response.construct(msg)).toThrow(InvalidFrameError);
  });
});

// ---------------------------------------------------------------------------
// TestGroupDataResponse
// ---------------------------------------------------------------------------

describe('TestGroupDataResponse', () => {
  it('should decode energy usage responses (BCD)', () => {
    const TEST_RESPONSES: [number | null, number | null, number | null, string][] = [
      // [total, current, realTime, hex]
      [679.2, 0, 0, 'aa1fac00000000000303c121014400067920000000000000000000000000aabf'],
      [5650.02, 1514.0, 0, 'aa20ac00000000000203c121014400564a02640000000014ae0000000000041a22'],
      [null, null, null, 'aa20ac00000000000303c1210144000000000000000000000000000000000843bc'],
    ];

    for (const [total, current, realTime, hex] of TEST_RESPONSES) {
      const resp = buildResponse(Buffer.from(hex, 'hex')) as EnergyUsageResponse;
      expect(resp).toBeInstanceOf(EnergyUsageResponse);
      expect(resp.totalEnergy).toBe(total);
      expect(resp.currentEnergy).toBe(current);
      expect(resp.realTimePower).toBe(realTime);
    }
  });

  it('should decode binary energy usage responses', () => {
    const TEST_RESPONSES: [number | null, number | null, number | null, string][] = [
      // [total, current, realTime, hex]
      [150.4, 0.6, 279.5, 'aa22ac00000000000803c1210144000005e00000000000000006000aeb000000487a5e'],
      [null, null, null, 'aa20ac00000000000303c1210144000000000000000000000000000000000843bc'],
    ];

    for (const [total, current, realTime, hex] of TEST_RESPONSES) {
      const resp = buildResponse(Buffer.from(hex, 'hex')) as EnergyUsageResponse;
      expect(resp).toBeInstanceOf(EnergyUsageResponse);
      expect(resp.totalEnergyBinary).toBe(total);
      expect(resp.currentEnergyBinary).toBe(current);
      expect(resp.realTimePowerBinary).toBe(realTime);
    }
  });

  it('should decode humidity from group 5 responses', () => {
    const TEST_RESPONSES: [number | null, string][] = [
      // [humidity, hex]
      [63, 'aa20ac00000000000303c12101453f546c005d0a000000de1f0000ba9a0004af9c'],
      [null, 'aa1fac00000000000303c1210145000000000000000000000000000000001aed'],
    ];

    for (const [humidity, hex] of TEST_RESPONSES) {
      const resp = buildResponse(Buffer.from(hex, 'hex')) as Group5Response;
      expect(resp).toBeInstanceOf(Group5Response);
      expect(resp.humidity).toBe(humidity);
    }
  });

  it('should decode defrost status from group 5 payloads', () => {
    const TEST_PAYLOADS: [string, boolean][] = [
      // Defrosting state
      ['c12101451e4f2b5e003c01000000692900cf7e0001bb38', true],
      // Not defrosting
      ['c12101451e4dcf5e611f00000052ad2900cf7e0002', false],
    ];

    for (const [hex, defrost] of TEST_PAYLOADS) {
      const payload = Buffer.from(hex, 'hex');
      const resp = new Group5Response(payload);
      expect(resp.defrost).toBe(defrost);
    }
  });
});
