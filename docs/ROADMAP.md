# Roadmap

Four tracks, agreed 2026-09-02. Track 1 is done. Track 2 is done for English
and Dutch and merged to `dev`; sealed-bid is the only piece still open. Tracks
3 and 4 are not started.

**Next session starts here:** sealed-bid needs two decisions before any code —
first-price or Vickrey second-price, and whether an unrevealed commit forfeits
its deposit. Everything else on Track 2 is closed.

The architectural decision that governs all contract work: **split into
modules** — a core settlement contract plus per-format modules. The original
reason given was the 24 KB bytecode limit; measurement showed that was never
the binding constraint (see Track 2), and the split earns its place on
correctness instead.

---

## Track 1 — UX pack ✅ done

Frontend only, no contract change. `npx tsc --noEmit`, `npx vitest run`
(142 tests, 9 files), `npm run check:contrast` and `npm run build` all pass.

| Delivered                                                                  | Where                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token artwork, names, descriptions and traits from `tokenURI`              | `web/src/lib/nftMetadata.ts`, `web/src/hooks/useNftMetadata.ts`, `web/src/components/ui/NftMedia.tsx`, `web/src/features/auctions/TokenPanel.tsx` |
| Search across name, auction id, token id and any address                   | `web/src/lib/auctionSort.ts`, `AuctionsPage.tsx`                                                                                                  |
| Five sort orders, all total so rows never swap under the cursor            | `web/src/lib/auctionSort.ts`                                                                                                                      |
| Watchlist, local-only, with a `Watching` filter tab                        | `web/src/hooks/useWatchlist.ts`, `WatchButton.tsx`                                                                                                |
| Outbid / ending-soon / won / sold / reserve-missed alerts                  | `web/src/hooks/useAuctionAlerts.tsx`, `AlertsToggle.tsx`                                                                                          |
| Configurable IPFS gateway, plumbed to the container                        | `config/runtime.ts`, `compose.yaml`, `docker/web-entrypoint.d/10-runtime-config.sh`                                                               |
| CSP made deployment-configurable so remote artwork is not silently blocked | `docker/nginx/default.conf.template`, `docker/web-entrypoint.d/05-nginx-config.sh`                                                                |

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

**English and Dutch done. Sealed-bid not started.**

The contract is now three parts:

| File                                       | Owns                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/src/core/AuctionCore.sol`       | Everything that does not vary by format: the auction record, per-auction escrow, the pull-payment ledger, settlement ordering, token handover and recovery, fees, pausing, the read surface. |
| `contracts/src/formats/EnglishAuction.sol` | Ascending price: `createAuction`, `bid`, `buyNow`, `minimumBid`, anti-snipe.                                                                                                                 |
| `contracts/src/formats/DutchAuction.sol`   | Descending price: `createDutchAuction`, `buy`, `currentPrice`.                                                                                                                               |
| `contracts/src/AuctionHouse.sol`           | Composition, plus the `settle` dispatch on `Auction.format`.                                                                                                                                 |

126 tests passing (102 solidity, 24 nodejs). Slither unchanged against `dev`:
High 0, Medium 0, Low 4, Informational 6, identical detector set. Deployed size
11,897 bytes, 48.4% of the 24 KB limit.

Decisions worth not re-litigating:

- **Inheritance, not separately deployed strategy modules.** A format has to
  move escrow and credit accounts. Giving that power to another contract would
  create a boundary where a buggy module could spend a different auction's
  money, and rule 7 would stop being enforceable by the code that states it. It
  also keeps one auction id space, which the frontend depends on.
- **Size was never the real constraint.** 10,428 bytes before the split, 11,897
  with a whole second format. The split is for correctness.
- **Dutch reuses two struct fields under different names**: `reservePrice` is
  the floor, `buyNowPrice` is the opening price. Both readings are faithful, it
  keeps one struct for every format, and the record still packs into five slots.
- **`settle` dispatches on the stored format explicitly**, not through `super`
  and C3 linearisation, so reordering the parent list cannot change who gets
  paid.

### Still open on this track

- **Sealed-bid commit–reveal.** Decide first-price vs Vickrey second-price, and
  whether an unrevealed commit forfeits its deposit.
- ~~The invariant handler only drives English.~~ **Done.** `AuctionHandler` now
  has `handleCreateDutchAuction` and `handleBuyDutch`, the latter overpaying on
  about half its calls so the excess-to-`pendingReturns` path is exercised
  rather than merely reachable. `test_HandlerReachesEveryState` asserts both
  counters, so a handler that silently stopped firing fails loudly instead of
  leaving the invariants vacuously green. `handleBid` and `handleBuyNow` gained
  format guards, without which a Dutch listing in the book made them revert.
- ~~No frontend for Dutch yet.~~ **Done** — see below.

### Dutch frontend ✅ done

| Delivered                                                                 | Where                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `dutchPriceAt`, a bigint mirror of `_currentPrice` including its flooring | `web/src/lib/auction.ts`                                          |
| Live falling price and the format badge                                   | `web/src/features/auctions/DutchPrice.tsx`                        |
| Buy at the current price, with clock-skew handling                        | `web/src/features/bidding/BuyDutchButton.tsx`                     |
| Format-aware grid, detail stats, anti-snipe suppression                   | `AuctionTable.tsx`, `AuctionDetailPage.tsx`, `AntiSnipeBadge.tsx` |
| Format chooser and Dutch price fields when listing                        | `listingSchema.ts`, `CreateListingPage.tsx`                       |

156 web tests pass, plus the contrast gate and the production build.

Decisions worth not re-litigating:

- **`buyNowEnabled` and `reserveMet` branch on format rather than reading the
  fields blind.** On a Dutch listing `buyNowPrice` is the OPENING price, so
  rendering it as a buy-now advertised a number far above what the item could
  actually be bought for. Callers must check `isDutch` first.
- **The buy sends the price as of 15 seconds ago, not the quote.** The browser
  clock and the block timestamp are different clocks; if the chain lags, the
  exact quote reverts with `BidTooLow`. The margin is small because `buy`
  credits the excess to `pendingReturns` rather than refunding it in the
  transaction, so overpaying costs the buyer a second transaction. The
  simulation is the real gate.
- **The falling price carries no `aria-live`.** It changes every second, and
  announcing it would make the page unusable with a screen reader (SC 2.2.2).

### Contract wart found while wiring the frontend — fixed

`EnglishAuction.minimumBid` had no `_requireFormat` guard, so on a Dutch
auction it returned the ascending increment formula applied to a descending
sale price. It now reverts with `WrongFormat`, like `bid`, `buyNow` and
`currentPrice`. The frontend already tolerated the failure (`allowFailure` on
the detail read) and hides the stat for Dutch regardless.

### Demo data

`seed.ts` lists two Dutch auctions — one mid-slope, one near its floor — so the
format is visible on a first run. Their artwork is an inline `data:` URI, which
needs no gateway and gives the frontend an inline-metadata token to parse
beside the remote ones. Verified against a real node: deploy and seed both run
and the Dutch rows show a falling price.

Its summary table had the same misreading the frontend did, printing
`buyNowPrice` under "Buy now" and advertising an 8 ETH buy-now for an item
already asking less. It now prints the live price and the `start -> floor`
range. `STATUS_NAMES` was also missing `DeliveryFailed`, so status 4 printed as
`undefined`.

## Track 3 — Marketplace completeness

- **EIP-2981 royalties.** Currently a creator gets nothing on resale. Query
  `royaltyInfo` at settlement and split proceeds three ways. Must fail safe: a
  collection that reverts or returns nonsense must not block settlement.
- **ERC-20 / stablecoin bidding.** Touches the whole payment path, including
  `_credit` and `withdraw`. Non-standard tokens (fee-on-transfer, no return
  value) are the trap; use SafeERC20 and measure balances, do not trust
  arguments.
- **ERC-1155 and bundle lots.** More than one item behind a single auction.
- ~~Per-auction minimum increment.~~ **Done.** `createAuctionWithIncrement`
  exposes the step; `createAuction` keeps its exact signature and delegates
  with `DEFAULT_INCREMENT_BPS`, so the deployed ABI, the seed script and the
  whole test suite are untouched. Capped at `MAX_INCREMENT_BPS` (50%) so a
  mistyped step reverts at listing time instead of producing an auction that
  silently accepts one bid. 0 is legal and falls back to the flat
  `MIN_INCREMENT` floor. The listing form asks for a percentage and only routes
  to the new entry point when the seller actually changes it.
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
