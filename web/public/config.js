/**
 * Runtime configuration placeholder.
 *
 * DEV: this file is served as-is and deliberately does nothing, so
 * src/config/runtime.ts falls through to import.meta.env.VITE_* and then to
 * the local defaults (chainId 31337, http://127.0.0.1:8545).
 *
 * PROD: the nginx container entrypoint overwrites this file at start-up from
 * the environment, e.g.
 *
 *   window.__AUCTION_CONFIG__ = {
 *     chainId: 31337,
 *     chainName: "Auction Local",
 *     rpcUrl: "http://127.0.0.1:8545",
 *     auctionHouseAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
 *     demoNftAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
 *   };
 *
 * That is why the contract address is never read from the JS bundle: one image
 * runs against any chain.
 */
window.__AUCTION_CONFIG__ = window.__AUCTION_CONFIG__ || {};
