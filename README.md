# midea-local

> **This is a straight port. I put zero real effort into this.**
>
> All credits, fame, and glory belong to **[Tucker Kern](https://github.com/mill1000)** and the original Python project **[midea-msmart](https://github.com/mill1000/midea-msmart)**. That's where the actual reverse-engineering, protocol analysis, and hard work happened. I just ran it through a transpiler-shaped meat grinder. Go star the original repo.

## What is this?

A Bun/TypeScript port of [msmart-ng](https://github.com/mill1000/midea-msmart) — a library for **local network control** of Midea (and associated brands) smart air conditioners. No cloud dependency at runtime, everything talks directly to the device over your LAN.

## How it works

1. **Discovery** — Sends UDP broadcast packets on ports 6445/20086. Devices respond with encrypted payloads containing their ID, serial number, and protocol version (V2 or V3).
2. **Authentication** — V3 devices require a token/key pair fetched once from Midea's cloud API (NetHomePlus). After that, communication is fully local.
3. **Control** — Commands are framed in Midea's proprietary binary protocol (`0xAA` header for V2, `0x8370` wrapper for V3), sent over TCP to port 6444.

Zero npm dependencies. Uses `node:crypto`, `node:net`, and `node:dgram`.

## Usage

```bash
bun add midea-local  # or just clone this repo
```

### Toggle a device on/off

```ts
import { Discover } from "midea-local";
import { AirConditioner } from "midea-local";

// Find the device
const device = await Discover.discoverSingle("192.168.1.100");

// Authenticate (only needed once for V3 devices)
await Discover.connect(device, {
  account: "your@email.com",
  password: "yourpassword",
});

// Read current state
await device.refresh();
console.log(`Power: ${device.powerState ? "ON" : "OFF"}`);
console.log(`Temperature: ${device.indoorTemperature}°C`);

// Toggle power
device.powerState = !device.powerState;
await device.apply();
```

### Discover all devices on the network

```ts
const devices = await Discover.discover({
  account: "your@email.com",
  password: "yourpassword",
});

for (const device of devices) {
  console.log(`${device.name} @ ${device.ip} (${device.sn})`);
}
```

### Run the example

```bash
bun run examples/toggle.ts <ip> <account> <password>
```

## Supported devices

- **AC** (`0xAC`) — Residential air conditioners (`AirConditioner`)
- **CC** (`0xCC`) — Commercial air conditioners (`CommercialAirConditioner`)

## License

Same as the original — MIT.

## Reliability and errors

Write operations (`apply()`, `toggleDisplay()`, and `startSelfClean()`) reject their promises when transport fails or no valid reply is received. AC property writes also reject explicit device refusals; failed property values are not copied into the cached state, and pending property changes are retained for retry. Handle these errors in the calling application.

A valid response confirms communication, not that every requested setting was accepted unchanged. Re-read device state where confirmation matters. A compound command may partially succeed before a later property fails; an error does not roll back changes already applied by the device.

Status polling remains tolerant of unanswered optional queries. Inspect `device.online` and the returned state; unsupported sensors and energy monitoring vary by device model. An all-zero energy reply retains the library's existing unavailable-data behavior.

The `ENERGY_STATS` capability flag now reflects discovery independently of `enableEnergyUsageRequests`, which can still force polling on devices with incomplete capability reports. Energy decoding supports BCD and unsigned binary counters; model-specific scaling still needs verification against known measurements.

Run `bun test` for the source regression suite and `bun run test:build` to build and exercise both Node.js module formats. Cloud integration and some older socket tests remain explicitly skipped; no hardware or cloud access is needed for the new reliability checks.

## Read-only capability details

After `await device.getCapabilities()`, residential AC devices expose:

| Getter | Meaning |
|---|---|
| `reportedCapabilities` | Complete snapshot of already decoded report fields, before library defaults or overrides. Null before successful discovery; an empty report is `{}`. Unknown protocol TLVs are not decoded. |
| `effectiveCapabilities` | Temperature bounds, supported lists and flags actually used by the library, including defaults and overrides. |
| `reportedEnergyDataFormat` | `ENERGY_DATA_FORMAT.BCD` (0), `ENERGY_DATA_FORMAT.BINARY` (1), or null when encoding is not reported with recognized energy support. |
| `temperatureLimitsByMode` | `cool`, `heat`, and `auto`, each with reported `min` and `max` in Celsius. Missing bounds are null. |
| `reportedFeatures` | Separate `turbo_heat`, `turbo_cool`, `buzzer`, `filter_clean`, `smart_eye`, `wind_on_me`, and `wind_off_me` report flags. Missing flags are null; explicit negatives remain false. |

`capabilitiesDict()` includes the same details under `reported_capabilities`, `effective_capabilities`, `reported_energy_data_format`, `temperature_limits_by_mode`, and `reported_features`. Its existing top-level effective fields remain available. The reported snapshot is replaced only after a successfully decoded discovery result; failed discovery retains the last successful report. Querying again replaces old fields, so omitted fields do not linger from an earlier report. Both capability-response pages are merged before the snapshot is taken.

These additions issue no new requests, do not select an energy decoder automatically, and do not create new controls. Report flags describe support, not current operating state. Encoding metadata is not proof of model-specific energy units or scaling. Capability overrides change effective values, never the original report. Returned objects and arrays are copies; changing them does not modify device state.
