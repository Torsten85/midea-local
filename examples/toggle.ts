/**
 * Example: Toggle a Midea AC device on/off.
 *
 * Usage:
 *   bun run examples/toggle.ts <ip> <account> <password>
 */

import { Discover } from "../src/discover.ts";
import { AirConditioner } from "../src/device/ac/device.ts";

const [ip, account, password] = process.argv.slice(2);

if (!ip || !account || !password) {
  console.error("Usage: bun run examples/toggle.ts <ip> <account> <password>");
  process.exit(1);
}

// 1. Discover the device at the given IP
console.log(`🔍 Discovering device at ${ip}...`);
const device = await Discover.discoverSingle(ip);

if (!device) {
  console.error(`❌ No device found at ${ip}`);
  process.exit(1);
}

console.log(`✅ Found: ${device.name} (${device.sn})`);

// 2. Authenticate & connect
console.log("🔑 Authenticating...");
await Discover.connect(device, { account, password });

if (!(device instanceof AirConditioner)) {
  console.error("❌ Device is not an AirConditioner");
  process.exit(1);
}

// 3. Refresh to get current state
await device.refresh();

const wasPowered = device.powerState;
console.log(`📊 Current state: ${wasPowered ? "ON" : "OFF"}`);

// 4. Toggle power
device.powerState = !wasPowered;
await device.apply();

console.log(`⚡ Toggled → ${device.powerState ? "ON" : "OFF"}`);
