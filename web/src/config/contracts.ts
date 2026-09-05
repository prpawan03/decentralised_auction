import { auctionHouseAbi } from "@/abi/auctionHouse";
import { demoNftAbi } from "@/abi/demoNft";
import { config } from "./runtime";
import { localChain } from "./chain";

/**
 * The two bindings every hook spreads into a read or write. Address and chain
 * come from runtime config, so nothing here is fixed at build time.
 */
export const auctionHouse = {
  address: config.auctionHouseAddress,
  abi: auctionHouseAbi,
  chainId: localChain.id,
} as const;

export const demoNft = {
  address: config.demoNftAddress,
  abi: demoNftAbi,
  chainId: localChain.id,
} as const;

/**
 * Contract constants, mirrored from docs/CONTRACT_INTERFACE.md so forms can
 * validate before they ever touch the chain. `useProtocolConstants` reads the
 * real on-chain values and the create form prefers those when they arrive;
 * these are the offline fallback, not the source of truth.
 */
export const CONTRACT_LIMITS = {
  MIN_DURATION: 60n, // 1 minute
  MAX_DURATION: 2_592_000n, // 30 days
  ANTI_SNIPE_WINDOW: 300n, // 5 minutes
  MAX_EXTENSIONS: 20n,
  DEFAULT_INCREMENT_BPS: 500n, // 5%
  MAX_INCREMENT_BPS: 5_000n, // 50%, the largest step a seller may set
  MIN_INCREMENT: 100_000_000_000_000n, // 0.0001 ether
  MAX_FEE_BPS: 1000n,
  MAX_PAGE_SIZE: 100n,
  /* uint96 ceiling: the contract reverts with ValueTooLarge above this. */
  MAX_UINT96: 2n ** 96n - 1n,
} as const;
