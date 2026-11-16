import { describe, expect, it } from "bun:test";
import { AirConditioner, AC_CAPABILITY, ENERGY_DATA_FORMAT } from "../src/device/ac/device.ts";
import { CAPABILITY_ID } from "../src/device/ac/command.ts";
import { Frame } from "../src/frame.ts";
import { FRAME_TYPE } from "../src/const.ts";
import { calculate as crc8 } from "../src/crc8.ts";

type Entry = [number, number[]];
function device() { return new AirConditioner({ ip: "192.0.2.1", port: 6444, deviceId: 1 }); }
function response(entries: Entry[], more = false): Buffer {
  const body = Buffer.from([0xb5, entries.length, ...entries.flatMap(([id, bytes]) => [id & 255, id >> 8, bytes.length, ...bytes]), more ? 1 : 0, 0]);
  return Buffer.from(new Frame(0xac, FRAME_TYPE.QUERY).toBytes(Buffer.concat([body, Buffer.from([crc8(body)])])));
}
function mockReport(ac: AirConditioner, entries: Entry[]) {
  (ac as any)._lan = { send: async () => [response(entries)] };
}

const firstPage: Entry[] = [
  [CAPABILITY_ID.ENERGY, [2]],
  [CAPABILITY_ID.DISPLAY_CONTROL, [0]],
  [CAPABILITY_ID.TEMPERATURES, [32,60,34,58,36,56,1]],
];
const secondPage: Entry[] = [
  [CAPABILITY_ID.PRESET_TURBO, [3]],
  [CAPABILITY_ID.BUZZER, [0]],
  [CAPABILITY_ID.FILTER_REMIND, [3]],
  [CAPABILITY_ID.SMART_EYE, [1]],
  [CAPABILITY_ID.WIND_ON_ME, [1]],
  [CAPABILITY_ID.WIND_OFF_ME, [0]],
  [CAPABILITY_ID.PRESET_ECO, [1]],
];

describe("read-only capability details", () => {
  it("keeps unreported fields unknown while effective defaults remain available", () => {
    const ac = device();
    expect(ac.reportedCapabilities).toBeNull();
    expect(ac.reportedEnergyDataFormat).toBeNull();
    expect(Object.values(ac.reportedFeatures)).toEqual(Array(7).fill(null));
    expect(ac.temperatureLimitsByMode).toEqual({ cool: { min: null, max: null }, heat: { min: null, max: null }, auto: { min: null, max: null } });
    expect(ac.effectiveCapabilities.min_target_temperature).toBe(16);
    expect(ac.effectiveCapabilities.max_target_temperature).toBe(30);
    expect(ac.effectiveCapabilities.additional_capabilities & AC_CAPABILITY.DISPLAY_CONTROL).toBe(AC_CAPABILITY.DISPLAY_CONTROL);
    expect(ac.capabilitiesDict().reported_capabilities).toBeNull();
  });

  it("preserves the full decoded report across two pages with no extra requests", async () => {
    const ac = device();
    const commands: number[] = [];
    (ac as any)._lan = { send: async (data: Buffer) => {
      commands.push(data[10]!);
      return [commands.length === 1 ? response(firstPage, true) : response(secondPage)];
    }};
    await ac.getCapabilities();
    expect(commands).toEqual([0xb5, 0xb5]);
    expect(ac.reportedCapabilities).toMatchObject({ energy_stats: true, energy_bcd: true, display_control: false,
      cool_min_temperature: 16, cool_max_temperature: 30, auto_min_temperature: 17, auto_max_temperature: 29,
      heat_min_temperature: 18, heat_max_temperature: 28, decimals: true,
      turbo_heat: true, turbo_cool: false, buzzer: false, filter_clean: true,
      smart_eye: true, wind_on_me: true, wind_off_me: false, eco: true,
    });
    expect(ac.reportedEnergyDataFormat).toBe(ENERGY_DATA_FORMAT.BCD);
    expect(ac.temperatureLimitsByMode).toEqual({ cool: { min: 16, max: 30 }, auto: { min: 17, max: 29 }, heat: { min: 18, max: 28 } });
    expect(ac.reportedFeatures).toEqual({ turbo_heat: true, turbo_cool: false, buzzer: false, filter_clean: true,
      smart_eye: true, wind_on_me: true, wind_off_me: false });
    expect(ac.capabilitiesDict()).toMatchObject({
      reported_capabilities: ac.reportedCapabilities, effective_capabilities: ac.effectiveCapabilities,
      reported_energy_data_format: ENERGY_DATA_FORMAT.BCD, temperature_limits_by_mode: ac.temperatureLimitsByMode,
      reported_features: ac.reportedFeatures,
    });
  });

  it("distinguishes overrides from reported values and returns defensive copies", async () => {
    const ac = device();
    mockReport(ac, firstPage);
    await ac.getCapabilities();
    const reported = ac.reportedCapabilities;
    ac.overrideCapabilities({ additional_capabilities: (ac.effectiveCapabilities.additional_capabilities | AC_CAPABILITY.DISPLAY_CONTROL), min_target_temperature: 23 });
    expect(ac.reportedCapabilities).toEqual(reported);
    expect(ac.reportedCapabilities!.display_control).toBe(false);
    expect(ac.supportsDisplayControl).toBe(true);
    expect(ac.effectiveCapabilities.min_target_temperature).toBe(23);
    expect(ac.temperatureLimitsByMode.heat.min).toBe(18);
    expect(ac.reportedEnergyDataFormat).toBe(ENERGY_DATA_FORMAT.BCD);
    const exported = ac.capabilitiesDict() as any;
    exported.reported_capabilities.display_control = true;
    exported.reported_features.buzzer = true;
    exported.temperature_limits_by_mode.heat.min = -100;
    exported.effective_capabilities.supported_modes.length = 0;
    exported.supported_fan_speeds.length = 0;
    expect(ac.reportedCapabilities!.display_control).toBe(false);
    expect(ac.reportedFeatures.buzzer).toBeNull();
    expect(ac.temperatureLimitsByMode.heat.min).toBe(18);
    expect(ac.supportedOperationModes.length).toBeGreaterThan(0);
    expect(ac.supportedFanSpeeds.length).toBeGreaterThan(0);
  });

  for (const [reportedValue, expected] of [[0,null],[1,null],[2,ENERGY_DATA_FORMAT.BCD],[3,ENERGY_DATA_FORMAT.BCD],
    [4,ENERGY_DATA_FORMAT.BINARY],[5,ENERGY_DATA_FORMAT.BINARY],[6,null],[255,null]] as const) {
    it(`exposes the energy format for capability value ${reportedValue} without selecting a decoder`, async () => {
      const ac = device();
      mockReport(ac, [[CAPABILITY_ID.ENERGY,[reportedValue]]]);
      await ac.getCapabilities();
      expect(ac.reportedEnergyDataFormat).toBe(expected);
      (ac as any)._totalEnergyUsage = { [ENERGY_DATA_FORMAT.BCD]: 12, [ENERGY_DATA_FORMAT.BINARY]: 34 };
      expect(ac.getTotalEnergyUsage()).toBe(12);
      expect(ac.getTotalEnergyUsage(ENERGY_DATA_FORMAT.BINARY)).toBe(34);
    });
  }

  it("distinguishes empty reports from no report, and missing fields from explicit false", async () => {
    const ac = device();
    mockReport(ac, [[CAPABILITY_ID.BUZZER,[0]]]);
    await ac.getCapabilities();
    expect(ac.reportedFeatures.buzzer).toBe(false);
    expect(ac.reportedFeatures.smart_eye).toBeNull();
    mockReport(ac, []);
    await ac.getCapabilities();
    expect(ac.reportedCapabilities).toEqual({});
    expect(ac.reportedFeatures.buzzer).toBeNull();
    expect(ac.reportedEnergyDataFormat).toBeNull();
  });

  it("retains the last successful report when discovery fails", async () => {
    const ac = device();
    mockReport(ac, firstPage);
    await ac.getCapabilities();
    const before = ac.reportedCapabilities;
    (ac as any)._lan = { send: async () => [] };
    await ac.getCapabilities();
    expect(ac.reportedCapabilities).toEqual(before);
    expect(ac.reportedEnergyDataFormat).toBe(ENERGY_DATA_FORMAT.BCD);
  });
});
