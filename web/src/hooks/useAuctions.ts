import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { auctionHouse, CONTRACT_LIMITS } from "@/config/contracts";
import { withIds, type Auction, type RawAuction } from "@/lib/auction";

/**
 * The auction list, read in ONE round trip.
 *
 * Two things are folded into a single `useReadContracts` call, which wagmi
 * routes through Multicall3 (one eth_call for the lot):
 *
 *   totalAuctions()          — so we know whether more pages exist
 *   getAuctions(offset,limit)— the whole page of structs
 *
 * The old app did `items(i)` in a loop: N sequential JSON-RPC round trips,
 * each one a separate React state write. Twenty auctions meant twenty renders
 * and a visibly striping list.
 *
 * `allowFailure: true` is deliberate. If the contract is not deployed at the
 * configured address, we get a per-call error instead of one opaque throw, and
 * the empty state can say which of the two it is.
 */

export const auctionsQueryKey = ["auctions", "page"] as const;

export interface AuctionsResult {
  auctions: Auction[];
  total: number;
  isLoading: boolean;
  /** True on the very first load only — a refetch must not blank the table. */
  isInitialLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** The contract responded but the list is genuinely empty. Distinct from an error. */
  isEmpty: boolean;
  refetch: () => void;
}

export function useAuctions(offset = 0n, limit = CONTRACT_LIMITS.MAX_PAGE_SIZE): AuctionsResult {
  const query = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...auctionHouse, functionName: "totalAuctions" },
      { ...auctionHouse, functionName: "getAuctions", args: [offset, limit] },
    ],
    query: {
      /* Events invalidate this key the moment anything changes on chain, so a
         long staleTime costs nothing and stops a refetch storm on every focus. */
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const [totalResult, pageResult] = query.data ?? [];

  const auctions = useMemo<Auction[]>(() => {
    if (pageResult?.status !== "success") return [];
    return withIds(pageResult.result as unknown as readonly RawAuction[], offset);
  }, [pageResult, offset]);

  const total = totalResult?.status === "success" ? Number(totalResult.result) : auctions.length;

  /* A per-call failure is still a failure worth surfacing. */
  const callError =
    (pageResult?.status === "failure" ? (pageResult.error as Error) : null) ??
    (totalResult?.status === "failure" ? (totalResult.error as Error) : null);

  const error = (query.error as Error | null) ?? callError;
  const isError = Boolean(error);

  return {
    auctions,
    total,
    isLoading: query.isLoading || query.isPending,
    isInitialLoading: query.isLoading && query.data === undefined,
    isError,
    error,
    isEmpty: !isError && !query.isLoading && auctions.length === 0,
    refetch: () => void query.refetch(),
  };
}

/**
 * A single auction, plus the two derived reads the detail page needs. Also one
 * multicall: struct + authoritative minimum bid + settleability.
 */
export interface AuctionDetailResult {
  auction: Auction | null;
  /** The contract's own minimumBid(). Always preferred over the local estimate. */
  minimumBid: bigint | null;
  isSettleable: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  /** The id is outside `totalAuctions`, i.e. this auction never existed. */
  notFound: boolean;
  refetch: () => void;
}

export function useAuctionDetail(auctionId: bigint | undefined): AuctionDetailResult {
  const enabled = auctionId !== undefined;

  const query = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          { ...auctionHouse, functionName: "getAuction", args: [auctionId] },
          { ...auctionHouse, functionName: "minimumBid", args: [auctionId] },
          { ...auctionHouse, functionName: "isSettleable", args: [auctionId] },
        ]
      : [],
    query: {
      enabled,
      staleTime: 10_000,
      refetchInterval: 20_000,
    },
  });

  const [structResult, minResult, settleableResult] = query.data ?? [];

  const auction = useMemo<Auction | null>(() => {
    if (structResult?.status !== "success" || auctionId === undefined) return null;
    return { ...(structResult.result as unknown as RawAuction), id: auctionId };
  }, [structResult, auctionId]);

  /* AuctionNotFound is a revert, so it lands in `failure`, not in a null. */
  const structError = structResult?.status === "failure" ? (structResult.error as Error) : null;
  const notFound = Boolean(structError && /AuctionNotFound/i.test(String(structError)));

  return {
    auction,
    minimumBid: minResult?.status === "success" ? (minResult.result as bigint) : null,
    isSettleable: settleableResult?.status === "success" ? Boolean(settleableResult.result) : false,
    isLoading: query.isLoading,
    isError: Boolean(query.error) || (Boolean(structError) && !notFound),
    error: (query.error as Error | null) ?? (notFound ? null : structError),
    notFound,
    refetch: () => void query.refetch(),
  };
}

/**
 * The pull-payment vault balance. In the old contract this money was pushed
 * and could be lost on a failing receive(); here it accumulates until the
 * owner withdraws, so the UI must never let it go unnoticed.
 */
export function usePendingReturns(account: Address | undefined) {
  const query = useReadContract({
    ...auctionHouse,
    functionName: "pendingReturns",
    args: account ? [account] : undefined,
    query: {
      enabled: Boolean(account),
      staleTime: 5_000,
      refetchInterval: 15_000,
    },
  });

  return {
    amount: (query.data as bigint | undefined) ?? 0n,
    hasBalance: ((query.data as bigint | undefined) ?? 0n) > 0n,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    queryKey: query.queryKey,
  };
}

/**
 * The contract's real constants. The create form validates against these when
 * they arrive and against the mirrored fallbacks until then, so a chain with a
 * differently-configured contract still gets correct client-side validation.
 */
export function useProtocolConstants() {
  const query = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...auctionHouse, functionName: "MIN_DURATION" },
      { ...auctionHouse, functionName: "MAX_DURATION" },
      { ...auctionHouse, functionName: "ANTI_SNIPE_WINDOW" },
      { ...auctionHouse, functionName: "MAX_EXTENSIONS" },
      { ...auctionHouse, functionName: "MIN_INCREMENT" },
    ],
    query: {
      /* Immutable by design — read once and keep it forever. */
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  });

  const value = <T,>(index: number, fallback: T): T => {
    const entry = query.data?.[index];
    return entry?.status === "success" ? (entry.result as T) : fallback;
  };

  return useMemo(
    () => ({
      minDuration: BigInt(value<bigint>(0, CONTRACT_LIMITS.MIN_DURATION)),
      maxDuration: BigInt(value<bigint>(1, CONTRACT_LIMITS.MAX_DURATION)),
      antiSnipeWindow: BigInt(value<bigint>(2, CONTRACT_LIMITS.ANTI_SNIPE_WINDOW)),
      maxExtensions: BigInt(value<number | bigint>(3, CONTRACT_LIMITS.MAX_EXTENSIONS)),
      minIncrement: BigInt(value<bigint>(4, CONTRACT_LIMITS.MIN_INCREMENT)),
      /* True once the real numbers are in, so the form can say so. */
      fromChain: query.isSuccess,
    }),
    /* query.data is the only input `value` reads; isSuccess reports whether
       the real constants arrived. Both are stable references from Query. */
    [query.data, query.isSuccess],
  );
}
