/**
 * Utility classes and helpers for Midea AC.
 *
 * Ported from msmart/utils.py
 * @module
 */

// ---------------------------------------------------------------------------
// CapabilityManager – mutable bitwise flag wrapper
// ---------------------------------------------------------------------------

/**
 * Minimal wrapper to make mutable capability flags.
 *
 * `T` should be a numeric type whose values represent bit-flags
 * (e.g. values produced by an `as const` flags object).
 *
 * All bitwise operations treat the internal value as an integer.
 */
export class CapabilityManager<T extends number> {
  private _flags: T;

  constructor(defaultFlags: T) {
    this._flags = defaultFlags;
  }

  /** The raw numeric value of the current flags. */
  get value(): number {
    return this._flags;
  }

  /** The current flags value (typed as `T`). */
  get flags(): T {
    return this._flags;
  }

  /** Replace the flags value entirely. */
  set flags(flags: T) {
    this._flags = flags;
  }

  /** Return `true` if **all** bits in `flag` are set. */
  has(flag: T): boolean {
    return (this._flags & flag) !== 0;
  }

  /**
   * Set or clear the given flag bits.
   *
   * @param flag   - The flag bits to modify.
   * @param enable - When `true` (default) the bits are set; when `false` they
   *                 are cleared.
   */
  set(flag: T, enable = true): void {
    if (enable) {
      this._flags = (this._flags | flag) as T;
    } else {
      this._flags = (this._flags & ~flag) as T;
    }
  }
}

// ---------------------------------------------------------------------------
// Const-object "enum" helpers
// ---------------------------------------------------------------------------

/**
 * A const object whose values are all `number`.
 *
 * Used as a constraint for the helper functions below so they work with any
 * `as const` object (e.g. `DEVICE_TYPE`, `FRAME_TYPE`, capability-flag
 * objects, etc.).
 */
type ConstEnum = Record<string, number>;

/**
 * Look up an entry in a const-object by its **numeric value**.
 *
 * If the value is not found (or is `undefined`/`null`), `defaultValue` is
 * returned.  If `defaultValue` is also omitted the function returns
 * `undefined`.
 *
 * @param constObj     - The `as const` object to search.
 * @param value        - The numeric value to look up.
 * @param defaultValue - Fallback value when the lookup fails.
 */
export function getFromValue<V extends number>(
  constObj: Record<string, V>,
  value: number | undefined | null,
  defaultValue?: V,
): V | undefined {
  if (value != null) {
    const values = Object.values(constObj) as V[];
    const found = values.find((v) => v === value);
    if (found !== undefined) return found;
  }
  return defaultValue;
}

/**
 * Look up an entry in a const-object by its **key name** (case-sensitive).
 *
 * If the name is not found (or is `undefined`/`null`), `defaultValue` is
 * returned.  If `defaultValue` is also omitted the function returns
 * `undefined`.
 *
 * @param constObj     - The `as const` object to search.
 * @param name         - The key name to look up.
 * @param defaultValue - Fallback value when the lookup fails.
 */
export function getFromName<E extends ConstEnum>(
  constObj: E,
  name: string | undefined | null,
  defaultValue?: E[keyof E],
): E[keyof E] | undefined {
  if (name != null && name in constObj) {
    return constObj[name] as E[keyof E];
  }
  return defaultValue;
}

/**
 * Return all numeric values of a const-object.
 *
 * @param constObj - The `as const` object.
 */
export function listValues<E extends ConstEnum>(constObj: E): Array<E[keyof E]> {
  return Object.values(constObj) as Array<E[keyof E]>;
}
