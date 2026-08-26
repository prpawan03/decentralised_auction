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
  },
};

await mkdir(DEPLOYMENTS_DIR, { recursive: true });
const outFile = path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
await writeFile(outFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\nBlock:  ${blockNumber}`);
console.log(`Record: ${outFile}`);
console.log("\nNext:  npm run seed   then   npm run export-abi");

await connection.close();
