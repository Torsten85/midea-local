/**
 * Tests for the AirConditioner device class.
 *
 * Ported from python/msmart/device/AC/test_device.py
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

import {
  CapabilitiesResponse,
  EnergyUsageResponse,
  GetEnergyUsageCommand,
  GetGroup5Command,
  GetPropertiesCommand,
  GetStateCommand,
  Group5Response,
  PROPERTY_ID,
  PropertiesResponse,
  Response,
  StateResponse,
} from '../src/device/ac/command.ts';
import type { PropertyId } from '../src/device/ac/command.ts';
import {
  AC_CAPABILITY,
  AirConditioner,
  AUX_HEAT_MODE,
  BREEZE_MODE,
  CASCADE_MODE,
  ENERGY_DATA_FORMAT,
  FAN_SPEED,
  OPERATIONAL_MODE,
  RATE_SELECT,
  SWING_ANGLE,
  SWING_MODE,
} from '../src/device/ac/device.ts';
import { CapabilityManager } from '../src/utils.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a dummy AirConditioner device for testing.
 * The Python code uses AC(0, 0, 0), we provide equivalent constructor args.
 */
function createDevice(): AirConditioner {
  return new AirConditioner({
    ip: '0.0.0.0',
    port: 0,
    deviceId: 0,
  });
}

/**
 * Access a private property of an object for testing purposes.
 */
function priv(obj: any): any {
  return obj;
}

// ---------------------------------------------------------------------------
// TestUpdateStateFromResponse
// ---------------------------------------------------------------------------

describe('TestUpdateStateFromResponse', () => {
  it('should parse StateResponse into device state', () => {
    // V3 state response
    const TEST_RESPONSE = Buffer.from(
      'aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79',
      'hex',
    );

    const resp = Response.construct(TEST_RESPONSE);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(StateResponse);

    // Create a dummy device and process the response
    const device = createDevice();
    priv(device)._updateState(resp);

    // Assert state is expected
    expect(device.targetTemperature).toBe(21.0);
    expect(device.indoorTemperature).toBe(21.0);
    expect(device.outdoorTemperature).toBe(28.5);

    expect(device.eco).toBe(true);
    expect(device.turbo).toBe(false);
    expect(device.freezeProtection).toBe(false);
    expect(device.sleep).toBe(false);

    expect(device.operationalMode).toBe(OPERATIONAL_MODE.COOL);
    expect(device.fanSpeed).toBe(FAN_SPEED.AUTO);
    expect(device.swingMode).toBe(SWING_MODE.VERTICAL);
  });

  it('should parse PropertiesResponse into device state', () => {
    // https://github.com/mill1000/midea-ac-py/issues/60#issuecomment-1936976587
    const TEST_RESPONSE = Buffer.from(
      'aa21ac00000000000303b10409000001000a00000100150000012b1e020000005fa3',
      'hex',
    );

    // Create a dummy device
    const device = createDevice();

    // Set some properties
    device.horizontalSwingAngle = SWING_ANGLE.POS_5;
    device.verticalSwingAngle = SWING_ANGLE.POS_5;

    // Response contains unsupported INDOOR_HUMIDITY – TS skips it silently
    const resp = Response.construct(TEST_RESPONSE);

    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(PropertiesResponse);

    // Process the response
    priv(device)._updateState(resp);

    // Assert state is expected
    expect(device.horizontalSwingAngle).toBe(SWING_ANGLE.OFF);
    expect(device.verticalSwingAngle).toBe(SWING_ANGLE.OFF);
  });

  it('should parse PropertiesResponse from SetProperties ACK into device state', () => {
    // https://github.com/mill1000/midea-msmart/issues/97#issuecomment-1949495900
    const TEST_RESPONSE = Buffer.from(
      'aa18ac00000000000302b0020a0000013209001101000089a4',
      'hex',
    );

    // Create a dummy device
    const device = createDevice();

    // Set some properties
    device.horizontalSwingAngle = SWING_ANGLE.OFF;
    device.verticalSwingAngle = SWING_ANGLE.OFF;

    // Device did not support SWING_UD_ANGLE – TS logs warning
    const resp = Response.construct(TEST_RESPONSE);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(PropertiesResponse);

    // Process the response
    priv(device)._updateState(resp);

    // Assert state is expected
    expect(device.horizontalSwingAngle).toBe(SWING_ANGLE.POS_3);
    expect(device.verticalSwingAngle).toBe(SWING_ANGLE.OFF);
  });

  it('should handle PropertiesResponse with only some properties', () => {
    // https://github.com/mill1000/midea-msmart/issues/97#issuecomment-1949495900
    const TEST_RESPONSE = Buffer.from(
      'aa13ac00000000000303b1010a0000013200c884',
      'hex',
    );

    // Create a dummy device
    const device = createDevice();

    // Set some properties
    device.horizontalSwingAngle = SWING_ANGLE.POS_5;
    device.verticalSwingAngle = SWING_ANGLE.POS_5;

    // Construct and assert response
    const resp = Response.construct(TEST_RESPONSE);
    expect(resp).not.toBeNull();
    expect(resp).toBeInstanceOf(PropertiesResponse);

    // Process response
    priv(device)._updateState(resp);

    // Assert that only the properties in the response are updated
    expect(device.horizontalSwingAngle).toBe(SWING_ANGLE.POS_3);

    // Assert other properties are untouched
    expect(device.verticalSwingAngle).toBe(SWING_ANGLE.POS_5);
  });

  it('should parse breeze properties from PropertiesResponse', () => {
    const TEST_RESPONSES: [string, boolean, boolean, boolean][] = [
      // [hex, breezeAway, breezeMild, breezeless]
      // Breezeless device in Breeze Away mode
      ['aa1cac00000000000303b103430000010218000001004200000000cf0e', true, false, false],
      // Non-breezeless device in Breeze Away mode
      ['aa1bac00000000000303b1034300000018000000420000010200914e', true, false, false],
      // Breezeless device in Breeze Mild mode
      ['aa1cac00000000000303b1034300000103180000010042000000001ac2', false, true, false],
      // Breezeless device in Breezeless mode
      ['aa1cac00000000000303b10343000001041800000101420000000034a6', false, false, true],
    ];

    for (const [hex, breezeAway, breezeMild, breezeless] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, 'hex'));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(PropertiesResponse);

      // Create a dummy device and process the response
      const device = createDevice();
      priv(device)._updateState(resp);

      expect(device.breezeAway).toBe(breezeAway);
      expect(device.breezeMild).toBe(breezeMild);
      expect(device.breezeless).toBe(breezeless);
    }
  });

  it('should parse EnergyUsageResponse into device state (BCD)', () => {
    const TEST_RESPONSES: [number | null, number | null, number | null, string][] = [
      // [total, current, realTime, hex]
      [5650.02, 1514.0, 0, 'aa20ac00000000000203c121014400564a02640000000014ae0000000000041a22'],
      [null, null, null, 'aa20ac00000000000303c1210144000000000000000000000000000000000843bc'],
    ];

    for (const [total, current, realTime, hex] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, 'hex'));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(EnergyUsageResponse);

      const device = createDevice();
      priv(device)._updateState(resp);

      expect(device.getTotalEnergyUsage(ENERGY_DATA_FORMAT.BCD)).toBe(total);
      expect(device.getCurrentEnergyUsage(ENERGY_DATA_FORMAT.BCD)).toBe(current);
      expect(device.getRealTimePowerUsage(ENERGY_DATA_FORMAT.BCD)).toBe(realTime);
    }
  });

  it('should parse EnergyUsageResponse into device state (Binary)', () => {
    const TEST_RESPONSES: [number | null, number | null, number | null, string][] = [
      // [total, current, realTime, hex]
      [150.4, 0.6, 279.5, 'aa22ac00000000000803c1210144000005e00000000000000006000aeb000000487a5e'],
      [null, null, null, 'aa20ac00000000000303c1210144000000000000000000000000000000000843bc'],
    ];

    for (const [total, current, realTime, hex] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, 'hex'));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(EnergyUsageResponse);

      const device = createDevice();
      priv(device)._updateState(resp);

      expect(device.getTotalEnergyUsage(ENERGY_DATA_FORMAT.BINARY)).toBe(total);
      expect(device.getCurrentEnergyUsage(ENERGY_DATA_FORMAT.BINARY)).toBe(current);
      expect(device.getRealTimePowerUsage(ENERGY_DATA_FORMAT.BINARY)).toBe(realTime);
    }
  });

  it('should parse humidity from Group5Response into device state', () => {
    const TEST_RESPONSES: [number | null, string][] = [
      // [humidity, hex]
      [63, 'aa20ac00000000000303c12101453f546c005d0a000000de1f0000ba9a0004af9c'],
      [null, 'aa1fac00000000000303c1210145000000000000000000000000000000001aed'],
    ];

    for (const [humidity, hex] of TEST_RESPONSES) {
      const resp = Response.construct(Buffer.from(hex, 'hex'));
      expect(resp).not.toBeNull();
      expect(resp).toBeInstanceOf(Group5Response);

      const device = createDevice();
      priv(device)._updateState(resp);

      expect(device.indoorHumidity).toBe(humidity);
    }
  });
});

// ---------------------------------------------------------------------------
// TestCapabilities
// ---------------------------------------------------------------------------

describe('TestCapabilities', () => {
  it('should parse general capabilities correctly', () => {
    // Device with numerous supported features
    const CAPS_0 = Buffer.from(
      'b50a12020101430001011402010115020101160201001a020101100201011f020103250207203c203c203c05400001000100',
      'hex',
    );
    const CAPS_1 = Buffer.from(
      'b5051e020101130201012202010019020100390001010000',
      'hex',
    );

    const device = createDevice();

    const resp0 = new CapabilitiesResponse(CAPS_0);
    const resp1 = new CapabilitiesResponse(CAPS_1);
    resp0.merge(resp1);
    priv(device)._updateCapabilities(resp0);

    // Supported operation modes
    const opModes = device.supportedOperationModes;
    expect(opModes).toContain(OPERATIONAL_MODE.AUTO);
    expect(opModes).toContain(OPERATIONAL_MODE.COOL);
    expect(opModes).toContain(OPERATIONAL_MODE.DRY);
    expect(opModes).toContain(OPERATIONAL_MODE.FAN_ONLY);
    expect(opModes).toContain(OPERATIONAL_MODE.HEAT);
    expect(opModes).toContain(OPERATIONAL_MODE.SMART_DRY);

    // Supported swing modes
    const swingModes = device.supportedSwingModes;
    expect(swingModes).toContain(SWING_MODE.OFF);
    expect(swingModes).toContain(SWING_MODE.BOTH);
    expect(swingModes).toContain(SWING_MODE.HORIZONTAL);
    expect(swingModes).toContain(SWING_MODE.VERTICAL);

    expect(device.supportsCustomFanSpeed).toBe(true);
    const fanSpeeds = device.supportedFanSpeeds;
    expect(fanSpeeds).toContain(FAN_SPEED.SILENT);
    expect(fanSpeeds).toContain(FAN_SPEED.LOW);
    expect(fanSpeeds).toContain(FAN_SPEED.MEDIUM);
    expect(fanSpeeds).toContain(FAN_SPEED.HIGH);
    expect(fanSpeeds).toContain(FAN_SPEED.MAX);
    expect(fanSpeeds).toContain(FAN_SPEED.AUTO);

    expect(device.supportsHumidity).toBe(true);
    expect(device.supportsTargetHumidity).toBe(true);

    expect(device.supportsPurifier).toBe(true);
    expect(device.supportsSelfClean).toBe(true);

    expect(device.supportsEco).toBe(true);
    expect(device.supportsFreezeProtection).toBe(true);
    expect(device.supportsTurbo).toBe(true);
  });

  it('should parse rate select capability', () => {
    // https://github.com/mill1000/midea-msmart/issues/148#issuecomment-2273549806
    const CAPS_0 = Buffer.from(
      'b50a1202010114020101150201001e020101170201021a02010110020101250207203c203c203c0024020101480001010101',
      'hex',
    );
    const CAPS_1 = Buffer.from(
      'b5071f0201002c020101160201043900010151000101e3000101130201010002',
      'hex',
    );

    const device = createDevice();

    const resp0 = new CapabilitiesResponse(CAPS_0);
    const resp1 = new CapabilitiesResponse(CAPS_1);
    resp0.merge(resp1);
    priv(device)._updateCapabilities(resp0);

    const rateSelects = device.supportedRateSelects;
    expect(rateSelects).toContain(RATE_SELECT.OFF);
    expect(rateSelects).toContain(RATE_SELECT.GEAR_75);
    expect(rateSelects).toContain(RATE_SELECT.GEAR_50);
  });

  it('should parse breeze mode capabilities', () => {
    // "Modern" breezeless device with "breeze control"
    const CAPS_0_A = Buffer.from(
      'b50a12020101430001011402010115020101160201001a020101100201011f020103250207203c203c203c05400001000100',
      'hex',
    );
    const CAPS_1_A = Buffer.from(
      'b5051e020101130201012202010019020100390001010000',
      'hex',
    );

    const deviceA = createDevice();
    const resp0A = new CapabilitiesResponse(CAPS_0_A);
    const resp1A = new CapabilitiesResponse(CAPS_1_A);
    resp0A.merge(resp1A);
    priv(deviceA)._updateCapabilities(resp0A);

    expect(deviceA.supportsBreezeAway).toBe(true);
    expect(deviceA.supportsBreezeMild).toBe(true);
    expect(deviceA.supportsBreezeless).toBe(true);

    // Device with only breeze away
    const CAPS_0_B = Buffer.from(
      'b50912020101180001001402010115020101160201001a020101100201011f020103250207203c203c203c050100',
      'hex',
    );
    const CAPS_1_B = Buffer.from(
      'b5091e0201011302010122020100190201003900010142000101090001010a000101300001010000',
      'hex',
    );

    const deviceB = createDevice();
    const resp0B = new CapabilitiesResponse(CAPS_0_B);
    const resp1B = new CapabilitiesResponse(CAPS_1_B);
    resp0B.merge(resp1B);
    priv(deviceB)._updateCapabilities(resp0B);

    expect(deviceB.supportsBreezeAway).toBe(true);
    expect(deviceB.supportsBreezeMild).toBe(false);
    expect(deviceB.supportsBreezeless).toBe(false);

    // "Legacy" breezeless device with only breezeless
    const CAPS_0_C = Buffer.from(
      'b50912020101180001011402010115020101160201001a020101100201011f020103250207203c203c203c050100',
      'hex',
    );
    const CAPS_1_C = Buffer.from(
      'b5041e0201011302010122020100190201000000',
      'hex',
    );

    const deviceC = createDevice();
    const resp0C = new CapabilitiesResponse(CAPS_0_C);
    const resp1C = new CapabilitiesResponse(CAPS_1_C);
    resp0C.merge(resp1C);
    priv(deviceC)._updateCapabilities(resp0C);

    expect(deviceC.supportsBreezeAway).toBe(false);
    expect(deviceC.supportsBreezeMild).toBe(false);
    expect(deviceC.supportsBreezeless).toBe(true);
  });

  it('should parse aux heat capabilities', () => {
    // https://github.com/mill1000/midea-ac-py/issues/297#issuecomment-2622720960
    const CAPS_0 = Buffer.from(
      'b50514020109150201021a020101250207203c203c203c00340201010100',
      'hex',
    );
    const CAPS_1 = Buffer.from(
      'b508100201051f0201003000010013020100190201013900010093000101940001010000',
      'hex',
    );

    const device = createDevice();
    const resp0 = new CapabilitiesResponse(CAPS_0);
    const resp1 = new CapabilitiesResponse(CAPS_1);
    resp0.merge(resp1);
    priv(device)._updateCapabilities(resp0);

    const auxModes = device.supportedAuxModes;
    expect(auxModes).toContain(AUX_HEAT_MODE.OFF);
    expect(auxModes).toContain(AUX_HEAT_MODE.AUX_HEAT);
    expect(auxModes).toContain(AUX_HEAT_MODE.AUX_ONLY);
  });

  it('should parse out silent capability', () => {
    const CAPS_0 = Buffer.from(
      'b5081f0201002c020101160201043900010151000101e300010113020101cd000103000236',
      'hex',
    );

    const device = createDevice();
    const resp0 = new CapabilitiesResponse(CAPS_0);
    priv(device)._updateCapabilities(resp0);

    expect(device.supportsOutSilent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TestSetState
// ---------------------------------------------------------------------------

describe('TestSetState', () => {
  it('should set breeze properties with breeze control', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.BREEZE_CONTROL as number);

    // Enable a breeze mode
    device.breezeMild = true;

    expect(device.breezeAway).toBe(false);
    expect(device.breezeMild).toBe(true);
    expect(device.breezeless).toBe(false);

    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(true);

    // Switch to a different breeze mode
    device.breezeless = true;

    expect(device.breezeAway).toBe(false);
    expect(device.breezeMild).toBe(false);
    expect(device.breezeless).toBe(true);

    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(true);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZELESS)).toBe(false);
  });

  it('should set breezeless property without breeze control', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.BREEZELESS as number);

    device.breezeless = true;

    expect(device.breezeAway).toBe(false);
    expect(device.breezeMild).toBe(false);
    expect(device.breezeless).toBe(true);

    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZELESS)).toBe(true);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(false);
  });

  it('should set breeze away property without breeze control', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.BREEZE_AWAY as number);

    device.breezeAway = true;

    expect(device.breezeAway).toBe(true);
    expect(device.breezeMild).toBe(false);
    expect(device.breezeless).toBe(false);

    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZE_AWAY)).toBe(true);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(false);
  });

  it('should set flash/jet cool property', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.JET_COOL as number);

    device.flashCool = true;

    expect(device.flashCool).toBe(true);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.JET_COOL)).toBe(true);
  });

  it('should set cascade property', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.CASCADE as number);

    device.cascadeMode = CASCADE_MODE.DOWN;

    expect(device.cascadeMode).toBe(CASCADE_MODE.DOWN);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.CASCADE)).toBe(true);
  });

  it('should set out silent property', () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.OUT_SILENT as number);

    device.outSilent = true;

    expect(device.outSilent).toBe(true);
    expect(priv(device)._updatedProperties.has(PROPERTY_ID.OUT_SILENT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TestRefresh
// ---------------------------------------------------------------------------

describe('TestRefresh', () => {
  it('should send GetStateCommand on refresh', async () => {
    const device = createDevice();

    // Mock _sendCommandsGetResponses to capture commands
    const mockSend = mock(() => Promise.resolve([]));
    priv(device)._sendCommandsGetResponses = mockSend;

    await device.refresh();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const commands = mockSend.mock.calls[0]![0];
    expect(commands.some((cmd: any) => cmd instanceof GetStateCommand)).toBe(true);
  });

  it('should send GetEnergyUsageCommand on refresh when enabled', async () => {
    const device = createDevice();
    device.enableEnergyUsageRequests = true;

    const mockSend = mock(() => Promise.resolve([]));
    priv(device)._sendCommandsGetResponses = mockSend;

    await device.refresh();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const commands = mockSend.mock.calls[0]![0];
    expect(commands.some((cmd: any) => cmd instanceof GetEnergyUsageCommand)).toBe(true);
  });

  it('should send GetGroup5Command on refresh when humidity is supported', async () => {
    const device = createDevice();
    priv(device)._capabilities.set(AC_CAPABILITY.HUMIDITY as number);

    const mockSend = mock(() => Promise.resolve([]));
    priv(device)._sendCommandsGetResponses = mockSend;

    await device.refresh();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const commands = mockSend.mock.calls[0]![0];
    expect(commands.some((cmd: any) => cmd instanceof GetGroup5Command)).toBe(true);
  });

  it('should send GetGroup5Command on refresh when enabled', async () => {
    const device = createDevice();
    device.enableGroup5DataRequests = true;

    const mockSend = mock(() => Promise.resolve([]));
    priv(device)._sendCommandsGetResponses = mockSend;

    await device.refresh();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const commands = mockSend.mock.calls[0]![0];
    expect(commands.some((cmd: any) => cmd instanceof GetGroup5Command)).toBe(true);
  });

  it('should send GetPropertiesCommand on refresh when supported properties are present', async () => {
    const device = createDevice();
    priv(device)._supportedProperties.add(PROPERTY_ID.BREEZE_CONTROL);

    const mockSend = mock(() => Promise.resolve([]));
    priv(device)._sendCommandsGetResponses = mockSend;

    await device.refresh();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const commands = mockSend.mock.calls[0]![0];
    expect(commands.some((cmd: any) => cmd instanceof GetPropertiesCommand)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TestSendCommandGetResponse
// ---------------------------------------------------------------------------

describe('TestSendCommandGetResponse', () => {
  it('should mark device offline when refresh gets no response', async () => {
    const device = createDevice();

    // Force device online
    priv(device)._online = true;
    expect(device.online).toBe(true);

    // Mock _lan.send to return no responses
    priv(device)._lan = { send: mock(() => Promise.resolve([])) };

    await device.refresh();

    expect(device.online).toBe(false);
  });

  it('should mark device online and supported with valid response', async () => {
    const TEST_RESPONSE = Buffer.from(
      'aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79',
      'hex',
    );

    const device = createDevice();

    // Assert device starts offline and unsupported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // Mock _lan.send to return a valid state response
    priv(device)._lan = { send: mock(() => Promise.resolve([TEST_RESPONSE])) };

    await device.refresh();

    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);
  });

  it('should stay online with only one response from multiple commands', async () => {
    const TEST_RESPONSE = Buffer.from(
      'aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79',
      'hex',
    );

    const device = createDevice();

    // Force device online
    priv(device)._online = true;
    expect(device.online).toBe(true);

    // Only respond to the first command, not subsequent ones
    let callCount = 0;
    priv(device)._lan = {
      send: mock(async () => {
        callCount++;
        if (callCount === 1) {
          return [TEST_RESPONSE];
        }
        return [];
      }),
    };

    // Force additional features
    priv(device)._requestEnergyUsage = true;
    priv(device)._capabilities.set(AC_CAPABILITY.HUMIDITY as number);

    await device.refresh();

    // Assert expected number of send calls
    expect(callCount).toBe(3);

    // Assert device is still online
    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);
  });

  it('should keep supported=true even if device goes offline', async () => {
    const TEST_RESPONSE = Buffer.from(
      'aa23ac00000000000303c00145660000003c0010045c6b20000000000000000000020d79',
      'hex',
    );

    const device = createDevice();

    // Assert device starts offline and unsupported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // First refresh with valid response
    priv(device)._lan = { send: mock(() => Promise.resolve([TEST_RESPONSE])) };

    await device.refresh();

    expect(device.online).toBe(true);
    expect(device.supported).toBe(true);

    // Second refresh with no response
    priv(device)._lan = { send: mock(() => Promise.resolve([])) };

    await device.refresh();

    // Assert device is now offline but still supported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(true);
  });

  it('should handle incorrect device type response', async () => {
    // https://github.com/mill1000/midea-ac-py/issues/374#issuecomment-3240831784
    const TEST_RESPONSE = Buffer.from(
      'aa63cc0000000000000301fe00000043005000728c8000bc00728c728c808000010141ff010203000603010000000000000001000103010000000000000000000001000100010000000000000000000000000001000200000100000101000102ff02ffa2',
      'hex',
    );

    const device = createDevice();

    // Assert device starts offline and unsupported
    expect(device.online).toBe(false);
    expect(device.supported).toBe(false);

    // Mock _lan.send to return wrong device type response
    priv(device)._lan = { send: mock(() => Promise.resolve([TEST_RESPONSE])) };

    await device.refresh();

    // Assert device is online but unsupported (response was received but invalid)
    expect(device.online).toBe(true);
    expect(device.supported).toBe(false);
  });

  it('should handle bad capabilities response', async () => {
    // "Notify" response with the same ID as capabilities response
    const TEST_RESPONSE = Buffer.from(
      'aa1aac00000000000205b50310060101090001010a000101dcbcb4',
      'hex',
    );

    const device = createDevice();

    // Mock _lan.send to return test response
    const mockSend = mock(() => Promise.resolve([TEST_RESPONSE]));
    priv(device)._lan = { send: mockSend };

    // Get device capabilities – should not throw
    await device.getCapabilities();

    expect(mockSend).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TestCapabilityOverrides
// ---------------------------------------------------------------------------

describe('TestCapabilityOverrides', () => {
  it('should override target temperatures', () => {
    const device = createDevice();

    device.overrideCapabilities({ min_target_temperature: 22.5 });
    expect(device.minTargetTemperature).toBe(22.5);

    device.overrideCapabilities({ max_target_temperature: 40 });
    expect(device.maxTargetTemperature).toBe(40.0);
  });

  it('should override operational modes', () => {
    const EXPECTED_VALUE = [
      OPERATIONAL_MODE.HEAT,
      OPERATIONAL_MODE.COOL,
      OPERATIONAL_MODE.AUTO,
    ];

    const device = createDevice();

    expect(device.supportedOperationModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities({
      supported_modes: [OPERATIONAL_MODE.HEAT, OPERATIONAL_MODE.COOL, OPERATIONAL_MODE.AUTO],
    });

    expect(device.supportedOperationModes).toEqual(EXPECTED_VALUE);
  });

  it('should override swing modes', () => {
    const EXPECTED_VALUE = [
      SWING_MODE.BOTH,
      SWING_MODE.HORIZONTAL,
    ];

    const device = createDevice();

    expect(device.supportedSwingModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities({
      supported_swing_modes: [SWING_MODE.BOTH, SWING_MODE.HORIZONTAL],
    });

    expect(device.supportedSwingModes).toEqual(EXPECTED_VALUE);
  });

  it('should override fan speeds', () => {
    const EXPECTED_VALUE = [
      FAN_SPEED.AUTO,
      FAN_SPEED.HIGH,
    ];

    const device = createDevice();

    expect(device.supportedFanSpeeds).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities({
      supported_fan_speeds: [FAN_SPEED.AUTO, FAN_SPEED.HIGH],
    });

    expect(device.supportedFanSpeeds).toEqual(EXPECTED_VALUE);
  });

  it('should override aux heat modes', () => {
    const EXPECTED_VALUE = [
      AUX_HEAT_MODE.OFF,
      AUX_HEAT_MODE.AUX_ONLY,
    ];

    const device = createDevice();

    expect(device.supportedAuxModes).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities({
      supported_aux_modes: [AUX_HEAT_MODE.OFF, AUX_HEAT_MODE.AUX_ONLY],
    });

    expect(device.supportedAuxModes).toEqual(EXPECTED_VALUE);
  });

  it('should override rate selects and update supported properties', () => {
    const EXPECTED_VALUE = [
      RATE_SELECT.OFF,
      RATE_SELECT.LEVEL_5,
    ];

    const device = createDevice();

    expect(device.supportedRateSelects).not.toEqual(EXPECTED_VALUE);

    device.overrideCapabilities({
      supported_rate_selects: [RATE_SELECT.OFF, RATE_SELECT.LEVEL_5],
    });

    expect(device.supportedRateSelects).toEqual(EXPECTED_VALUE);

    // Rate selects is unique in that it is property based
    expect(priv(device)._supportedProperties.has(PROPERTY_ID.RATE_SELECT)).toBe(true);
  });

  it('should override additional capabilities', () => {
    const device = createDevice();

    // Alter default capabilities
    priv(device)._capabilities.set(AC_CAPABILITY.CUSTOM_FAN_SPEED as number, false);
    priv(device)._capabilities.set(AC_CAPABILITY.ECO as number, false);
    priv(device)._capabilities.set(AC_CAPABILITY.TURBO as number, true);
    priv(device)._capabilities.set(AC_CAPABILITY.SELF_CLEAN as number, true);

    // Assert the capabilities match
    expect(device.supportsCustomFanSpeed).toBe(false);
    expect(device.supportsEco).toBe(false);
    expect(device.supportsFreezeProtection).toBe(true);
    expect(device.supportsTurbo).toBe(true);
    expect(device.supportsSelfClean).toBe(true);

    // Override capabilities - in TS, we pass the actual capability flag values
    device.overrideCapabilities({
      additional_capabilities: [
        AC_CAPABILITY.CUSTOM_FAN_SPEED,
        AC_CAPABILITY.ECO,
        AC_CAPABILITY.FREEZE_PROTECTION,
      ],
    });

    // The override replaces the capabilities manager's flags
    // Check support after override
    expect(device.supportsCustomFanSpeed).toBe(true);
    expect(device.supportsEco).toBe(true);
    expect(device.supportsFreezeProtection).toBe(true);
    // These should now be false since they weren't in the override
    expect(device.supportsTurbo).toBe(false);
    expect(device.supportsSelfClean).toBe(false);
  });

  it('should update supported properties when overriding capabilities', () => {
    const device = createDevice();

    // Process capability responses to add capabilities and supported properties
    const CAPS_0 = Buffer.from(
      'b50a12020101430001011402010115020101160201001a020101100201011f020103250207203c203c203c05400001000100',
      'hex',
    );
    const CAPS_1 = Buffer.from(
      'b5051e020101130201012202010019020100390001010000',
      'hex',
    );

    const resp0 = new CapabilitiesResponse(CAPS_0);
    const resp1 = new CapabilitiesResponse(CAPS_1);
    resp0.merge(resp1);
    priv(device)._updateCapabilities(resp0);

    // Assert expected capabilities and supported properties
    expect(device.supportsBreezeAway).toBe(true);
    expect(device.supportsBreezeMild).toBe(true);
    expect(device.supportsBreezeless).toBe(true);

    expect(priv(device)._supportedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(true);

    // Assert overrides aren't already supported
    expect(device.supportsVerticalSwingAngle).toBe(false);
    expect(device.supportsFlashCool).toBe(false);

    expect(priv(device)._supportedProperties.has(PROPERTY_ID.SWING_UD_ANGLE)).toBe(false);
    expect(priv(device)._supportedProperties.has(PROPERTY_ID.JET_COOL)).toBe(false);

    // Override capabilities
    device.overrideCapabilities({
      additional_capabilities: [
        AC_CAPABILITY.SWING_VERTICAL_ANGLE,
        AC_CAPABILITY.JET_COOL,
      ],
    });

    // Verify overrides are now supported and in supported properties
    expect(device.supportsVerticalSwingAngle).toBe(true);
    expect(device.supportsFlashCool).toBe(true);

    expect(priv(device)._supportedProperties.has(PROPERTY_ID.SWING_UD_ANGLE)).toBe(true);
    expect(priv(device)._supportedProperties.has(PROPERTY_ID.JET_COOL)).toBe(true);

    // Verify overrides removed the original capabilities
    expect(device.supportsBreezeAway).toBe(false);
    expect(device.supportsBreezeMild).toBe(false);
    expect(device.supportsBreezeless).toBe(false);

    expect(priv(device)._supportedProperties.has(PROPERTY_ID.BREEZE_CONTROL)).toBe(false);
  });

  it('should merge capabilities when merge option is true', () => {
    const device = createDevice();

    // Force capabilities
    priv(device)._supportedOpModes = [OPERATIONAL_MODE.DRY];
    priv(device)._supportedSwingModes = [SWING_MODE.VERTICAL];

    device.overrideCapabilities(
      {
        supported_modes: [OPERATIONAL_MODE.HEAT, OPERATIONAL_MODE.COOL, OPERATIONAL_MODE.AUTO],
        supported_swing_modes: [SWING_MODE.BOTH, SWING_MODE.HORIZONTAL],
      },
      { merge: true },
    );

    // Assert merged capabilities match expected
    const mergedSwing = device.supportedSwingModes;
    expect(mergedSwing).toContain(SWING_MODE.BOTH);
    expect(mergedSwing).toContain(SWING_MODE.VERTICAL);
    expect(mergedSwing).toContain(SWING_MODE.HORIZONTAL);

    const mergedModes = device.supportedOperationModes;
    expect(mergedModes).toContain(OPERATIONAL_MODE.HEAT);
    expect(mergedModes).toContain(OPERATIONAL_MODE.COOL);
    expect(mergedModes).toContain(OPERATIONAL_MODE.AUTO);
    expect(mergedModes).toContain(OPERATIONAL_MODE.DRY);
  });
});
