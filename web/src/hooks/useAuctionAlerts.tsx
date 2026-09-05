import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useAuctions } from "./useAuctions";
import { useNow } from "./useTicker";
import { useWatchlist } from "./useWatchlist";
import {
  AuctionStatus,
  ENDING_SOON_SECONDS,
  sameAddress,
  secondsRemaining,
  type Auction,
} from "@/lib/auction";
import { formatEth } from "@/lib/format";

/**
 * Alerts: the thing that makes an auction app usable when you are not staring
 * at it.
 *
 * Everything here is derived by DIFFING TWO CHAIN SNAPSHOTS, never by reading
 * a log. That is deliberate. "You were outbid" from a `BidPlaced` log would
 * fire on a log that a reorg later drops, and would tell a bidder they had
 * lost a lead they still hold. Comparing the previous `getAuctions` result
 * with the current one cannot do that: if the chain reorganises, the next read
 * reflects the reorganised chain and the comparison stays honest.
 *
 * Two delivery channels, both optional:
 *
 *   - a toast, always, because the tab is usually open;
 *   - a system notification, only when the user has explicitly turned alerts
 *     on. Permission is requested from a click, never on load: a permission
 *     prompt that appears unprompted is the fastest way to get denied forever.
 */

export type AlertKind = "outbid" | "ending-soon" | "won" | "sold" | "reserve-missed";

const STORAGE_KEY = "auction:alerts:v1";

/** Cap the fired-key set so a long session cannot grow it without bound. */
const MAX_FIRED = 400;

interface AlertsContextValue {
  /** True when the user has opted in AND the browser granted permission. */
  enabled: boolean;
  /** Whether this browser can do system notifications at all. */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** Must be called from a user gesture. Requests permission on first enable. */
  toggle: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function readOptIn(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * The message for one alert. Kept beside the diff logic so a new alert kind
 * cannot be added without also deciding what it says.
 */
function describe(kind: AlertKind, auction: Auction): { title: string; body: string } {
  const lot = `Auction #${auction.id.toString()}`;
  switch (kind) {
    case "outbid":
      return {
        title: `Outbid on ${lot}`,
        body: `The leading bid is now ${formatEth(auction.highestBid)} ETH. Your funds are held as a credit you can withdraw, or you can bid again.`,
      };
    case "ending-soon":
      return {
        title: `${lot} is ending`,
        body: `Under five minutes left. A bid now extends the deadline by five minutes.`,
      };
    case "won":
      return { title: `You won ${lot}`, body: `Settled at ${formatEth(auction.highestBid)} ETH.` };
    case "sold":
      return {
        title: `${lot} sold`,
        body: `Settled at ${formatEth(auction.highestBid)} ETH, less the platform fee.`,
      };
    case "reserve-missed":
      return {
        title: `${lot} closed below reserve`,
        body: `No sale. The token returns to the seller and every bid is refundable.`,
      };
  }
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [optIn, setOptIn] = useState(() => (typeof window === "undefined" ? false : readOptIn()));
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    notificationsSupported() ? Notification.permission : "unsupported",
  );

  const toggle = useCallback(() => {
    if (optIn) {
      setOptIn(false);
      try {
        window.localStorage.setItem(STORAGE_KEY, "off");
      } catch {
        /* Preference is not worth failing over; the session still honours it. */
      }
      return;
    }
    setOptIn(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "on");
    } catch {
      /* As above. */
    }
    /* This runs inside the click handler, which is the only context where a
       browser will show the permission prompt rather than silently deny it. */
    if (notificationsSupported() && Notification.permission === "default") {
      void Notification.requestPermission().then(setPermission);
    }
  }, [optIn]);

  const enabled = optIn && permission === "granted";

  const value = useMemo<AlertsContextValue>(
    () => ({ enabled, supported: notificationsSupported(), permission, toggle }),
    [enabled, permission, toggle],
  );

  return (
    <AlertsContext.Provider value={value}>
      <AlertEngine systemNotifications={enabled} />
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  /* Leaf components render without the provider in unit tests. */
  return (
    ctx ?? { enabled: false, supported: false, permission: "unsupported", toggle: () => undefined }
  );
}

/**
 * The diff engine. Renders nothing; it exists so the snapshot comparison runs
 * exactly once for the whole app rather than once per mounted component.
 */
function AlertEngine({ systemNotifications }: { systemNotifications: boolean }) {
  const { address } = useAccount();
  const now = useNow();
  const { auctions } = useAuctions();
  const { has: watching } = useWatchlist();

  /* The previous snapshot, keyed by auction id. A ref, not state: writing it
     must not itself cause a render, or the diff would never settle. */
  const previous = useRef(new Map<string, Auction>());
  /* Every alert already delivered, so a re-render or a refetch cannot repeat
     one. Keyed by kind AND auction, because an auction can legitimately
     produce both "ending-soon" and later "won". */
  const fired = useRef(new Set<string>());

  const deliver = useCallback(
    (kind: AlertKind, auction: Auction) => {
      const key = `${kind}:${auction.id.toString()}`;
      if (fired.current.has(key)) return;
      if (fired.current.size >= MAX_FIRED) fired.current.clear();
      fired.current.add(key);

      const { title, body } = describe(kind, auction);

      /* A toast, always. It is the only channel that works without permission
         and it is where the user is already looking. */
      toast(title, { description: body, duration: kind === "ending-soon" ? 8_000 : 6_000 });

      if (!systemNotifications) return;
      try {
        /* `tag` collapses repeats at the OS level as a second line of defence
           behind the fired set — two tabs open would otherwise each fire. */
        new Notification(title, { body, tag: key });
      } catch {
        /* Some browsers throw for notifications outside a service worker.
           The toast already carried the message, so there is nothing to do. */
      }
    },
    [systemNotifications],
  );

  useEffect(() => {
    const before = previous.current;
    const after = new Map<string, Auction>();

    for (const auction of auctions) {
      const id = auction.id.toString();
      after.set(id, auction);
      const prior = before.get(id);

      /* First sighting. Never alert on it: on a page load every auction is
         "new", and firing here would greet the user with a wall of toasts
         about things that happened while they were away. */
      if (!prior) continue;

      const involved =
        sameAddress(auction.seller, address) || sameAddress(prior.highestBidder, address);

      /* Outbid: I held the lead in the previous snapshot and someone else
         holds it now. Checked against the PREVIOUS leader, so a refetch that
         returns identical data can never re-fire it. */
      if (
        address &&
        sameAddress(prior.highestBidder, address) &&
        !sameAddress(auction.highestBidder, address) &&
        auction.highestBid > prior.highestBid
      ) {
        deliver("outbid", auction);
      }

      /* Terminal transitions. Only for the two parties they concern. */
      if (prior.status === AuctionStatus.Live && auction.status !== AuctionStatus.Live) {
        if (auction.status === AuctionStatus.Settled) {
          if (sameAddress(auction.highestBidder, address)) deliver("won", auction);
          else if (sameAddress(auction.seller, address)) deliver("sold", auction);
        } else if (auction.status === AuctionStatus.ReserveNotMet && involved) {
          deliver("reserve-missed", auction);
        }
      }
    }

    previous.current = after;
  }, [auctions, address, deliver]);

  /* Ending-soon is a clock event, not a state change, so it hangs off the
     ticker rather than the snapshot diff. Only watched auctions and ones the
     user has money or an item in: an unsolicited alert about a stranger's lot
     is spam. */
  useEffect(() => {
    for (const auction of auctions) {
      if (auction.status !== AuctionStatus.Live) continue;
      const left = secondsRemaining(auction, now);
      if (left <= 0 || left > ENDING_SOON_SECONDS) continue;

      const mine =
        watching(auction.id) ||
        sameAddress(auction.seller, address) ||
        sameAddress(auction.highestBidder, address);
      if (!mine) continue;

      deliver("ending-soon", auction);
    }
  }, [auctions, now, address, watching, deliver]);

  return null;
}
