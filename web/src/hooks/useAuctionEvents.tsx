import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { useWatchContractEvent } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Address, Log } from "viem";
import { auctionHouse } from "@/config/contracts";

/**
 * The live activity feed.
 *
 * THE RULE: a log NEVER becomes the source of truth for auction state.
 *
 * Each watcher does two things:
 *   1. invalidates the TanStack Query keys the event touched, so the next
 *      render re-reads the struct from the chain;
 *   2. pushes a small, display-only record onto a capped feed list.
 *
 * Item 2 is a *narrative*, not state: it is what happened, timestamped. If a
 * reorg drops a log the feed is briefly wrong about history, but the prices,
 * bidders and countdowns everywhere else are re-read from the chain and stay
 * correct. That separation is the whole design.
 */

export type ActivityKind = "created" | "bid" | "extended" | "settled" | "cancelled";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  auctionId: bigint;
  at: number; // client receipt time in epoch seconds
  actor?: Address;
  amount?: bigint;
  /** AuctionExtended only. */
  extensionCount?: number;
  newEndTime?: bigint;
  /** AuctionSettled only: the Status enum value. */
  outcome?: number;
  blockNumber?: bigint;
}

const MAX_FEED = 60;

type FeedAction = { type: "push"; items: ActivityItem[] } | { type: "clear" };

function feedReducer(state: ActivityItem[], action: FeedAction): ActivityItem[] {
  switch (action.type) {
    case "push": {
      /* De-duplicate: a watcher can re-emit on reconnect. */
      const seen = new Set(state.map((i) => i.id));
      const fresh = action.items.filter((i) => !seen.has(i.id));
      if (fresh.length === 0) return state;
      return [...fresh, ...state].slice(0, MAX_FEED);
    }
    case "clear":
      return [];
    default:
      return state;
  }
}

interface ActivityContextValue {
  items: ActivityItem[];
  clear: () => void;
  /** Most recent AuctionExtended per auction, for the anti-snipe indicator. */
  lastExtension: Map<string, ActivityItem>;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

/** A stable id for a log, so a re-emitted log does not duplicate in the feed. */
function logId(log: Log): string {
  const tx = log.transactionHash ?? "pending";
  const index = log.logIndex ?? 0;
  return `${tx}:${String(index)}`;
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(feedReducer, [] as ActivityItem[]);
  const queryClient = useQueryClient();

  /**
   * Invalidate everything that could have changed. Coarse on purpose: a local
   * chain read is a millisecond, and a stale price is a bug a user can lose
   * money to.
   */
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
    void queryClient.invalidateQueries({ queryKey: ["readContract"] });
  }, [queryClient]);

  const push = useCallback(
    (next: ActivityItem[]) => {
      if (next.length === 0) return;
      dispatch({ type: "push", items: next });
      invalidate();
    },
    [invalidate],
  );

  const now = () => Math.floor(Date.now() / 1000);

  useWatchContractEvent({
    ...auctionHouse,
    eventName: "AuctionCreated",
    /* Poll rather than subscribe: an HTTP-only node has no eth_subscribe, and
       read-only mode must work with nothing but plain HTTP. */
    poll: true,
    pollingInterval: 4_000,
    onLogs(logs) {
      push(
        logs.map((log) => {
          const a = log.args;
          return {
            id: logId(log),
            kind: "created" as const,
            auctionId: a.auctionId ?? 0n,
            at: now(),
            ...(a.seller ? { actor: a.seller } : {}),
            ...(a.reservePrice !== undefined ? { amount: a.reservePrice } : {}),
            ...(log.blockNumber !== null && log.blockNumber !== undefined
              ? { blockNumber: log.blockNumber }
              : {}),
          };
        }),
      );
    },
  });

  useWatchContractEvent({
    ...auctionHouse,
    eventName: "BidPlaced",
    poll: true,
    pollingInterval: 4_000,
    onLogs(logs) {
      push(
        logs.map((log) => {
          const a = log.args;
          return {
            id: logId(log),
            kind: "bid" as const,
            auctionId: a.auctionId ?? 0n,
            at: now(),
            ...(a.bidder ? { actor: a.bidder } : {}),
            ...(a.amount !== undefined ? { amount: a.amount } : {}),
            ...(log.blockNumber !== null && log.blockNumber !== undefined
              ? { blockNumber: log.blockNumber }
              : {}),
          };
        }),
      );
    },
  });

  useWatchContractEvent({
    ...auctionHouse,
    eventName: "AuctionExtended",
    poll: true,
    pollingInterval: 4_000,
    onLogs(logs) {
      push(
        logs.map((log) => {
          const a = log.args;
          return {
            id: logId(log),
            kind: "extended" as const,
            auctionId: a.auctionId ?? 0n,
            at: now(),
            ...(a.extensionCount !== undefined ? { extensionCount: Number(a.extensionCount) } : {}),
            ...(a.newEndTime !== undefined ? { newEndTime: a.newEndTime } : {}),
            ...(log.blockNumber !== null && log.blockNumber !== undefined
              ? { blockNumber: log.blockNumber }
              : {}),
          };
        }),
      );
    },
  });

  useWatchContractEvent({
    ...auctionHouse,
    eventName: "AuctionSettled",
    poll: true,
    pollingInterval: 4_000,
    onLogs(logs) {
      push(
        logs.map((log) => {
          const a = log.args;
          return {
            id: logId(log),
            kind: "settled" as const,
            auctionId: a.auctionId ?? 0n,
            at: now(),
            ...(a.winner ? { actor: a.winner } : {}),
            ...(a.amount !== undefined ? { amount: a.amount } : {}),
            ...(a.outcome !== undefined ? { outcome: Number(a.outcome) } : {}),
            ...(log.blockNumber !== null && log.blockNumber !== undefined
              ? { blockNumber: log.blockNumber }
              : {}),
          };
        }),
      );
    },
  });

  useWatchContractEvent({
    ...auctionHouse,
    eventName: "AuctionCancelled",
    poll: true,
    pollingInterval: 8_000,
    onLogs(logs) {
      push(
        logs.map((log) => {
          const a = log.args;
          return {
            id: logId(log),
            kind: "cancelled" as const,
            auctionId: a.auctionId ?? 0n,
            at: now(),
            ...(a.seller ? { actor: a.seller } : {}),
            ...(log.blockNumber !== null && log.blockNumber !== undefined
              ? { blockNumber: log.blockNumber }
              : {}),
          };
        }),
      );
    },
  });

  const lastExtension = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    /* items is newest-first, so the first hit per auction is the latest. */
    for (const item of items) {
      if (item.kind !== "extended") continue;
      const key = item.auctionId.toString();
      if (!map.has(key)) map.set(key, item);
    }
    return map;
  }, [items]);

  const value = useMemo<ActivityContextValue>(
    () => ({ items, clear: () => dispatch({ type: "clear" }), lastExtension }),
    [items, lastExtension],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  /* Read-only leaf components render fine without the provider (tests). */
  return ctx ?? { items: [], clear: () => {}, lastExtension: new Map() };
}

/** The feed narrowed to one auction. */
export function useAuctionActivity(auctionId: bigint | undefined): ActivityItem[] {
  const { items } = useActivity();
  return useMemo(() => {
    if (auctionId === undefined) return [];
    return items.filter((i) => i.auctionId === auctionId);
  }, [items, auctionId]);
}
