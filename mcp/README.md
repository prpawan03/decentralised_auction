# Auction House MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent browse and bid on the
local NFT auction house. It speaks the **stdio** transport, connects to the Hardhat dev chain
over JSON-RPC, and exposes eleven named domain tools — six read, five write.

It is deliberately incapable of touching a real network. See [SAFETY](#safety) — read that
section before you run anything.

---

## Quick start

```bash
cd mcp
npm install          # also compiles to dist/ via the prepare hook
npm run build        # if you need to rebuild
```

Then, with the local chain and contracts running (`make dev` from the repo root):

```bash
node dist/index.js
```

The server refuses to start unless it can reach a chain reporting id **31337**, so a successful
boot is itself a check that your environment is what you think it is. On success it prints a
banner to **stderr** (stdout is the protocol channel and carries nothing else):

```
auction-house v1.0.0 ready
  chain:      31337 (verified) via http://127.0.0.1:8545
  layout:     Auction struct has 14 fields (includes Format)
  house:      0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  account:    0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  spend cap:  100 ETH per transaction
  indexer:    http://127.0.0.1:5173 (optional)
```

---

## MCP client configuration

Paste this into your MCP config, replacing the path with your absolute path to this repo.

**Claude Code** — `.mcp.json` in the project root, or `claude mcp add`:

```json
{
  "mcpServers": {
    "auction-house": {
      "command": "node",
      "args": ["C:/Users/you/path/to/decentralised_auction/mcp/dist/index.js"],
      "env": {
        "AUCTION_MCP_RPC_URL": "http://127.0.0.1:8545",
        "AUCTION_MCP_MAX_BID_WEI": "100000000000000000000"
      }
    }
  }
}
```

**Claude Desktop** — `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "auction-house": {
      "command": "node",
      "args": ["/absolute/path/to/decentralised_auction/mcp/dist/index.js"],
      "env": {
        "AUCTION_MCP_RPC_URL": "http://127.0.0.1:8545",
        "AUCTION_MCP_MAX_BID_WEI": "100000000000000000000"
      }
    }
  }
}
```

Use an **absolute** path: the client launches the server from an arbitrary working directory.
No `env` block is required at all — every variable has a working default.

---

## Configuration

| Variable                  | Default                               | Purpose                                                 |
| ------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `AUCTION_MCP_RPC_URL`     | `http://127.0.0.1:8545`               | JSON-RPC endpoint. Falls back to `RPC_URL`.             |
| `AUCTION_MCP_MAX_BID_WEI` | `100000000000000000000` (100 ETH)     | Hard per-transaction spend cap, in wei.                 |
| `AUCTION_MCP_PRIVATE_KEY` | Hardhat account **#1**                | Signing key. Account #0 is rejected — see SAFETY.       |
| `AUCTION_HOUSE_ADDRESS`   | from deployment record                | Auction house address. Takes priority over the file.    |
| `DEMO_NFT_ADDRESS`        | from deployment record                | Demo NFT collection, used by `get_nft_metadata`.        |
| `AUCTION_MCP_DEPLOYMENT`  | `../contracts/deployments/31337.json` | Path to the deployment record.                          |
| `AUCTION_MCP_FROM_BLOCK`  | `0`                                   | Lower bound for log scans when addresses come from env. |
| `AUCTION_MCP_INDEXER_URL` | `http://127.0.0.1:5173`               | Optional Ponder indexer. Never required.                |

Addresses resolve **env first, file second**, so the server can run against a chain that some
other process deployed without sharing a filesystem.

---

## Tools

### Read

| Tool                | What it does                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_auctions`     | Paginated browse, filtered by status (`Live`, `Settled`, `Cancelled`, `ReserveNotMet`, `DeliveryFailed`, `settleable`, `any`) and format (`English`, `Dutch`, `any`). |
| `get_auction`       | Full detail for one auction: authoritative minimum bid or live Dutch price, escrow, deadline, and whether _you_ may act on it.                                        |
| `get_bid_history`   | Bid history, newest first. Indexer when available, `eth_getLogs` fallback otherwise. States which source it used.                                                     |
| `get_nft_metadata`  | Collection name/symbol, owner, and the decoded `tokenURI`.                                                                                                            |
| `get_wallet_status` | Wallet balance, pending (withdrawable) balance, and the spend cap.                                                                                                    |
| `get_leaderboard`   | Top bidders or sellers by volume. **Requires the indexer** — see below.                                                                                               |

### Write

| Tool             | What it does                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulate_bid`   | **Dry run. Call this first.** Runs the bid via `eth_call`; nothing is signed and no gas is burned. A failure returns the exact reason with the numbers filled in. |
| `place_bid`      | Signs and sends a real bid.                                                                                                                                       |
| `buy_now`        | Instant purchase. Format-aware: English pays the fixed buy-now price exactly, Dutch pays the current descending price. Optional `maxPrice` budget.                |
| `settle_auction` | Closes an auction past its end time. Anyone may settle.                                                                                                           |
| `withdraw`       | Pulls the account's pending balance out of the house.                                                                                                             |

Every auction record carries derived fields the model would otherwise have to compute:
`canYouBid`, `canYouBuyNow`, `youAreTheSeller`, `youAreTheHighestBidder`, `whyYouCannotBid`,
`howToBuy`, `settleable`, and `timeRemaining` in human units. Wei values are always returned as
both `wei` (decimal string) and `eth`, because a `uint96` overflows a JSON number's exact-integer
range at about 0.009 ETH.

### The two formats need different tools

The deployed contract carries a `Format` enum, and the formats are **not interchangeable**:

- **English** — ascending. Use `simulate_bid` → `place_bid`. `buy_now` works only if the seller
  set a buy-now price and bidding has not yet reached it. Bids inside the last 5 minutes extend
  the deadline (up to 20 times).
- **Dutch** — descending. Takes **no bids at all**; `bid()` reverts with `WrongFormat`. Use
  `buy_now`, which pays `currentPrice` — a figure that falls every second toward the reserve.
  Overpayment is accepted, so a slightly stale quote still succeeds.

The server enforces this client-side: `simulate_bid` and `place_bid` refuse a Dutch auction up
front with a message pointing at `buy_now`, rather than letting the agent burn a call on a revert.

---

## Errors are actionable, not opaque

Every custom contract error is decoded from the ABI into a sentence with the numbers filled in
and a next step. An agent that receives `execution reverted` has learned nothing and can only
retry the same call. Compare:

```
Bid too low: this auction needs at least 2.52 ETH, but you offered 0.00001 ETH
(2.51999 ETH short). Call simulate_bid or get_auction to read the current minimum
before retrying -- it rises with every accepted bid.
```

```
You already hold the leading bid on this auction. The contract rejects bidding
against yourself so you cannot lock up extra ETH for no gain. Do nothing and wait
for the auction to close, then call settle_auction once it is settleable.
```

`AlreadyHighestBidder` is the clearest case for why the wording matters: it reads like a failure
but actually means _you are winning_.

---

## The indexer is optional

`get_bid_history` prefers the Ponder indexer (it supplies block timestamps directly) and falls
back to scanning chain logs, reporting which source it used.

`get_leaderboard` is the one tool that genuinely requires it. Lifetime totals — total spent,
auctions won, bids placed — are maintained as rollup counters inside the indexing handlers and
are stored neither on chain nor computable from a single read. When the indexer is down the tool
returns an explicit error rather than an empty list, because an empty leaderboard is
indistinguishable from "nobody has bid" and a model shown that will confidently report there are
no bidders.

Start it with `make indexer` from the repo root.

---

## SAFETY

**This server signs blockchain transactions autonomously on behalf of an AI agent.** Treat that
as the security problem it is. The protections below are enforced **in code**, at startup and in
the tool handlers — not in prompt text, and not in tool annotations.

The MCP specification is explicit that tool annotations (`readOnlyHint`, `destructiveHint`,
`idempotentHint`) are **untrusted hints**. A client may use them to decide when to ask a human,
but they carry no authority — any server can declare anything. They are set on every tool here
for the client's benefit, and **none of the safety below depends on them.**

### 1. It cannot run on a real network

The process reads `eth_chainId` at startup and **exits non-zero unless the answer is exactly
31337** — the Hardhat/Anvil dev chain id, which no public network uses. One equality check makes
the whole server categorically unable to touch mainnet, an L2, or a value-bearing testnet,
regardless of what RPC URL is in the environment or what an agent is talked into requesting.

This is a constant, not a setting. There is deliberately no environment variable to change it,
because such a variable would reintroduce exactly the risk it removes.

```
REFUSING TO START: connected chain id is 1, not 31337.

This MCP server signs transactions autonomously on behalf of an AI agent and is
hard-limited to the local development chain (31337). It will not run against any
other network, including testnets. This limit is not configurable.
```

### 2. A hard spend cap

`AUCTION_MCP_MAX_BID_WEI` (default 100 ETH) is checked **in the handler, before signing**, on
every value-bearing call — including `simulate_bid`, so a simulation can never green-light an
amount the server would then refuse to send. No tool call can raise it; only restarting the
server with a different value can. On a dev chain where accounts hold 10 000 ETH the number is
arbitrary, and that is the point: the cap bounds the blast radius of a runaway loop or an
injected instruction so a bad decision costs one bounded bid rather than the whole balance.

### 3. No generic execution — ever

There is **no tool that accepts calldata, an arbitrary contract address, a raw transaction, or a
message to sign.** `eth_sendTransaction`, `eth_sign` and `personal_sign` are not reachable
through any code path. The only functions the process can encode are the ones written into
`src/abi.ts`, which is an explicit allowlist: `bid`, `buyNow`, `buy`, `settle`, `cancelAuction`,
`withdraw`, plus views. The ERC-721 fragment carries `tokenURI`/`ownerOf`/`name`/`symbol` and
deliberately no `approve`, `setApprovalForAll` or `transferFrom`.

### 4. The agent never holds the owner key

The signer defaults to **Hardhat account #1**, never account #0. Account #0 is the deployer and
therefore the `Ownable2Step` owner of the auction house, able to `pause()`, `unpause()`,
`setPlatformFee()` and `setFeeRecipient()`. A prompt-injected agent holding that key could halt
the entire house or redirect the platform fee.

Setting `AUCTION_MCP_PRIVATE_KEY` to account #0 is **rejected at startup**, so the protection
cannot be undone by one environment variable. Owner-only functions are also absent from the ABI
allowlist, so there is no route to them even by accident — two independent barriers.

### 5. It will not bid against itself

`simulate_bid` and `place_bid` check whether the connected account already leads the auction and
refuse before spending gas. The contract enforces this too (`AlreadyHighestBidder`), but the
early refusal explains that you are _winning_ rather than failing.

### What this does NOT protect against

Be clear-eyed about the boundary:

- **Anything on chain 31337 is fair game.** Within the cap, an agent can spend the account's ETH
  on any auction it likes. The chain is disposable; the money is not real. Do not put real value
  on chain 31337.
- **Prompt injection can still steer _which_ auctions get bid on.** NFT metadata and token URIs
  are attacker-controlled text. The server never fetches `ipfs:`/`http:` URIs for this reason,
  but inline metadata is still returned to the model. The safety model bounds _what_ can happen
  and _where_, not _which_ choice the model makes within those bounds.
- **The cap is per transaction, not cumulative.** Nothing stops an agent from placing many bids
  each under the cap. If that matters to you, lower the cap.

---

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
npm run dev          # run from source, no build step
```

The package is **standalone** — not a workspace member. It has its own lockfile and its own
`tsconfig.json`, and does not import from `contracts/artifacts` or any sibling directory, so
`npm install && npx tsc --noEmit` inside `mcp/` works on a fresh clone with nothing else built.

### A note on the contract ABI

`src/abi.ts` is hand-written rather than generated, which keeps the package installable without
a Solidity compile and makes the write surface an explicit allowlist.

It also handles a live discrepancy: the deployed bytecode and the Solidity source in this
repository currently disagree about the `Auction` struct. The source declares 13 fields; the
deployed contract returns 14, the extra one being a `Format` enum. Rather than hardcode either,
`src/auctions.ts` **detects the layout at startup** by counting the words `getAuction` returns
(every field is a static type, so the word count _is_ the field count) and decodes accordingly.
An unrecognised width is a loud startup error, never a silent misdecode — putting a wei value
into a basis-points field would produce plausible-looking nonsense, which is worse than a crash.
The boot banner prints which layout was detected.
