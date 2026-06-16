/**
 * Midea protocol frame construction and validation.
 *
 * Ported from msmart/frame.py
 * @module
 */

import type { DeviceType, FrameType } from "./const.ts";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a received frame fails structural or checksum validation. */
export class InvalidFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFrameError";
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/**
 * Represents a Midea V2/V3 protocol frame.
 *
 * Use {@link toBytes} to serialise a command payload into a full frame, or
 * call the static {@link validate} method to verify an incoming frame.
 */
export class Frame {
  /** Length of the fixed frame header (bytes). */
  private static readonly HEADER_LENGTH = 10;

  private readonly _deviceType: DeviceType;
  private readonly _frameType: FrameType;
  private _protocolVersion: number;

  constructor(deviceType: DeviceType, frameType: FrameType) {
    this._deviceType = deviceType;
    this._frameType = frameType;
    this._protocolVersion = 0;
  }

  /**
   * Serialise a data payload into a complete protocol frame.
   *
   * The returned `Uint8Array` contains the 10-byte header, the payload, and
   * a trailing checksum byte.
   *
   * @param data - Optional payload bytes (defaults to an empty buffer).
   */
  toBytes(data: Uint8Array = new Uint8Array(0)): Uint8Array {
    // Build frame header
    const header = new Uint8Array(Frame.HEADER_LENGTH);

    // Start byte
    header[0] = 0xaa;

    // Length of header + data (not including the checksum byte appended later)
    header[1] = data.length + Frame.HEADER_LENGTH;

    // Device / appliance type
    header[2] = this._deviceType;

    // Device protocol version
    header[8] = this._protocolVersion;

    // Frame type
    header[9] = this._frameType;

    // Concatenate header + data
    const frame = new Uint8Array(header.length + data.length + 1);
    frame.set(header, 0);
    frame.set(data, header.length);

    // Append checksum over bytes [1 .. end-of-data]
    frame[frame.length - 1] = Frame.checksum(
      frame.subarray(1, frame.length - 1),
    );

    return frame;
  }

  /**
   * Compute the Midea frame checksum.
   *
   * The checksum is the two's-complement of the byte-sum, masked to 8 bits:
   * `(~sum + 1) & 0xFF`.
   *
   * @param frame - The bytes to checksum (typically `frame[1:]` excluding the
   *                trailing checksum byte itself).
   */
  static checksum(frame: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i]!;
    }
    return (~sum + 1) & 0xff;
  }

  /**
   * Validate a received frame.
   *
   * Checks minimum length, checksum integrity, and device-type match.
   * Throws {@link InvalidFrameError} on any mismatch.
   *
   * @param frame              - The raw frame bytes (may be a sub-view).
   * @param expectedDeviceType - The device type that must appear at offset 2.
   */
  static validate(
    frame: Uint8Array,
    expectedDeviceType: DeviceType,
  ): void {
    // Ensure length is sane
    if (frame.length < Frame.HEADER_LENGTH) {
      throw new InvalidFrameError(
        `Frame is too short: ${Buffer.from(frame).toString("hex")}`,
      );
    }

    // Validate frame checksum
    const checksum = Frame.checksum(frame.subarray(1, frame.length - 1));
    if (checksum !== frame[frame.length - 1]) {
      throw new InvalidFrameError(
        `Frame '${Buffer.from(frame).toString("hex")}' failed checksum. ` +
          `Received: 0x${(frame[frame.length - 1]!).toString(16).toUpperCase()}, ` +
          `Expected: 0x${checksum.toString(16).toUpperCase()}.`,
      );
    }

    // Check device type matches
    const deviceType = frame[2]!;
    if (deviceType !== expectedDeviceType) {
      throw new InvalidFrameError(
        `Received device type 0x${deviceType.toString(16).toUpperCase()} ` +
          `does not match expected device type ` +
          `0x${expectedDeviceType.toString(16).toUpperCase()}.`,
      );
    }
  }
}
