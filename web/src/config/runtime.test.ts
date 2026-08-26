import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./runtime";

/**
 * Config resolution order is a deployment contract, not a preference:
 *   window.__AUCTION_CONFIG__  >  import.meta.env.VITE_*  >  local defaults
 *
 * If layer 1 ever stops winning, one built image can no longer serve more than
 * one chain, and the address gets baked into the bundle — the exact failure
 * this indirection exists to prevent.
 */

const REAL_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OTHER_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("runtime config resolution", () => {
  beforeEach(() => {
    delete window.__AUCTION_CONFIG__;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete window.__AUCTION_CONFIG__;
  });

  it("falls back to the documented local defaults with nothing injected", () => {
    const config = resolveConfig();
    expect(config.chainId).toBe(31337);
    expect(config.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(config.auctionHouseAddress).toBe(REAL_ADDRESS);
    expect(config.source).toBe("default");
  });

  it("lets the runtime-injected object win", () => {
    window.__AUCTION_CONFIG__ = {
      chainId: 1337,
      rpcUrl: "http://node.internal:8545",
      auctionHouseAddress: OTHER_ADDRESS,
    };
    const config = resolveConfig();
    expect(config.chainId).toBe(1337);
    expect(config.rpcUrl).toBe("http://node.internal:8545");
    expect(config.auctionHouseAddress).toBe(OTHER_ADDRESS);
    expect(config.source).toBe("runtime");
  });

  it("accepts a chain id injected as a string, since env vars are strings", () => {
    window.__AUCTION_CONFIG__ = { chainId: "5" };
    expect(resolveConfig().chainId).toBe(5);
  });

  it("ignores an unsubstituted ${VAR} placeholder instead of treating it as a value", () => {
    /* A broken entrypoint template must degrade to the default, not to a
       literal '${AUCTION_HOUSE_ADDRESS}' that fails every read. */
    window.__AUCTION_CONFIG__ = { auctionHouseAddress: "${AUCTION_HOUSE_ADDRESS}" };
    const config = resolveConfig();
    expect(config.auctionHouseAddress).toBe(REAL_ADDRESS);
    expect(config.source).toBe("default");
  });

  it("ignores empty strings, which is what an unset env var becomes", () => {
    window.__AUCTION_CONFIG__ = { rpcUrl: "", chainName: "   " };
    const config = resolveConfig();
    expect(config.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(config.chainName).toBe("Auction Local");
  });

  it("rejects a malformed address and warns rather than silently misconfiguring", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.__AUCTION_CONFIG__ = { auctionHouseAddress: "0xnot-an-address" };
    const config = resolveConfig();
    expect(config.auctionHouseAddress).toBe(REAL_ADDRESS);
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a non-positive chain id", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.__AUCTION_CONFIG__ = { chainId: 0 };
    expect(resolveConfig().chainId).toBe(31337);
  });

  it("never carries an empty optional field through as an empty string", () => {
    window.__AUCTION_CONFIG__ = { walletConnectProjectId: "" };
    expect(resolveConfig().walletConnectProjectId).toBeUndefined();
  });
});
