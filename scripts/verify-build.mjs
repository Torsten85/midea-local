import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Exercise the exact artifacts Node.js consumers load, without real device access.
for (const [format, lib] of [
  ['CommonJS', require('../dist/cjs/index.cjs')],
  ['ESM', await import('../dist/esm/index.js')],
]) {
  const { AirConditioner, Device, Frame, FRAME_TYPE, AC_CAPABILITY, ENERGY_DATA_FORMAT,
    LanProtocol, Packet, ProtocolError, calculateCrc8 } = lib;
  const ac = () => new AirConditioner({ ip: '192.0.2.1', port: 6444, deviceId: 1 });
  const response = body => {
    const bytes = Buffer.from(body);
    return Buffer.from(new Frame(0xac, FRAME_TYPE.QUERY).toBytes(Buffer.concat([bytes, Buffer.from([calculateCrc8(bytes)])])));
  };
  assert(Device.construct({ type: 0xac, ip: '192.0.2.1', port: 6444, deviceId: 1 }) instanceof AirConditioner);

  const energyDevice = ac();
  energyDevice._lan.send = async () => [response([0xb5,1,0x16,2,1,2])];
  await energyDevice.getCapabilities();
  assert(energyDevice.capabilitiesDict().additional_capabilities & AC_CAPABILITY.ENERGY_STATS);
  assert.equal(energyDevice.enableEnergyUsageRequests, true);
  assert.equal(energyDevice.reportedCapabilities.energy_stats, true);
  assert.equal(energyDevice.reportedEnergyDataFormat, ENERGY_DATA_FORMAT.BCD);
  assert.equal(energyDevice.reportedFeatures.buzzer, null);
  assert.equal(energyDevice.temperatureLimitsByMode.heat.min, null);
  const originalReport = energyDevice.reportedCapabilities;
  energyDevice.overrideCapabilities({ additional_capabilities: AC_CAPABILITY.DISPLAY_CONTROL });
  assert.deepEqual(energyDevice.reportedCapabilities, originalReport);
  assert.equal(energyDevice.effectiveCapabilities.additional_capabilities, AC_CAPABILITY.DISPLAY_CONTROL);
  const snapshot = energyDevice.capabilitiesDict();
  snapshot.reported_capabilities.energy_stats = false;
  snapshot.effective_capabilities.supported_modes.length = 0;
  assert.equal(energyDevice.reportedCapabilities.energy_stats, true);
  assert(energyDevice.supportedOperationModes.length > 0);

  const body = Buffer.alloc(19); body[0] = 0xc1; body[3] = 4; body[4] = 0x80;
  energyDevice._lan.send = async () => [response(body)];
  await energyDevice.refresh();
  assert.equal(energyDevice.getTotalEnergyUsage(ENERGY_DATA_FORMAT.BINARY), 214748364.8);

  const parsed = ac();
  parsed.powerState = true;
  parsed._lan.send = async () => [response([0xc0])];
  await parsed.refresh();
  assert.equal(parsed.powerState, true, 'Truncated state must not replace cached values');
  await assert.rejects(parsed.apply(), ProtocolError);

  parsed.verticalSwingAngle = 25;
  parsed._lan.send = async () => [response([0xb1,1,9,0,0x10,1,100])];
  await parsed.refresh();
  assert.equal(parsed.verticalSwingAngle, 25);
  await assert.rejects(parsed.apply(), /rejected property 0x0009/);

  const noReply = ac();
  noReply._lan.send = async () => { throw new ProtocolError('synthetic failure'); };
  await assert.rejects(noReply.apply(), ProtocolError);
  assert.equal(noReply.online, false);

  const packet = Packet.encode(1, Buffer.from([1,2,3]));
  const protocol = new LanProtocol();
  protocol._onData(packet.subarray(0, 5));
  await assert.rejects(protocol.read(0), /Queue is empty/);
  protocol._onData(Buffer.concat([packet.subarray(5),packet]));
  assert.deepEqual(Packet.decode(await protocol.read(0)), Buffer.from([1,2,3]));
  assert.deepEqual(Packet.decode(await protocol.read(0)), Buffer.from([1,2,3]));
  console.log(`${format}: build verification passed`);
}
