/**
 * The OPTIONAL Ponder indexer client.
 *
 * The indexer is a genuine optional dependency: `make dev` does not start it,
 * only `make indexer` does. Every function here therefore returns `null` rather
 * than throwing when it is unreachable, and every caller has an RPC fallback.
 * Nothing in this server may ever hard-require it.
 *
 * WHY use it at all when the chain has the same data: Ponder maintains rollup
 * counters (total spent, auctions won, bids placed) that the CONTRACT DOES NOT
 * STORE and that Ponder's GraphQL cannot compute on the fly -- its schema notes
 * that its GraphQL has no aggregations, so those numbers are incremented inside
 * the indexing handlers and live only in those tables. Deriving a leaderboard
 * from raw RPC means fetching and folding every historical log on every call,
 * which is fine for a demo chain with 20 auctions and quadratic nonsense beyond
 * that. So: use the indexer when it is up, and be honest in the response when
 * falling back.
 */

/** A short timeout: this is a localhost service, and an agent is waiting. */
const TIMEOUT_MS = 2_500;

export interface IndexerResult<T> {
  ok: boolean;
  data?: T;
  /** Why the indexer was not used. Surfaced to the agent so it knows the data's provenance. */
  reason?: string;
}

/**
 * Issues a GraphQL query against the indexer.
 *
 * `AbortSignal.timeout` rather than a manual race: it actually cancels the
 * socket, so an unreachable indexer does not leak a pending request per call.
 */
async function graphql<T>(
  baseUrl: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<IndexerResult<T>> {
  const url = `${baseUrl.replace(/\/+$/, "")}/graphql`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    // Connection refused, DNS failure, or the timeout firing. All mean the same
    // thing to the caller: fall back to RPC.
    return {
      ok: false,
      reason: `Indexer at ${url} is not reachable (${
        cause instanceof Error ? cause.message : String(cause)
      }). Falling back to direct RPC.`,
    };
  }

  if (!response.ok) {
    return { ok: false, reason: `Indexer returned HTTP ${response.status}. Falling back to direct RPC.` };
  }

  let body: { data?: T; errors?: Array<{ message: string }> };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, reason: "Indexer returned a non-JSON response. Falling back to direct RPC." };
  }

  // A GraphQL 200 with an `errors` array is still a failure. Most commonly it
  // means a schema drift between this query and the indexer's tables, which
  // must not surface as an empty leaderboard that looks like real data.
  if (body.errors?.length) {
    return {
      ok: false,
      reason: `Indexer query failed: ${body.errors.map((e) => e.message).join("; ")}. Falling back to direct RPC.`,
    };
  }

  if (body.data === undefined) {
    return { ok: false, reason: "Indexer returned no data. Falling back to direct RPC." };
  }

  return { ok: true, data: body.data };
}

/** Cheap liveness probe used by tools that want to report provenance. */
export async function indexerIsUp(baseUrl: string): Promise<boolean> {
  const result = await graphql<{ __typename: string }>(baseUrl, "{ __typename }");
  return result.ok;
}

export interface BidderRow {
  id: string;
  bidsPlaced: number;
  auctionsEntered: number;
  auctionsWon: number;
  totalSpent: string;
  totalBidVolume: string;
  highestBid: string;
  lateBids: number;
}

export interface SellerRow {
  id: string;
  listed: number;
  sold: number;
  grossVolume: string;
  netVolume: string;
  feesPaid: string;
  sellThroughRate: number;
}

/**
 * Top bidders by lifetime spend.
 *
 * The field list mirrors the `bidder` rollup table in indexer/ponder.schema.ts.
 * Ponder exposes a plural query returning `{ items }` with `orderBy` /
 * `orderDirection` / `limit` arguments.
 */
export async function topBidders(
  baseUrl: string,
  limit: number,
): Promise<IndexerResult<BidderRow[]>> {
  const query = `
    query TopBidders($limit: Int!) {
      bidders(orderBy: "totalSpent", orderDirection: "desc", limit: $limit) {
        items {
          id
          bidsPlaced
          auctionsEntered
          auctionsWon
          totalSpent
          totalBidVolume
          highestBid
          lateBids
        }
      }
    }
  `;
  const result = await graphql<{ bidders: { items: BidderRow[] } }>(baseUrl, query, { limit });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, data: result.data?.bidders?.items ?? [] };
}

/** Top sellers by gross volume. Mirrors the `seller` rollup table. */
export async function topSellers(
  baseUrl: string,
  limit: number,
): Promise<IndexerResult<SellerRow[]>> {
  const query = `
    query TopSellers($limit: Int!) {
      sellers(orderBy: "grossVolume", orderDirection: "desc", limit: $limit) {
        items {
          id
          listed
          sold
          grossVolume
          netVolume
          feesPaid
          sellThroughRate
        }
      }
    }
  `;
  const result = await graphql<{ sellers: { items: SellerRow[] } }>(baseUrl, query, { limit });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, data: result.data?.sellers?.items ?? [] };
}

export interface IndexedBid {
  id: string;
  bidder: string;
  amount: string;
  timestamp: string;
  blockNumber: string;
  transactionHash: string;
}

/**
 * Bid history for one auction, newest first.
 *
 * Prefer this over `eth_getLogs` when available: it is already ordered and
 * paginated, and it carries the block timestamp, which a raw log does not --
 * getting that over RPC costs one `eth_getBlockByNumber` per distinct block.
 */
export async function bidHistory(
  baseUrl: string,
  auctionId: bigint,
  limit: number,
): Promise<IndexerResult<IndexedBid[]>> {
  const query = `
    query BidHistory($auctionId: BigInt!, $limit: Int!) {
      bids(
        where: { auctionId: $auctionId }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
      ) {
        items {
          id
          bidder
          amount
          timestamp
          blockNumber
          transactionHash
        }
      }
    }
  `;
  const result = await graphql<{ bids: { items: IndexedBid[] } }>(baseUrl, query, {
    auctionId: auctionId.toString(),
    limit,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, data: result.data?.bids?.items ?? [] };
}
