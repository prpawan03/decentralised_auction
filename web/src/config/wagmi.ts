import { createConfig, http, fallback } from "wagmi";
import { injected } from "wagmi/connectors";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { localChain } from "./chain";
import { config as runtimeConfig } from "./runtime";

/**
 * READ-ONLY MODE IS THE DEFAULT, AND IT IS THE WHOLE POINT.
 *
 * The transport below is a plain HTTP transport to the node. It is configured
 * unconditionally, before and independently of any wallet. Every read in this
 * app (`useReadContract*`, `useWatchContractEvent`) resolves through it, so
 * with no wallet extension installed at all the app still lists auctions,
 * counts down, streams the activity feed and renders any address's portfolio.
 *
 * A wallet is required for exactly three things: bid/buyNow, createAuction,
 * and withdraw. Those, and only those, are gated behind a connect prompt.
 */

const transports = {
  [localChain.id]: fallback(
    [
      http(runtimeConfig.rpcUrl, {
        /* One local node. Retrying hard on a dev chain just spams the console. */
        retryCount: 2,
        retryDelay: 300,
        timeout: 10_000,
        /* Fold simultaneous reads into one HTTP round trip. */
        batch: { wait: 16 },
      }),
    ],
    { rank: false },
  ),
};

/**
 * WalletConnect needs a project id. A local demo has no reason to have one, so
 * when it is absent we register only the wallets that work without it. Passing
 * a placeholder id instead makes RainbowKit render a QR modal that can never
 * connect, which is worse than not offering the option.
 */
const projectId = runtimeConfig.walletConnectProjectId;

const connectors = projectId
  ? connectorsForWallets(
      [
        {
          groupName: "Recommended",
          wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, injectedWallet],
        },
      ],
      { appName: "AuctionHouse", projectId },
    )
  : /* No project id: injected-only. MetaMask and every other in-page wallet
       still work; WalletConnect is simply not advertised. */
    [injected({ shimDisconnect: true })];

export const wagmiConfig = createConfig({
  chains: [localChain],
  connectors,
  transports,
  /* Never auto-open a wallet prompt on load. A visitor browses first. */
  ssr: false,
  /* wagmi persists the last connector; without a wallet this is simply a no-op. */
  syncConnectedChain: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
