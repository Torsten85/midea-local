/**
 * Cloud module tests.
 *
 * Ported from msmart/tests/test_cloud.py
 *
 * These tests hit real Midea cloud servers, so they are skipped in CI.
 */

import { describe, it, expect } from "bun:test";
import {
  BaseCloud,
  NetHomePlusCloud,
  SmartHomeCloud,
  ApiError,
  CloudError,
} from "../src/cloud.ts";
import { DEFAULT_CLOUD_REGION } from "../src/const.ts";

// ─── TestNetHomePlusCloud ───────────────────────────────────────────────────

// NOTE: Skipped by default — these tests hit real cloud servers and require valid credentials.
describe.skip("NetHomePlusCloud", () => {
  /** Helper: login with optional overrides. */
  async function login(opts?: {
    region?: string;
    account?: string;
    password?: string;
  }): Promise<NetHomePlusCloud> {
    const client = new NetHomePlusCloud(opts?.region ?? DEFAULT_CLOUD_REGION, {
      account: opts?.account,
      password: opts?.password,
    });
    await client.login();
    return client;
  }

  it("should login to the cloud", async () => {
    const client = await login();

    expect((client as any)._session).not.toBeNull();
    expect((client as any)._sessionId).not.toBeNull();
  });

  it("should throw ApiError with bad credentials", async () => {
    await expect(
      login({ account: "bad@account.com", password: "not_a_password" }),
    ).rejects.toThrow(ApiError);
  });

  it("should throw on invalid region", async () => {
    await expect(login({ region: "NOT_A_REGION" })).rejects.toThrow();
  });

  it("should throw on invalid credentials (partial)", async () => {
    // Only password, no account
    await expect(
      login({ account: undefined, password: "some_password" }),
    ).rejects.toThrow();

    // Only account, no password
    await expect(
      login({ account: "some_account", password: undefined }),
    ).rejects.toThrow();
  });

  it("should get token and key", async () => {
    const DUMMY_UDPID = "4fbe0d4139de99dd88a0285e14657045";

    const client = await login();
    const [token, key] = await client.getToken(DUMMY_UDPID);

    expect(token).not.toBeNull();
    expect(key).not.toBeNull();
  });

  it("should throw CloudError when token cannot be obtained", async () => {
    const BAD_UDPID = "NOT_A_UDPID";

    const client = await login();

    await expect(client.getToken(BAD_UDPID)).rejects.toThrow(CloudError);
  });

  it("should throw CloudError when cloud connection fails", async () => {
    const client = new NetHomePlusCloud(DEFAULT_CLOUD_REGION);

    // Override URL to an invalid domain
    (client as any)._baseUrl = "https://fake_server.invalid.";

    await expect(client.login()).rejects.toThrow(CloudError);
  });
});

// ─── TestSmartHomeCloud ─────────────────────────────────────────────────────

// NOTE: Skipped by default — same as above.
describe.skip("SmartHomeCloud", () => {
  /** Helper: login with optional overrides. */
  async function login(opts?: {
    region?: string;
    account?: string;
    password?: string;
  }): Promise<SmartHomeCloud> {
    const client = new SmartHomeCloud(opts?.region ?? DEFAULT_CLOUD_REGION, {
      account: opts?.account,
      password: opts?.password,
    });
    await client.login();
    return client;
  }

  it("should login to the cloud", async () => {
    const client = await login();

    expect((client as any)._session).not.toBeNull();
    expect((client as any)._accessToken).not.toBeNull();
  });

  it("should throw ApiError with bad credentials", async () => {
    await expect(
      login({ account: "bad@account.com", password: "not_a_password" }),
    ).rejects.toThrow(ApiError);
  });

  it("should throw on invalid region", async () => {
    await expect(login({ region: "NOT_A_REGION" })).rejects.toThrow();
  });

  it("should throw on invalid credentials (partial)", async () => {
    // Only password, no account
    await expect(
      login({ account: undefined, password: "some_password" }),
    ).rejects.toThrow();

    // Only account, no password
    await expect(
      login({ account: "some_account", password: undefined }),
    ).rejects.toThrow();
  });

  // NOTE: get_token tests are disabled in the Python source until the broken API is fixed.
  it("should handle get_token (disabled pending API fix)", () => {
    // Intentionally left empty — mirrors the disabled Python tests
  });

  it("should handle get_token_exception (disabled pending API fix)", () => {
    // Intentionally left empty — mirrors the disabled Python tests
  });

  it("should throw CloudError when cloud connection fails", async () => {
    const client = new SmartHomeCloud(DEFAULT_CLOUD_REGION);

    // Override URL to an invalid domain
    (client as any)._baseUrl = "https://fake_server.invalid.";

    await expect(client.login()).rejects.toThrow(CloudError);
  });
});
