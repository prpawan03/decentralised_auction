# Smart Auction Network

A decentralized NFT auction house on Ethereum. Sellers escrow a token, bidders
compete against a deadline, and the contract settles the trade without a
middleman.

The project runs fully on your own machine. It needs no API keys, no test
network, and no accounts with an external service.

<!-- Add a screenshot here after you run the demo. Recommended: the auction grid
     in dark mode with the countdown visible. -->

---

## Why this repository exists

The first version of this project had a working user interface and a contract
that looked correct. A security review found that it was neither safe nor
functional:

- The contract paid the seller but transferred **nothing** to the winner.
- A bidder could re-enter the contract during a refund and take money that
  belonged to a different auction.
- A losing bidder had **no way to withdraw**. If nobody outbid them, their
  money stayed in the contract forever.
- One attacker could freeze every auction at the minimum price for the cost of
  a single bid.
- The user interface reported "Auction ended successfully" when the transaction
  had failed.
- No auction could be created at all, because the form sent five arguments to a
  function that accepts four.

This repository is the rebuild. Each fix has a test named after the problem it
closes. See [Security](#security).

---

## Quick start

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and
the [MetaMask](https://metamask.io/) browser extension.

```bash
git clone https://github.com/prpawan03/decentralised_auction.git
cd decentralised_auction
cp .env.example .env
make up
```

On Windows PowerShell, use `npm run up` instead of `make up`.

The command starts three services:

| Service | Port | Purpose |
| --- | --- | --- |
| `chain` | 8545 | Local Ethereum node |
| `deployer` | — | Deploys the contracts, then creates demo auctions and exits |
| `web` | 5173 | The application |

Open <http://localhost:5173>. The app shows live auctions immediately. You can
browse everything **without a wallet**. You need a wallet only to bid, to list
an item, or to withdraw.

To stop the stack, run `make down`. To delete all data and start again, run
`make clean`.

---

## Connect MetaMask

The local chain creates 10 accounts. Each account holds 1000 test ETH. The
tokens have no value and exist only on your machine.

**Step 1 — Add the network.** In MetaMask, select **Add network → Add a network
manually**, then enter:

| Field | Value |
| --- | --- |
| Network name | `Auction Local` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

The app also has a **Switch network** button that does this for you.

**Step 2 — Import the demo accounts.** Select **Import account → Secret Recovery
Phrase** and enter the phrase from `.env.example`:

```
test test test test test test test test test test test junk
```

> **This phrase is public on purpose.** Every Ethereum development tool uses it.
> The accounts are worthless. **Never** send real funds to them, and never use
> this phrase on a public network.

**Step 3 — Use more than one account.** Import at least two accounts. A seller
cannot bid on their own auction, so you need a second account to see bidding
work.

---

## How an auction works

```
   Seller                     AuctionHouse                    Bidder
     |                             |                             |
     |-- createAuction() --------->|                             |
     |   (NFT moves into escrow)   |                             |
     |                             |<---------- bid() -----------|
     |                             |   previous bidder is
     |                             |   CREDITED, not paid
     |                             |
     |                             |<--- bid() near the end -----|
     |                             |   endTime extends +5 min
     |                             |
     |         ... deadline passes ...
     |                             |
     |            anyone may call settle()
     |                             |
     |<-- proceeds credited -------|------ NFT transferred ----->|
     |                             |
     |------ withdraw() ---------->|<-------- withdraw() --------|
```

Three properties make this safe:

1. **The contract never sends ETH by itself.** It records what it owes you. You
   call `withdraw()` to collect. A bidder that rejects payments can therefore
   harm only itself.
2. **Anyone can settle an expired auction.** A seller cannot hold a bidder's
   money by refusing to close.
3. **The NFT moves in the same transaction as the payment.** The winner cannot
   pay and receive nothing.

---

## Security

Every item below was a real defect in the previous version. Each fix has a test
named after it.

| Problem | Severity | Fix |
| --- | --- | --- |
| Re-entering during a refund drained other auctions' escrow | Critical | Pull payments, `nonReentrant`, state written before every external call, per-auction escrow accounting |
| Losing bids could never be withdrawn | Critical | `withdraw()` vault, plus a deadline that anyone may settle |
| A reverting bidder froze the auction at the floor price | Critical | The contract never pushes ETH, so a refund can no longer fail |
| The seller could buy out their own item | High | Explicit seller check on `bid` and `buyNow` |
| A buy-now price of zero let anyone take the item free | High | `0` means "disabled", and is rejected as a payment |
| `.transfer()` broke payouts to smart-contract sellers | High | Credit-and-pull removes the 2300 gas limit |
| No deadline existed | High | `endTime` is required, with anti-snipe extension |
| The winner received nothing | Critical | ERC-721 escrow, released atomically with settlement |

**This code is not audited.** It is a demonstration project for a local
network. Do **not** deploy it to a public network or use it with real funds.
See [SECURITY.md](SECURITY.md).

---

## Project layout

```
.
├── contracts/          Solidity contracts, tests, deploy and seed scripts
│   ├── src/            AuctionHouse.sol, DemoNFT.sol
│   ├── test/           Solidity fuzz + invariant tests, TypeScript integration tests
│   └── scripts/        deploy, seed, export-abi
├── web/                React application
│   ├── src/features/   auctions, bidding, listing, portfolio, wallet
│   └── src/abi/        Generated from the contracts. Do not edit by hand.
├── docker/             Dockerfiles and entrypoints
├── docs/               Interface specification and guides
└── compose.yaml        Service definitions
```

---

## Commands

| Command | Action |
| --- | --- |
| `make up` | Start the full stack |
| `make watch` | Start with hot reload |
| `make down` | Stop the stack |
| `make clean` | Stop and delete all data |
| `make test` | Run contract and application tests |
| `make seed` | Create the demo auctions again |
| `make logs` | Follow the logs |
| `make help` | List every command |

Each command has an `npm run` equivalent for Windows PowerShell.

---

## Testing

The contracts have three kinds of test:

- **Unit and integration tests** cover each function and the full auction flow.
- **Fuzz tests** call `bid()` with random values across the whole input range.
- **Invariant tests** prove that the contract balance always covers what it
  owes, whatever sequence of calls it receives.

```bash
cd contracts
npx hardhat test              # all tests
npx hardhat test --coverage   # coverage report
npx hardhat test --gas-stats  # gas per function
```

The application has component tests with Vitest, automated accessibility checks
with `vitest-axe`, and end-to-end tests with Playwright.

---

## Accessibility

The interface targets **WCAG 2.2 Level AA**. The previous version failed 12
success criteria, including text at a contrast ratio of 2.0:1 against a
requirement of 4.5:1.

`npm run check:contrast` computes the ratio of every colour pair in the theme
and fails the build if any pair is below the threshold. Conformance is measured,
not asserted.

---

## Technology

| Layer | Choice | Reason |
| --- | --- | --- |
| Contracts | Solidity 0.8.36, OpenZeppelin 5.6 | Custom errors, current security fixes |
| Framework | Hardhat 3 | Truffle was archived in 2023. Hardhat runs native fuzz and invariant tests. |
| Chain client | viem + wagmi | web3.js was retired in 2025 |
| Application | React 19, Vite 8, TypeScript | Create React App was deprecated in 2025 |
| Styling | Tailwind CSS 4 | CSS-first theme tokens |

The contract is **immutable by design**. It has no proxy and no upgrade path,
so its behaviour cannot be changed after deployment.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

Built by Pawan, Yogeesh, Vishwas and Santosh.
