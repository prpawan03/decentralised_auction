import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

/**
 * A well-known throwaway mnemonic. It is the Hardhat / Anvil default, so the
 * demo works out of the box. Set MNEMONIC in the environment to override it.
 * MUST NOT be used on a public network.
 */
const DEMO_MNEMONIC =
  process.env.MNEMONIC ??
  "test test test test test test test test test test test junk";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],

  paths: {
    sources: ["src", "test/mocks"],
    tests: {
      solidity: "test",
      nodejs: "test/integration",
    },
  },

  solidity: {
    profiles: {
      default: {
        version: "0.8.36",
        settings: {
          // evmVersion is deliberately left at the compiler default.
          optimizer: { enabled: true, runs: 200 },
        },
      },
      production: {
        version: "0.8.36",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },

  test: {
    solidity: {
      profiles: {
        default: {
          fuzz: { runs: 512 },
          invariant: { runs: 128, depth: 24, failOnRevert: false },
        },
      },
    },
  },

  networks: {
    // Default in-process network used by `hardhat test`.
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      accounts: { mnemonic: DEMO_MNEMONIC, count: 20 },
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 31337,
      accounts: { mnemonic: DEMO_MNEMONIC, count: 20 },
    },
    // The node started by `npm run node`. Deploy and seed target this.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: { mnemonic: DEMO_MNEMONIC, count: 20 },
    },
  },
});
