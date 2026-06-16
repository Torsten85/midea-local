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
