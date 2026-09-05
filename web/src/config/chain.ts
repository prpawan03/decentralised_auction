import { defineChain } from "viem";
import { config } from "./runtime";

/**
 * The local chain, described from runtime config rather than a hard-coded
 * constant, so a rebuilt image can point at a different node.
 *
 * `contracts.multicall3` is the canonical CREATE2 address. wagmi's
 * `readContracts` folds the auction grid into one eth_call through it and does
 * NOT fall back to individual calls: a node with no code at this address shows
 * "Could not read the chain" on every route. Anvil predeploys it; the Hardhat
 * node does not, so contracts/scripts/deploy.ts deploys the vendored
 * Multicall3 and copies its runtime code here with hardhat_setCode.
 */
export const localChain = defineChain({
  id: config.chainId,
  name: config.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [config.rpcUrl] },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 0,
    },
  },
  ...(config.blockExplorerUrl
    ? {
        blockExplorers: {
          default: { name: "Explorer", url: config.blockExplorerUrl },
        },
      }
    : {}),
  testnet: true,
});

/**
 * The EIP-3085 payload for `wallet_addEthereumChain`. MetaMask only accepts
 * this shape, and only after `wallet_switchEthereumChain` has failed with 4902
 * ("unrecognised chain").
 */
export const addChainParams = {
  chainId: `0x${config.chainId.toString(16)}`,
  chainName: config.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [config.rpcUrl],
  ...(config.blockExplorerUrl ? { blockExplorerUrls: [config.blockExplorerUrl] } : {}),
} as const;
