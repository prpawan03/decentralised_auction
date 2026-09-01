# Roadmap

Four tracks, agreed 2026-09-02. Track 1 is done; tracks 2–4 are not started.
The architectural decision that governs all contract work: **split into
modules** — a core settlement contract plus per-format strategy modules —
rather than growing `AuctionHouse.sol` past its current 1006 lines toward the
24 KB deployed-bytecode limit.

---

## Track 1 — UX pack ✅ done

Frontend only, no contract change. `npx tsc --noEmit`, `npx vitest run`
(142 tests, 9 files), `npm run check:contrast` and `npm run build` all pass.

| Delivered | Where |
| --- | --- |
| Token artwork, names, descriptions and traits from `tokenURI` | `web/src/lib/nftMetadata.ts`, `web/src/hooks/useNftMetadata.ts`, `web/src/components/ui/NftMedia.tsx`, `web/src/features/auctions/TokenPanel.tsx` |
| Search across name, auction id, token id and any address | `web/src/lib/auctionSort.ts`, `AuctionsPage.tsx` |
| Five sort orders, all total so rows never swap under the cursor | `web/src/lib/auctionSort.ts` |
| Watchlist, local-only, with a `Watching` filter tab | `web/src/hooks/useWatchlist.ts`, `WatchButton.tsx` |
| Outbid / ending-soon / won / sold / reserve-missed alerts | `web/src/hooks/useAuctionAlerts.tsx`, `AlertsToggle.tsx` |
| Configurable IPFS gateway, plumbed to the container | `config/runtime.ts`, `compose.yaml`, `docker/web-entrypoint.d/10-runtime-config.sh` |
| CSP made deployment-configurable so remote artwork is not silently blocked | `docker/nginx/default.conf.template`, `docker/web-entrypoint.d/05-nginx-config.sh` |

Two decisions worth not re-litigating:

- **Alerts diff two chain snapshots, they never read a log.** An outbid alert
  driven by a `BidPlaced` log fires on a log a reorg can drop, telling a bidder
  they lost a lead they still hold. See the header comment in
  `useAuctionAlerts.tsx`.
- **`AuctionTable` takes metadata as a prop and calls no wagmi hook.**
  `web/src/test/utils.tsx` deliberately mounts no `WagmiProvider`, because the
  presentational layer must render with no wallet stack at all. A hook call
  inside the table breaks that invariant — it did, and was reverted.

Already present before this work, do not rebuild: gas estimate, total-cost
preview and insufficient-balance check in `BidDialog.tsx:107-118`.

### Known gap

`contracts/scripts/seed.ts` points its six catalogue items at Wikimedia
Commons URLs. The demo therefore needs internet access to show artwork, which
sits awkwardly with the README's "runs fully on your own machine". Offline it
degrades to placeholder tiles, which is a designed state, not a break.
Worth considering: generate on-chain SVG `data:` URIs in the seed instead.

---

## Track 2 — New auction formats

Dutch (declining price) and sealed-bid commit–reveal, alongside the existing
English ascending auction. This is the headline differentiator.

1. Extract settlement, escrow, the pull-payment ledger and the NFT-delivery
   fallback (`_finalise`, `_releaseNft`, `_credit`, `claimNft`) into a core
   contract. These are format-independent and already correct — do not rewrite
   them, move them.
2. Define the strategy interface: what a format must answer. At minimum
   `currentPrice(auctionId)`, `acceptBid(auctionId, bidder, amount)` and
   `winnerAt(endTime)`.
3. English becomes the first strategy, behaviour-identical. The existing test
   suite is the regression gate: `contracts/test/AuctionHouse.t.sol`,
   `Regression.t.sol` and `AuctionHouseInvariant.t.sol` must pass unchanged.
4. Dutch: price decays linearly from start to floor; the first bid wins
   outright. No anti-snipe (there is nothing to snipe).
5. Sealed-bid: commit hashes during bidding, reveal in a fixed window, settle
   on the highest revealed bid. Decide up front whether it is first-price or
   Vickrey second-price, and whether an unrevealed commit forfeits its deposit.

## Track 3 — Marketplace completeness

- **EIP-2981 royalties.** Currently a creator gets nothing on resale. Query
  `royaltyInfo` at settlement and split proceeds three ways. Must fail safe: a
  collection that reverts or returns nonsense must not block settlement.
- **ERC-20 / stablecoin bidding.** Touches the whole payment path, including
  `_credit` and `withdraw`. Non-standard tokens (fee-on-transfer, no return
  value) are the trap; use SafeERC20 and measure balances, do not trust
  arguments.
- **ERC-1155 and bundle lots.** More than one item behind a single auction.
- **Per-auction minimum increment.** The struct field already exists at
  `contracts/src/AuctionHouse.sol:96` but `createAuction` hardcodes
  `DEFAULT_INCREMENT_BPS` at line 438. Sellers cannot set their own bid step.
  This is the cheapest item on this list.
- **Scheduled start times.** `startTime` is always `block.timestamp`, so you
  cannot list now and open bidding on Friday.
- **Proxy / automatic bidding.** Commit a maximum; the contract bids up by the
  minimum increment on your behalf. This is what makes eBay usable, and it
  belongs on chain rather than in the client, where it would need a hot key.

## Track 4 — Scale and infra

- **Indexer.** `getAuctions` caps at `MAX_PAGE_SIZE = 100` with no history and
  no server-side search. `web/src/lib/auctionSort.ts` and the filter logic in
  `AuctionsPage.tsx` are written to be the indexer's contract when it lands —
  the functions are pure for exactly this reason.
- **Multi-chain.** `web/src/config/chain.ts` builds a single chain from runtime
  config. Needs a chain switcher and a Sepolia or Base deployment.
- **Analytics.** Volume, clearing prices, bid distribution.
- **Timelock plus multisig owner.** `pause` and `setPlatformFee` currently
  execute instantly from a single EOA. `platformFeeBps` is already snapshotted
  per auction, so a live auction cannot be repriced — the remaining risk is the
  key itself.
