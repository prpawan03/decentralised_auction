import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Deploys `DemoNFT` and `AuctionHouse` and records the result.
 *
 * The record is written to `contracts/deployments/<chainId>.json`, which
 * `scripts/export-abi.ts` copies into the web app. Run it against a local node:
 *
 *   npm run node        # in one terminal
 *   npm run deploy      # in another
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_DIR = path.resolve(HERE, "..", "deployments");

/** The platform fee the house starts with, in basis points. 250 bps is 2.5%. */
const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 250);

const connection = await network.create();
const { viem, networkName } = connection;

const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();

console.log(`Deploying to "${networkName}" (chain ${chainId})`);
console.log(`Deployer: ${deployer.account.address}`);

// The collection first. The house does not depend on it, but the seeder and
// the UI both need an NFT they are allowed to mint.
const nft = await viem.deployContract("DemoNFT");
console.log(`  DemoNFT       ${nft.address}`);

// The owner and the fee recipient both start as the deployer. Ownership moves
// in two steps, so a typo here cannot lock the contract.
const house = await viem.deployContract("AuctionHouse", [
  deployer.account.address,
  deployer.account.address,
  PLATFORM_FEE_BPS,
]);
console.log(`  AuctionHouse  ${house.address}`);

// Multicall3. The web app batches every read through it at the canonical
// CREATE2 address, and viem's chain definition points there. Anvil predeploys
// it; the Hardhat node does not. Without this step the board shows "Could not
// read the chain" for every route until something else puts code there.
// Deploy the vendored source, then copy its runtime code to the canonical
// address with hardhat_setCode, which only a local development node accepts.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const existing = await publicClient.getCode({ address: MULTICALL3 });
if (existing && existing !== "0x") {
  console.log(`  Multicall3    ${MULTICALL3} (already present)`);
} else {
  const multicall = await viem.deployContract("Multicall3");
  const code = await publicClient.getCode({ address: multicall.address });
  if (!code || code === "0x") throw new Error("Multicall3 deployed but has no code");
  await connection.provider.request({ method: "hardhat_setCode", params: [MULTICALL3, code] });
  const placed = await publicClient.getCode({ address: MULTICALL3 });
  if (placed !== code) throw new Error("hardhat_setCode did not place Multicall3 at the canonical address");
  console.log(`  Multicall3    ${MULTICALL3} (runtime code copied from ${multicall.address})`);
}

const blockNumber = await publicClient.getBlockNumber();

const record = {
  chainId,
  network: networkName,
  // ISO 8601, UTC.
  deployedAt: new Date().toISOString(),
  blockNumber: Number(blockNumber),
  deployer: deployer.account.address,
  platformFeeBps: PLATFORM_FEE_BPS,
  contracts: {
    AuctionHouse: house.address,
    DemoNFT: nft.address,
    Multicall3: MULTICALL3,
  },
};

await mkdir(DEPLOYMENTS_DIR, { recursive: true });
const outFile = path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
await writeFile(outFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\nBlock:  ${blockNumber}`);
console.log(`Record: ${outFile}`);
console.log("\nNext:  npm run seed   then   npm run export-abi");

await connection.close();
