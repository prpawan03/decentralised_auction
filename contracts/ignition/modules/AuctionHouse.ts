import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * The Ignition path to the same deployment `scripts/deploy.ts` performs.
 *
 * Use this when you want Ignition's journal, resumability and verification:
 *
 *   npx hardhat ignition deploy ignition/modules/AuctionHouse.ts --network localhost
 *
 * `scripts/deploy.ts` is the path the demo uses, because it also writes
 * `deployments/<chainId>.json` for the web app to read.
 */
export default buildModule("AuctionHouseModule", (m) => {
  // Defaults to the account Ignition is deploying from.
  const owner = m.getParameter("owner", m.getAccount(0));
  const feeRecipient = m.getParameter("feeRecipient", m.getAccount(0));
  const platformFeeBps = m.getParameter("platformFeeBps", 250);

  const demoNft = m.contract("DemoNFT");
  const auctionHouse = m.contract("AuctionHouse", [owner, feeRecipient, platformFeeBps]);

  return { auctionHouse, demoNft };
});
