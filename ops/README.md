# ops/ — monitoring stack

Zero-click observability for the local auction dapp. Everything here is
provisioned from files; nothing is clicked into existence.

```
make up                                                   # or your usual start
docker compose -f compose.yaml -f compose.monitoring.yaml --profile monitoring up -d
```

Then open <http://127.0.0.1:3000>. Grafana lands directly on the auction
overview — anonymous access is on and the login form is disabled, so there is
no password to type. Prometheus is at <http://127.0.0.1:9090>.

Both are bound to `127.0.0.1` only. Nothing in this stack is reachable from
another machine on the network, which matters because the chain's accounts are
funded and its private keys are public.

## Layout

| Path                                                | What it is                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `prometheus/prometheus.yml`                         | Scrape config. 5s interval so a bid moves a chart within one scrape. |
| `grafana/provisioning/datasources/datasources.yaml` | Prometheus (default) + the indexer's Postgres.                       |
| `grafana/provisioning/dashboards/dashboards.yaml`   | File provider watching `/var/lib/grafana/dashboards`.                |
| `grafana/dashboards/auction-overview.json`          | The dashboard itself.                                                |
| `../docker/exporter/`                               | The custom chain exporter that feeds Prometheus.                     |

## Two things that will bite you

**Provisioned dashboards need an explicit `uid`, and their `id` is stripped.**
Grafana removes the `id` field from any dashboard loaded off disk — `id` is a
database primary key and a file cannot claim one. The `uid` is what survives,
and it is what the dashboard's permalink and any cross-dashboard link resolve
against. `auction-overview.json` therefore sets `"uid": "auction-overview"` and
`"id": null`. If you export a dashboard from the Grafana UI to replace this
file, delete the `id` it writes and keep the `uid` stable, or every existing
link to the dashboard breaks.

**Datasource UIDs are referenced by the dashboard.** Panels point at
`"uid": "auction-prometheus"`, which is pinned in `datasources.yaml`. Let
Grafana generate a random uid instead and every panel renders "Datasource not
found".

## Expected-to-be-red targets

The `indexer` scrape job and the `Indexer Postgres` datasource both point at
services that only exist when the indexer profile is running. With that profile
off, the target shows down on Prometheus's `/targets` page and the Postgres
datasource fails "Save & test". This is by design — the monitoring stack must
come up without the indexer, and nothing on the default dashboard queries
Postgres. Start the indexer profile and the target goes green on its own within
one scrape interval; no reload needed.

## Why a custom exporter

Three off-the-shelf options were evaluated and rejected:

- **`json_exporter`** cannot read this chain at all. JSON-RPC returns
  quantities as hex strings (`{"result":"0x1f4"}`) and the exporter's
  `SanitizeValue` path ends in `strconv.ParseFloat`, which rejects them. There
  is no hex mode and no pre-processing hook.
- **`blackbox_exporter`** yields `probe_success` and nothing numeric — one of
  the eleven metrics below.
- **`ethereum-metrics-exporter`** is stale (v0.29.2, 2024), defaults to port
  9090 where it collides with Prometheus, and depends on `net_peerCount`,
  `admin_*` and `txpool_*`, none of which Hardhat implements.

None of them can read contract state, which is where the interesting numbers
are. `docker/exporter/` is ~200 lines with two dependencies.

## Metrics

| Metric                                  | Type      | Meaning                                                                   |
| --------------------------------------- | --------- | ------------------------------------------------------------------------- |
| `auction_chain_block_height`            | gauge     | Latest block number.                                                      |
| `auction_chain_block_timestamp_seconds` | gauge     | Latest block's timestamp.                                                 |
| `auction_chain_rpc_up`                  | gauge     | 1 when the last poll reached the node.                                    |
| `auction_chain_rpc_latency_seconds`     | histogram | `eth_blockNumber` round trip.                                             |
| `auction_gas_price_wei`                 | gauge     | Current gas price.                                                        |
| `auction_contracts_deployed`            | gauge     | 1 when the AuctionHouse answers.                                          |
| `auction_total_auctions`                | gauge     | `totalAuctions()`.                                                        |
| `auction_live_auctions`                 | gauge     | Auctions still accepting bids.                                            |
| `auction_escrow_total_wei`              | gauge     | **Money at risk**: ETH held across live auctions.                         |
| `auction_settled_total`                 | gauge     | Auctions that settled.                                                    |
| `auction_reserve_not_met_total`         | gauge     | Auctions that closed under reserve.                                       |
| `auction_cancelled_total`               | gauge     | Auctions cancelled by their seller.                                       |
| `auction_delivery_failed_total`         | gauge     | Sold but the NFT could not be delivered. Non-zero warrants investigation. |

The `_total` gauges are deliberately **not** counters: they are read back from
contract state each poll and reset to zero when the chain does, so `rate()` and
`increase()` would invent a spike on every fresh deployment. See the header
comment in `docker/exporter/src/metrics.mjs`.
