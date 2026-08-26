// Hardhat 3 configuration for the standalone development chain.
//
// This file configures ONLY the local node. The contracts workspace has its
// own configuration. Keep the two separate. A change here MUST NOT need a
// change in contracts/.
//
// IMPORTANT: THE NETWORK IS NAMED `node`, NOT `hardhat`.
// In Hardhat 3 the `node` task reads the network that is named `node`:
//
//     const network = hre.globalOptions.network ?? "node";
//     (hardhat/dist/src/internal/builtin-plugins/node/task-action.js)
//
// A `networks.hardhat` block is therefore IGNORED by `hardhat node`. That
// block also fails silently, because the built-in defaults already use chain
// id 31337 and the standard test mnemonic. The node then looks correct while
// it ignores `mining` and every other setting. This was measured: with
// `networks.hardhat` the node produced no interval blocks.
//
// Environment variables:
//   CHAIN_ID    Numeric chain identifier. Default 31337.
//   MNEMONIC    BIP-39 seed phrase for the funded accounts.
//   BLOCK_TIME  Seconds between blocks. 0 selects automatic mining.

const chainId = Number(process.env.CHAIN_ID ?? 31337);
const blockTime = Number(process.env.BLOCK_TIME ?? 0);
const mnemonic =
  process.env.MNEMONIC ??
  "test test test test test test test test test test test junk";

// Automatic mining makes one block for each transaction, at once.
// Interval mining makes one block every `blockTime` seconds. Interval mining
// shows the pending state during a demonstration.
const mining =
  blockTime > 0
    ? { auto: false, interval: blockTime * 1000 }
    : { auto: true, interval: 0 };

// 10 accounts. Each account holds 10000 test ETH. The ETH has no value and
// the mnemonic is public. Never use these accounts on a public network.
const accounts = {
  mnemonic,
  path: "m/44'/60'/0'/0",
  count: 10,
  initialIndex: 0,
  accountsBalance: "10000000000000000000000",
};

const chain = {
  type: "edr-simulated",
  chainType: "l1",
  chainId,
  accounts,
  mining,
  loggingEnabled: true,
};

/** @type {import("hardhat/config").HardhatUserConfig} */
export default {
  networks: {
    // `hardhat node` serves this one.
    node: chain,
    // The in-process network, for a task that runs against a simulated chain.
    default: chain,
  },
};
