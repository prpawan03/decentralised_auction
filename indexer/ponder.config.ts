// ---------------------------------------------------------------------------
// Ponder configuration: which chain, which contracts, from which block.
//
// Ponder evaluates this file with esbuild at start-up and re-evaluates it when
// any module it imports changes. `./deployment` is therefore the hot-reload
// hook: the deployer rewrites the deployment record, this file re-evaluates,
// and the indexing run restarts against the new addresses.
//
// The database is NOT configured here. Ponder reads DATABASE_URL from the
// environment and falls back to an embedded PGlite store under `.ponder/` when
// it is unset. That fallback is what makes `npm run dev` work on a laptop with
// no Postgres, and compose.indexer.yaml sets DATABASE_URL so the container
// uses the real one. Pinning `database: { kind: "postgres" }` here would break
// the laptop case for no gain.
// ---------------------------------------------------------------------------

import { createConfig } from "ponder";

import { auctionHouseAbi } from "./abis/auctionHouse";
import { demoNftAbi } from "./abis/demoNft";
import { auctionHouseAddress, demoNftAddress, startBlock } from "./deployment";

/** The local Hardhat chain. Compose resolves `chain` on the auction network. */
const CHAIN_ID = 31337;

export default createConfig({
  chains: {
    // The key is the chain NAME, and Ponder derives the environment variable
    // it reads from the chain id, not from this name: PONDER_RPC_URL_31337.
    hardhat: {
      id: CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_31337 ?? "http://chain:8545",

      // CRITICAL. Ponder caches RPC responses keyed by (chain id, block
      // number) and it assumes a block hash at a given height never changes.
      // A Hardhat node is recreated from genesis on every `docker compose up`,
      // so height 42 is a DIFFERENT block after every restart. With the cache
      // on, the second run replays the first run's logs and the indexed data
      // silently describes a chain that no longer exists. Ponder documents
      // this flag for exactly this case. Do not remove it here.
      //
      // The cost is real but small: every restart refetches every log. That is
      // acceptable because the chain is local and only thousands of blocks deep.
      disableCache: true,

      // Hardhat's default 1 s poll is fine, but under interval mining the head
      // only moves every BLOCK_TIME seconds, so polling faster only burns RPC
      // calls. See the BLOCK_TIME note in compose.indexer.yaml.
      pollingInterval: 1_000,
    },
  },

  contracts: {
    AuctionHouse: {
      chain: "hardhat",
      abi: auctionHouseAbi,
      address: auctionHouseAddress,
      startBlock,
    },
    DemoNFT: {
      chain: "hardhat",
      abi: demoNftAbi,
      address: demoNftAddress,
      startBlock,
    },
  },
});
