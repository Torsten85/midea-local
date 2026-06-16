/**
 * Module for minimal Midea cloud access.
 *
 * Ported from msmart/cloud.py
 * @module
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { DEFAULT_CLOUD_REGION } from "./const.ts";
import type { DeviceType } from "./const.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random hex string of `byteLength` bytes (returns 2× chars). */
function tokenHex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

/** Generate a URL-safe base64 random string of `byteLength` bytes. */
function tokenUrlSafe(byteLength: number): string {
  return randomBytes(byteLength)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** PKCS#7 pad `data` to a multiple of `blockSize`. */
function pkcs7Pad(data: Uint8Array, blockSize: number): Uint8Array {
  const padLen = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);
  return padded;
}

/** PKCS#7 unpad `data`. */
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const padLen = data[data.length - 1]!;
  if (padLen === 0 || padLen > data.length) {
    throw new Error("Invalid PKCS#7 padding");
  }
  return data.slice(0, data.length - padLen);
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Generic exception for Midea cloud errors. */
export class CloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudError";
  }
}

/** Exception class for Midea cloud API errors. */
export class ApiError extends CloudError {
  readonly code: number | undefined;
  override readonly message: string;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "ApiError";
    this.message = message;
    this.code = code;
  }

  override toString(): string {
    return `Code: ${this.code}, Message: ${this.message}`;
  }
}

// ---------------------------------------------------------------------------
// BaseCloud
// ---------------------------------------------------------------------------

type CloudCredentials = Record<string, readonly [account: string, password: string]>;

/**
 * Base class for minimal Midea cloud access.
 *
 * Subclasses must implement `_parseResponse`, `_apiRequest`,
 * and `login`.
 */
export abstract class BaseCloud {
  /** Misc constants for the API. */
  static readonly APP_ID: string = "";
  static readonly CLIENT_TYPE = 1; // Android
  static readonly FORMAT = 2; // JSON
  static readonly LANGUAGE = "en_US";
  static readonly DEVICE_ID: string = tokenHex(8); // Random device ID

  /** Default number of request retries. */
  static readonly RETRIES = 3;

  /** Cloud credentials map – overridden by subclasses. */
  static readonly CLOUD_CREDENTIALS: CloudCredentials = {} as CloudCredentials;

  protected _baseUrl: string;
  protected _account: string;
  protected _password: string;
  protected _loginId: string | null = null;
  protected _session: Record<string, unknown> = {};

  /**
   * A simple concurrency guard. We serialize API calls with a promise chain
   * to replicate the Python `asyncio.Lock` behaviour.
   */
  private _apiLockPromise: Promise<void> = Promise.resolve();

  constructor(
    baseUrl: string,
    region: string | undefined,
    account: string | undefined,
    password: string | undefined,
  ) {
    const creds = (this.constructor as typeof BaseCloud).CLOUD_CREDENTIALS;

    // Validate incoming credentials and region
    if (account && password) {
      this._account = account;
      this._password = password;
    } else if (account || password) {
      throw new Error("Account and password must be specified.");
    } else {
      const pair = region != null ? creds[region] : undefined;
      if (!pair) {
        throw new Error(`Unknown cloud region '${region}'.`);
      }
      this._account = pair[0];
      this._password = pair[1];
    }

    this._baseUrl = baseUrl;
  }

  // -- Helpers --------------------------------------------------------------

  /** Format a timestamp for the API (UTC `YYYYMMDDHHmmss`). */
  protected _timestamp(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const h = String(now.getUTCHours()).padStart(2, "0");
    const mi = String(now.getUTCMinutes()).padStart(2, "0");
    const s = String(now.getUTCSeconds()).padStart(2, "0");
    return `${y}${mo}${d}${h}${mi}${s}`;
  }

  // -- Abstract methods (subclass must implement) ---------------------------

  /** Parse a raw fetch Response into a result object. */
  protected abstract _parseResponse(response: Response): Promise<Record<string, any>>;

  /** Make a request to the cloud and return the results. */
  protected abstract _apiRequest(endpoint: string, body: Record<string, any>): Promise<Record<string, any> | null>;

  /** Login to the cloud. */
  abstract login(force?: boolean): Promise<void>;

  // -- Request helpers ------------------------------------------------------

  /**
   * Post a request to the cloud with retry logic.
   *
   * Supports either raw JSON body (`rawData`) or form-encoded body (`formData`).
   */
  protected async _postRequest(
    url: string,
    options: {
      headers?: Record<string, string>;
      rawData?: string;
      formData?: Record<string, any>;
      retries?: number;
    } = {},
  ): Promise<Record<string, any> | null> {
    let retries = options.retries ?? BaseCloud.RETRIES;

    while (retries > 0) {
      try {
        let fetchInit: RequestInit;

        if (options.rawData != null) {
          fetchInit = {
            method: "POST",
            headers: options.headers ?? {},
            body: options.rawData,
            signal: AbortSignal.timeout(10_000),
          };
        } else if (options.formData != null) {
          // Build URL-encoded form body
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(options.formData)) {
            params.append(k, String(v));
          }
          const headers: Record<string, string> = {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(options.headers ?? {}),
          };
          fetchInit = {
            method: "POST",
            headers,
            body: params.toString(),
            signal: AbortSignal.timeout(10_000),
          };
        } else {
          fetchInit = {
            method: "POST",
            headers: options.headers ?? {},
            signal: AbortSignal.timeout(10_000),
          };
        }

        const r = await fetch(url, fetchInit);

        // Raise on bad status
        if (!r.ok) {
          throw new CloudError(`HTTP request failed: ${r.status} ${r.statusText}`);
        }

        // Parse the response
        return await this._parseResponse(r);
      } catch (e: unknown) {
        if (e instanceof CloudError) {
          throw e;
        }

        // Check for timeout / abort
        if (e instanceof DOMException && e.name === "TimeoutError") {
          if (retries > 1) {
            console.warn(`Request to ${url} timed out.`);
            retries -= 1;
            continue;
          }
          throw new CloudError("No response from server.");
        }

        // Other fetch errors
        throw new CloudError(`HTTP request failed: ${e}`);
      }
    }

    return null;
  }

  /** Build the base request body. */
  protected _buildRequestBody(data: Record<string, any>): Record<string, any> {
    const body: Record<string, any> = {
      appId: (this.constructor as typeof BaseCloud).APP_ID,
      src: (this.constructor as typeof BaseCloud).APP_ID,
      format: BaseCloud.FORMAT,
      clientType: BaseCloud.CLIENT_TYPE,
      language: BaseCloud.LANGUAGE,
      deviceId: BaseCloud.DEVICE_ID,
      stamp: this._timestamp(),
    };

    Object.assign(body, data);
    return body;
  }

  /**
   * Acquire the API lock, execute `fn`, and release.
   * Serializes concurrent calls (mirrors Python `async with self._api_lock`).
   */
  protected async _withApiLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this._apiLockPromise;
    this._apiLockPromise = next;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // -- Public API -----------------------------------------------------------

  /** Get a login ID for the cloud account. */
  protected async _getLoginId(): Promise<string> {
    const response = await this._apiRequest(
      "/v1/user/login/id/get",
      this._buildRequestBody({ loginAccount: this._account }),
    );

    if (response == null) {
      throw new CloudError("Failed to get login ID: null response.");
    }

    const loginId = response["loginId"] as string;
    return loginId;
  }

  /** Get token and key for the provided udpid. */
  async getToken(udpid: string): Promise<[token: string, key: string]> {
    const response = await this._apiRequest(
      "/v1/iot/secure/getToken",
      this._buildRequestBody({ udpid }),
    );

    if (response == null) {
      throw new CloudError("Failed to get token: null response.");
    }

    const tokenlist = response["tokenlist"] as Array<Record<string, string>>;
    for (const t of tokenlist) {
      if (t["udpId"] === udpid) {
        return [t["token"]!, t["key"]!];
      }
    }

    throw new CloudError(`No token/key found for udpid ${udpid}.`);
  }
}

// ---------------------------------------------------------------------------
// SmartHomeCloud
// ---------------------------------------------------------------------------

/** Cloud credentials for SmartHome per region. */
const SMART_HOME_CLOUD_CREDENTIALS = {
  DE: ["midea_eu@mailinator.com", "das_ist_passwort1"] as const,
  KR: ["midea_sea@mailinator.com", "password_for_sea1"] as const,
  US: ["midea@mailinator.com", "this_is_a_password1"] as const,
} as const satisfies CloudCredentials;

/**
 * SmartHome-specific security helper.
 *
 * Handles signing, password encryption, and AES operations using the
 * SmartHome app keys.
 */
class SmartHomeSecurity {
  static readonly HMAC_KEY = "PROD_VnoClJI9aikS8dyy";

  static readonly IOT_KEY = "meicloud";
  static readonly LOGIN_KEY = "ac21b9f9cbfe4ca5a88562ef25e2b768";

  static readonly IOT_KEY_CHINA = "prod_secret123@muc";
  static readonly LOGIN_KEY_CHINA = "ad0ee21d48a64bf49f4fb583ab76e799";

  // MSmartHome
  static readonly APP_KEY = "ac21b9f9cbfe4ca5a88562ef25e2b768";

  private readonly _useChinaServer: boolean;

  constructor(useChinaServer = false) {
    this._useChinaServer = useChinaServer;
  }

  /** Get the IOT key for the appropriate server. */
  private get _iotKey(): string {
    return this._useChinaServer ? SmartHomeSecurity.IOT_KEY_CHINA : SmartHomeSecurity.IOT_KEY;
  }

  /** Get the login key for the appropriate server. */
  private get _loginKey(): string {
    return this._useChinaServer ? SmartHomeSecurity.LOGIN_KEY_CHINA : SmartHomeSecurity.LOGIN_KEY;
  }

  /** Generate a HMAC signature for the provided data and random data. */
  sign(data: string, random: string): string {
    const msg = this._iotKey + data + random;
    const mac = createHmac("sha256", SmartHomeSecurity.HMAC_KEY);
    mac.update(msg, "ascii");
    return mac.digest("hex");
  }

  /** Encrypt the password for cloud password field. */
  encryptPassword(loginId: string, password: string): string {
    // Hash the password
    const m1 = createHash("sha256").update(password, "ascii").digest("hex");

    // Create the login hash with the login ID + password hash + login key, then hash again
    const loginHash = loginId + m1 + this._loginKey;
    const m2 = createHash("sha256").update(loginHash, "ascii").digest("hex");

    return m2;
  }

  /** Encrypt password for cloud iampwd field. */
  encryptIamPassword(loginId: string, password: string): string {
    // Hash the password with MD5
    const m1 = createHash("md5").update(password, "ascii").digest("hex");

    // Hash the password hash again with MD5
    const m2 = createHash("md5").update(m1, "ascii").digest("hex");

    if (this._useChinaServer) {
      return m2;
    }

    const loginHash = loginId + m2 + this._loginKey;
    const sha = createHash("sha256").update(loginHash, "ascii").digest("hex");

    return sha;
  }

  /** Derive AES key and IV from the APP_KEY. */
  private _getAppKeyAndIv(): [key: Buffer, iv: Buffer] {
    const hash = createHash("sha256").update(SmartHomeSecurity.APP_KEY).digest("hex");
    return [Buffer.from(hash.slice(0, 16), "utf-8"), Buffer.from(hash.slice(16, 32), "utf-8")];
  }

  /** AES-128-CBC encrypt data using the APP_KEY derived key/IV. */
  encryptAesAppKey(data: Uint8Array): Buffer {
    const [key, iv] = this._getAppKeyAndIv();
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const padded = pkcs7Pad(data, 16);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
  }

  /** AES-128-CBC decrypt data using the APP_KEY derived key/IV. */
  decryptAesAppKey(data: Uint8Array): Buffer {
    const [key, iv] = this._getAppKeyAndIv();
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return Buffer.from(pkcs7Unpad(decrypted));
  }
}

/** Minimal Midea SmartHome cloud access. */
export class SmartHomeCloud extends BaseCloud {
  static override readonly APP_ID = "1010";

  // Base URLs
  static readonly BASE_URL = "https://mp-prod.appsmb.com";
  static readonly BASE_URL_CHINA = "https://mp-prod.smartmidea.net";

  static override readonly CLOUD_CREDENTIALS: CloudCredentials = SMART_HOME_CLOUD_CREDENTIALS;

  private _accessToken = "";
  private readonly _security: SmartHomeSecurity;

  constructor(
    region: string = DEFAULT_CLOUD_REGION,
    options: {
      account?: string;
      password?: string;
      useChinaServer?: boolean;
    } = {},
  ) {
    // Allow override from environment
    let useChinaServer = options.useChinaServer ?? false;
    if (typeof process !== "undefined" && process.env?.["MIDEA_CHINA_SERVER"] === "1") {
      useChinaServer = true;
    }

    const baseUrl = useChinaServer ? SmartHomeCloud.BASE_URL_CHINA : SmartHomeCloud.BASE_URL;
    super(baseUrl, region, options.account, options.password);

    this._accessToken = "";
    this._security = new SmartHomeSecurity(useChinaServer);
  }

  /** Parse a response from the SmartHome cloud. */
  protected override async _parseResponse(response: Response): Promise<Record<string, any>> {
    const text = await response.text();
    const body = JSON.parse(text);

    const responseCode = Number(body["code"]);
    if (responseCode === 0) {
      return body["data"];
    }

    throw new ApiError(body["msg"], responseCode);
  }

  /** Make a request to the SmartHome cloud. */
  protected override async _apiRequest(
    endpoint: string,
    body: Record<string, any>,
  ): Promise<Record<string, any> | null> {
    // Encode body as JSON
    const contents = JSON.stringify(body);
    const random = tokenHex(16);

    // Sign the contents and add it to the header
    const sign = this._security.sign(contents, random);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      secretVersion: "1",
      sign,
      random,
      accessToken: this._accessToken,
    };

    // Build complete request URL
    const url = `${this._baseUrl}/mas/v5/app/proxy?alias=${endpoint}`;

    // Lock the API and post the request
    return this._withApiLock(() => this._postRequest(url, { headers, rawData: contents }));
  }

  /** Build a request body with SmartHome-specific fields. */
  protected override _buildRequestBody(data: Record<string, any>): Record<string, any> {
    const body = super._buildRequestBody({
      reqId: tokenHex(16),
    });

    Object.assign(body, data);
    return body;
  }

  /** Login to the SmartHome cloud. */
  override async login(force = false): Promise<void> {
    // Don't login if session already exists
    if (Object.keys(this._session).length > 0 && !force) {
      return;
    }

    // Get a login ID if we don't have one
    if (this._loginId == null) {
      this._loginId = await this._getLoginId();
    }

    // Build the login data
    const body = {
      data: {
        platform: BaseCloud.FORMAT,
        deviceId: BaseCloud.DEVICE_ID,
      },
      iotData: {
        appId: SmartHomeCloud.APP_ID,
        src: SmartHomeCloud.APP_ID,
        clientType: BaseCloud.CLIENT_TYPE,
        loginAccount: this._account,
        iampwd: this._security.encryptIamPassword(this._loginId, this._password),
        password: this._security.encryptPassword(this._loginId, this._password),
        pushToken: tokenUrlSafe(120),
        stamp: this._timestamp(),
        reqId: tokenHex(16),
      },
    };

    // Login and store the session
    const response = await this._apiRequest("/mj/user/login", body);

    if (response == null) {
      throw new CloudError("Login failed: null response.");
    }

    this._session = response;
    this._accessToken = (response["mdata"] as Record<string, any>)["accessToken"] as string;
  }

  /**
   * Fetch and decode the protocol Lua file.
   *
   * @returns A tuple of `[fileName, fileData]`.
   */
  async getProtocolLua(deviceType: DeviceType, sn: string): Promise<[fileName: string, fileData: string]> {
    const response = await this._apiRequest(
      "/v2/luaEncryption/luaGet",
      this._buildRequestBody({
        applianceMFCode: "0000",
        applianceSn: this._security.encryptAesAppKey(Buffer.from(sn, "utf-8")).toString("hex"),
        applianceType: `0x${deviceType.toString(16)}`,
        "encryptedType ": 2, // Note: trailing space in key matches Python source
        version: "0",
      }),
    );

    if (response == null) {
      throw new CloudError("Failed to get protocol Lua: null response.");
    }

    const fileName = response["fileName"] as string;
    const fileUrl = response["url"] as string;

    // Download the encrypted Lua file
    const r = await fetch(fileUrl, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      throw new CloudError(`HTTP request failed: ${r.status} ${r.statusText}`);
    }

    const encryptedHex = await r.text();
    const encryptedData = Buffer.from(encryptedHex, "hex");
    const fileData = this._security.decryptAesAppKey(encryptedData).toString("utf-8");

    return [fileName, fileData];
  }

  /**
   * Request and download the device plugin.
   *
   * @returns A tuple of `[fileName, fileData]`.
   */
  async getPlugin(deviceType: DeviceType, sn: string): Promise<[fileName: string, fileData: Uint8Array]> {
    const response = await this._apiRequest(
      "/v1/plugin/update/overseas/get",
      this._buildRequestBody({
        clientVersion: "0",
        uid: tokenHex(16),
        applianceList: [
          {
            appModel: sn.slice(9, 17),
            appType: `0x${deviceType.toString(16)}`,
            modelNumber: "0",
          },
        ],
      }),
    );

    if (response == null) {
      throw new CloudError("Failed to get plugin: null response.");
    }

    const result = (response["result"] as Array<Record<string, any>>)[0]!;

    const fileName = result["title"] as string;
    const fileUrl = result["url"] as string;

    // Download the plugin file
    const r = await fetch(fileUrl, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      throw new CloudError(`HTTP request failed: ${r.status} ${r.statusText}`);
    }

    const fileData = new Uint8Array(await r.arrayBuffer());
    return [fileName, fileData];
  }
}

// ---------------------------------------------------------------------------
// NetHomePlusCloud
// ---------------------------------------------------------------------------

/** Cloud credentials for NetHome Plus per region. */
const NET_HOME_PLUS_CLOUD_CREDENTIALS = {
  DE: ["nethome+de@mailinator.com", "password1"] as const,
  KR: ["nethome+sea@mailinator.com", "password1"] as const,
  US: ["nethome+us@mailinator.com", "password1"] as const,
} as const satisfies CloudCredentials;

/**
 * NetHome Plus-specific security helper.
 *
 * Handles signing and password encryption for the NetHome Plus cloud.
 */
class NetHomeSecurity {
  /** NetHome Plus app key used for signing. */
  static readonly APP_KEY = "3742e9e5842d4ad59c2db887e12449f9";

  /** Generate a signature for the provided data and URL. */
  sign(url: string, data: Record<string, any>): string {
    // Get path portion of request
    const parsedUrl = new URL(url, "https://placeholder.invalid");
    const path = parsedUrl.pathname;

    // Sort request keys and create a query string
    const sortedEntries = Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const params = new URLSearchParams();
    for (const [k, v] of sortedEntries) {
      params.append(k, String(v));
    }
    // Decode the query string (equivalent to Python's unquote_plus(urlencode(...)))
    const query = decodeURIComponent(params.toString().replace(/\+/g, " "));

    const msg = path + query + NetHomeSecurity.APP_KEY;
    return createHash("sha256").update(msg, "ascii").digest("hex");
  }

  /** Encrypt the login password. */
  encryptPassword(loginId: string, password: string): string {
    // Hash the password
    const m1 = createHash("sha256").update(password, "ascii").digest("hex");

    // Create the login hash with the login ID + password hash + app key, then hash again
    const loginHash = loginId + m1 + NetHomeSecurity.APP_KEY;
    const m2 = createHash("sha256").update(loginHash, "ascii").digest("hex");

    return m2;
  }
}

/** Minimal Midea NetHome Plus cloud access. */
export class NetHomePlusCloud extends BaseCloud {
  static override readonly APP_ID = "1017";

  static readonly BASE_URL = "https://mapp.appsmb.com";

  static override readonly CLOUD_CREDENTIALS: CloudCredentials = NET_HOME_PLUS_CLOUD_CREDENTIALS;

  private _sessionId = "";
  private readonly _security: NetHomeSecurity;

  constructor(
    region: string = DEFAULT_CLOUD_REGION,
    options: {
      account?: string;
      password?: string;
    } = {},
  ) {
    super(NetHomePlusCloud.BASE_URL, region, options.account, options.password);

    this._sessionId = "";
    this._security = new NetHomeSecurity();
  }

  /** Parse a response from the NetHome Plus cloud. */
  protected override async _parseResponse(response: Response): Promise<Record<string, any>> {
    const text = await response.text();
    const body = JSON.parse(text);

    const responseCode = Number(body["errorCode"]);
    if (responseCode === 0) {
      return body["result"];
    }

    throw new ApiError(body["msg"], responseCode);
  }

  /** Make a request to the NetHome Plus cloud. */
  protected override async _apiRequest(
    endpoint: string,
    body: Record<string, any>,
  ): Promise<Record<string, any> | null> {
    // Sign the contents and add it to the body
    body["sign"] = this._security.sign(endpoint, body);

    // Build complete request URL
    const url = `${this._baseUrl}${endpoint}`;

    // Lock the API and post the request
    return this._withApiLock(() => this._postRequest(url, { formData: body }));
  }

  /** Build a request body with NetHome Plus-specific fields. */
  protected override _buildRequestBody(data: Record<string, any>): Record<string, any> {
    const body = super._buildRequestBody({
      sessionId: this._sessionId,
    });

    Object.assign(body, data);
    return body;
  }

  /** Login to the NetHome Plus cloud. */
  override async login(force = false): Promise<void> {
    // Don't login if session already exists
    if (Object.keys(this._session).length > 0 && !force) {
      return;
    }

    // Get a login ID if we don't have one
    if (this._loginId == null) {
      this._loginId = await this._getLoginId();
    }

    // Login and store the session
    const response = await this._apiRequest(
      "/v1/user/login",
      this._buildRequestBody({
        loginAccount: this._account,
        password: this._security.encryptPassword(this._loginId, this._password),
      }),
    );

    if (response == null) {
      throw new CloudError("Login failed: null response.");
    }

    this._session = response;
    this._sessionId = response["sessionId"] as string;
  }

  /** Fetch and decode the protocol Lua file (not implemented for NetHome Plus). */
  async getProtocolLua(_deviceType: DeviceType, _sn: string): Promise<[fileName: string, fileData: string]> {
    throw new Error("Not implemented");
  }

  /** Request and download the device plugin (not implemented for NetHome Plus). */
  async getPlugin(_deviceType: DeviceType, _sn: string): Promise<[fileName: string, fileData: Uint8Array]> {
    throw new Error("Not implemented");
  }
}
