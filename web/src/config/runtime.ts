import type { Address } from "viem";
import { isAddress } from "viem";
import deployment from "@/deployments/31337.json";
import { DEFAULT_IPFS_GATEWAY } from "@/lib/nftMetadata";

/**
 * Runtime configuration, resolved in exactly this order:
 *
 *   1. window.__AUCTION_CONFIG__  — written into /config.js by the nginx
 *                                   entrypoint at container start.
 *   2. import.meta.env.VITE_*     — a developer's local .env.
 *   3. local defaults             — chainId 31337, http://127.0.0.1:8545,
 *                                   and the deterministic deploy addresses.
 *
 * The point of layer 1 is that ONE built image runs against ANY chain. If the
 * address were read from import.meta.env alone it would be substituted into
 * the bundle at build time and the image would be pinned to one deployment.
 */

export interface AuctionConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  auctionHouseAddress: Address;
  demoNftAddress: Address;
  blockExplorerUrl?: string;
  /** WalletConnect project id. Optional: a local demo has no reason to need one. */
  walletConnectProjectId?: string;
  /**
   * Where `ipfs://` metadata is rewritten to. Configurable because a public
   * gateway is a third party that sees every token a viewer looks at, and an
   * operator running their own node should be able to point at it.
   */
  ipfsGateway: string;
  /** Which layer actually supplied the values. Surfaced in the diagnostics panel. */
  source: "runtime" | "env" | "default";
}

declare global {
  interface Window {
    __AUCTION_CONFIG__?: Partial<
      Record<keyof Omit<AuctionConfig, "source">, string | number | undefined>
    >;
  }
}

const DEFAULTS = {
  chainId: 31337,
  chainName: "Auction Local",
  rpcUrl: "http://127.0.0.1:8545",
  /* `contracts`, not flat keys. This file is written by
     contracts/scripts/export-abi.ts, and reading a shape it does not produce
     made `npm run export-abi` - a documented step in the deploy workflow -
     break the typecheck and leave both defaults undefined. */
  auctionHouseAddress: deployment.contracts.AuctionHouse as Address,
  demoNftAddress: deployment.contracts.DemoNFT as Address,
  ipfsGateway: DEFAULT_IPFS_GATEWAY,
} as const;

function readRuntime(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const injected = window.__AUCTION_CONFIG__;
  if (!injected || typeof injected !== "object") return {};
  /* Strip empty strings: an unsubstituted `${VAR}` placeholder is not a value. */
  return Object.fromEntries(
    Object.entries(injected).filter(
      ([, v]) =>
        v !== undefined && v !== null && String(v).trim() !== "" && !String(v).includes("${"),
    ),
  );
}

function readEnv(): Record<string, unknown> {
  const e = import.meta.env;
  const entries: Array<[string, unknown]> = [
    ["chainId", e.VITE_CHAIN_ID],
    ["chainName", e.VITE_CHAIN_NAME],
    ["rpcUrl", e.VITE_RPC_URL],
    ["auctionHouseAddress", e.VITE_AUCTION_HOUSE_ADDRESS],
    ["demoNftAddress", e.VITE_DEMO_NFT_ADDRESS],
    ["blockExplorerUrl", e.VITE_BLOCK_EXPLORER_URL],
    ["walletConnectProjectId", e.VITE_WALLETCONNECT_PROJECT_ID],
    ["ipfsGateway", e.VITE_IPFS_GATEWAY],
  ];
  return Object.fromEntries(entries.filter(([, v]) => v !== undefined && String(v).trim() !== ""));
}

function asAddress(value: unknown, fallback: Address, field: string): Address {
  if (typeof value !== "string") return fallback;
  if (!isAddress(value)) {
    console.warn(
      `[config] ${field} is not a valid address ("${value}"). Falling back to ${fallback}.`,
    );
    return fallback;
  }
  return value;
}

function asNumber(value: unknown, fallback: number, field: string): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    if (value !== undefined) {
      console.warn(
        `[config] ${field} is not a positive integer ("${String(value)}"). Using ${fallback}.`,
      );
    }
    return fallback;
  }
  return n;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function build(): AuctionConfig {
  const runtime = readRuntime();
  const env = readEnv();

  const source: AuctionConfig["source"] =
    Object.keys(runtime).length > 0 ? "runtime" : Object.keys(env).length > 0 ? "env" : "default";

  const pick = (key: string): unknown => runtime[key] ?? env[key];

  const explorer = pick("blockExplorerUrl");
  const wcProjectId = pick("walletConnectProjectId");

  return {
    chainId: asNumber(pick("chainId"), DEFAULTS.chainId, "chainId"),
    chainName: asString(pick("chainName"), DEFAULTS.chainName),
    rpcUrl: asString(pick("rpcUrl"), DEFAULTS.rpcUrl),
    auctionHouseAddress: asAddress(
      pick("auctionHouseAddress"),
      DEFAULTS.auctionHouseAddress,
      "auctionHouseAddress",
    ),
    demoNftAddress: asAddress(pick("demoNftAddress"), DEFAULTS.demoNftAddress, "demoNftAddress"),
    ...(typeof explorer === "string" && explorer !== "" ? { blockExplorerUrl: explorer } : {}),
    ...(typeof wcProjectId === "string" && wcProjectId !== ""
      ? { walletConnectProjectId: wcProjectId }
      : {}),
    /* Always trailing-slashed, so callers can concatenate a CID without
       having to care how the operator wrote the value. */
    ipfsGateway: asString(pick("ipfsGateway"), DEFAULTS.ipfsGateway).replace(/\/?$/, "/"),
    source,
  };
}

/**
 * Resolved once at module load. The nginx entrypoint runs before the bundle is
 * fetched, so /config.js is always in place by the time this evaluates.
 */
export const config: AuctionConfig = build();

/** Test seam: rebuild after mutating window.__AUCTION_CONFIG__. */
export const resolveConfig = build;
