import { describe, expect, it } from "bun:test";
import { AirConditioner, AC_CAPABILITY, ENERGY_DATA_FORMAT, SWING_ANGLE } from "../src/device/ac/device.ts";
import { CommercialAirConditioner } from "../src/device/cc/device.ts";
import { Frame } from "../src/frame.ts";
import { FRAME_TYPE } from "../src/const.ts";
import { calculate as crc8 } from "../src/crc8.ts";
import { Lan, LanProtocol, Packet, ProtocolError } from "../src/lan.ts";
import {
  CapabilitiesResponse, EnergyUsageResponse, Group5Response, InvalidResponseError,
  PropertiesResponse, StateResponse, Response, PROPERTY_ID,
} from "../src/device/ac/command.ts";

function device(): AirConditioner {
  return new AirConditioner({ ip: "192.0.2.1", port: 6444, deviceId: 1 });
}
function frame(body: Uint8Array | number[], type = FRAME_TYPE.QUERY): Buffer {
  const payload = Buffer.from(body);
  return Buffer.from(new Frame(0xac, type).toBytes(Buffer.concat([payload, Buffer.from([crc8(payload)])])));
}
function transport(ac: AirConditioner, send: (data: Buffer) => Promise<Buffer[]>): void {
  (ac as any)._lan = { send };
}
const state = Buffer.from("c00145660000003c0010045c6b2000000000000000000002", "hex");

class ReceivingProtocol extends LanProtocol {
  receive(data: Buffer) { this._onData(data); }
}

describe("V2 stream framing", () => {
  const packet = Packet.encode(1, frame(state));
  it("reassembles a packet at every possible TCP split", async () => {
    for (let split = 1; split < packet.length; split++) {
      const protocol = new ReceivingProtocol();
      protocol.receive(packet.subarray(0, split));
      await expect(protocol.read(0)).rejects.toThrow("Queue is empty");
      protocol.receive(packet.subarray(split));
      expect(Packet.decode(await protocol.read(0))).toEqual(frame(state));
    }
  });
  it("handles byte-by-byte delivery and multiple packets in one chunk", async () => {
    const protocol = new ReceivingProtocol();
    for (const byte of packet) protocol.receive(Buffer.from([byte]));
    expect(await protocol.read(0)).toEqual(packet);
    protocol.receive(Buffer.concat([packet, packet, packet.subarray(0, 5)]));
    expect(await protocol.read(0)).toEqual(packet);
    expect(await protocol.read(0)).toEqual(packet);
    await expect(protocol.read(0)).rejects.toThrow("Queue is empty");
    protocol.receive(packet.subarray(5));
    expect(await protocol.read(0)).toEqual(packet);
  });
  it("rejects impossible lengths and recovers at the next packet", async () => {
    const protocol = new ReceivingProtocol();
    protocol.receive(Buffer.concat([Buffer.from([0x5a,0x5a,1,0x11,1,0]),packet]));
    await expect(protocol.read(0)).rejects.toThrow(ProtocolError);
    expect(await protocol.read(0)).toEqual(packet);
  });
  it("handles fragmented replies through Lan.send rather than bypassing decoding", async () => {
    const lan = new Lan("192.0.2.1", 6444, 1);
    const protocol = new ReceivingProtocol();
    Object.defineProperty(lan, "_alive", { get: () => true });
    (lan as any)._protocol = protocol;
    protocol.write = () => {
      protocol.receive(packet.subarray(0,7));
      protocol.receive(Buffer.concat([packet.subarray(7),packet]));
    };
    expect(await lan.send(frame(state))).toEqual([frame(state),frame(state)]);
  });
});

describe("capabilities and unsigned energy", () => {
  it("reports energy support independently from forced polling", async () => {
    const ac = device();
    let supported = true;
    transport(ac, async () => [frame([0xb5,1,0x16,0x02,1,supported ? 2 : 0])]);
    await ac.getCapabilities();
    expect(ac.enableEnergyUsageRequests).toBe(true);
    expect((ac.capabilitiesDict().additional_capabilities as number) & AC_CAPABILITY.ENERGY_STATS).toBe(AC_CAPABILITY.ENERGY_STATS);
    supported = false;
    await ac.getCapabilities();
    expect((ac.capabilitiesDict().additional_capabilities as number) & AC_CAPABILITY.ENERGY_STATS).toBe(0);
    expect(ac.enableEnergyUsageRequests).toBe(true);
  });
  it("decodes uint32 energy counters across the signed boundary, including subviews", () => {
    for (const value of [1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const storage = Buffer.alloc(30);
      const body = storage.subarray(3, 22);
      body[0] = 0xc1; body[3] = 4;
      body.writeUInt32BE(value, 4);
      body.writeUInt32BE(value, 12);
      const response = new EnergyUsageResponse(body);
      expect(response.totalEnergyBinary).toBe(value / 10);
      expect(response.currentEnergyBinary).toBe(value / 10);
    }
  });
});

describe("response body validation", () => {
  for (const [ResponseClass, minimum] of [[StateResponse,17],[EnergyUsageResponse,19],[Group5Response,11],[CapabilitiesResponse,2],[PropertiesResponse,2]] as const) {
    it(`rejects every short ${ResponseClass.name} body`, () => {
      for (let length=0; length<minimum; length++) {
        expect(() => new ResponseClass(Buffer.alloc(length))).toThrow(InvalidResponseError);
      }
    });
  }
  it("rejects checksum-valid but truncated state without changing cached values", async () => {
    const ac = device();
    transport(ac, async () => [frame(state)]);
    await ac.refresh();
    const previous = { temperature: ac.indoorTemperature, display: ac.displayOn, power: ac.powerState };
    transport(ac, async () => [frame([0xc0])]);
    await ac.refresh();
    expect(ac.indoorTemperature).toBe(previous.temperature);
    expect(ac.displayOn).toBe(previous.display);
    expect(ac.powerState).toBe(previous.power);
  });
  it("rejects capabilities and properties that overrun their declared body", () => {
    expect(() => new CapabilitiesResponse(Buffer.from([0xb5,1,0x16,2,2,1]))).toThrow(InvalidResponseError);
    expect(() => new PropertiesResponse(Buffer.from([0xb1,1,9,0,0,2,100]))).toThrow(InvalidResponseError);
    expect(() => new CapabilitiesResponse(Buffer.from([0xb5,1]))).toThrow(InvalidResponseError);
    expect(() => new PropertiesResponse(Buffer.from([0xb1,1]))).toThrow(InvalidResponseError);
  });
});

describe("negative property acknowledgements", () => {
  const failed = frame([0xb1,2,9,0,0x10,1,100,10,0,0,1,50]);
  it("ignores failed values while retaining successful properties from the same reply", async () => {
    const response = Response.construct(failed) as PropertiesResponse;
    expect(response.getProperty(PROPERTY_ID.SWING_UD_ANGLE)).toBeNull();
    expect(response.getProperty(PROPERTY_ID.SWING_LR_ANGLE)).toBe(50);
    const ac = device();
    ac.verticalSwingAngle = SWING_ANGLE.POS_2;
    transport(ac, async () => [failed]);
    await ac.refresh();
    expect(ac.verticalSwingAngle).toBe(25);
    expect(ac.horizontalSwingAngle).toBe(50);
  });
  it("rejects explicit property refusal and keeps the change pending for retry", async () => {
    const ac = device();
    ac.overrideCapabilities({ additional_capabilities: AC_CAPABILITY.SWING_VERTICAL_ANGLE });
    ac.verticalSwingAngle = SWING_ANGLE.POS_3;
    transport(ac, async data => data[10] === 0x40 ? [frame(state)] : [failed]);
    await expect(ac.apply()).rejects.toThrow("rejected property 0x0009");
    expect((ac as any)._updatedProperties.has(PROPERTY_ID.SWING_UD_ANGLE)).toBe(true);
    expect(ac.online).toBe(true);
  });
});

describe("write failure reporting", () => {
  for (const action of ["apply", "toggleDisplay", "startSelfClean"] as const) {
    for (const failure of ["protocol", "timeout", "empty", "invalid"] as const) {
      it(`rejects ${action} on ${failure}`, async () => {
        const ac = device();
        transport(ac, async () => {
          if (failure === "protocol") throw new ProtocolError("connection failed");
          if (failure === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
          return failure === "invalid" ? [frame([0xc0])] : [];
        });
        await expect(ac[action]()).rejects.toThrow();
        expect(ac.online).toBe(false);
      });
    }
  }
  it("still permits unanswered optional status queries", async () => {
    const ac = device(); ac.enableEnergyUsageRequests = true; ac.enableGroup5DataRequests = true;
    transport(ac, async data => data[10] === 0x41 && data[11] === 0x81 ? [frame(state)] : []);
    await ac.refresh();
    expect(ac.online).toBe(true);
    expect(ac.indoorTemperature).not.toBeNull();
  });
});

describe("commercial AC write failure reporting", () => {
  for (const failure of ["protocol", "empty", "invalid"] as const) {
    it(`rejects CC apply on ${failure} without discarding pending controls`, async () => {
      const ac = new CommercialAirConditioner({ ip: "192.0.2.1", port: 6444, deviceId: 1 });
      ac.powerState = true;
      (ac as any)._lan = { send: async () => {
        if (failure === "protocol") throw new ProtocolError("connection failed");
        return failure === "empty" ? [] : [frame(state)];
      }};
      await expect(ac.apply()).rejects.toThrow();
      expect(ac.online).toBe(false);
      expect((ac as any)._updatedControls.size).toBeGreaterThan(0);
    });
  }
});

describe("transport and write integration", () => {
  it("propagates exhausted LAN retries through AC apply", async () => {
    const lan = new Lan("192.0.2.1", 6444, 1);
    const protocol = new ReceivingProtocol();
    Object.defineProperty(lan, "_alive", { get: () => true });
    (lan as any)._protocol = protocol;
    let writes = 0;
    protocol.write = () => { writes++; };
    const read = protocol.read.bind(protocol);
    protocol.read = async (timeout = 2) => {
      if (timeout === 0) return read(0);
      throw new Error("Timeout");
    };
    const ac = device();
    (ac as any)._lan = lan;
    await expect(ac.apply()).rejects.toThrow(ProtocolError);
    expect(writes).toBe(3);
    expect(ac.online).toBe(false);
  });
  it("accepts valid AC writes and clears pending properties after acknowledgement", async () => {
    const ac = device();
    ac.verticalSwingAngle = SWING_ANGLE.POS_3;
    const requested: number[] = [];
    transport(ac, async data => {
      requested.push(data[10]!);
      return data[10] === 0x40 ? [frame(state)] : [frame([0xb0,1,9,0,0,1,50], FRAME_TYPE.CONTROL)];
    });
    await ac.apply();
    expect(requested).toEqual([0x40,0xb0]);
    expect(ac.verticalSwingAngle).toBe(50);
    expect((ac as any)._updatedProperties.size).toBe(0);
    expect(ac.online).toBe(true);
  });
  it("accepts valid commercial AC write replies", async () => {
    const ac = new CommercialAirConditioner({ ip: "192.0.2.1", port: 6444, deviceId: 1 });
    ac.powerState = true;
    (ac as any)._lan = { send: async () => [Buffer.from("aa16cc0000000000000200000101ff00120102ff000007", "hex")] };
    await ac.apply();
    expect(ac.online).toBe(true);
    expect((ac as any)._updatedControls.size).toBe(0);
  });
  it("detects malformed frame headers even when their checksum is valid", () => {
    for (const offset of [0,1]) {
      const message = frame(state);
      message[offset] = 0;
      message[message.length-1] = Frame.checksum(message.subarray(1,message.length-1));
      expect(() => Response.construct(message)).toThrow("header or declared length");
    }
  });
  it("records zero-length property refusals and never reads into the next property", () => {
    const refused = new PropertiesResponse(Buffer.from([0xb1,1,9,0,0x10,0]));
    expect(refused.getProperty(PROPERTY_ID.SWING_UD_ANGLE)).toBeNull();
    expect(refused.failedProperties.get(PROPERTY_ID.SWING_UD_ANGLE)).toBe(0x10);
    // Cascade needs two bytes, but its declared field length is one.
    expect(() => new PropertiesResponse(Buffer.from([0xb1,2,0x59,0,0,1,1,9,0,0,1,50]))).toThrow(InvalidResponseError);
  });
});
