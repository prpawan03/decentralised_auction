import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The watchlist: auctions this browser is following.
 *
 * Deliberately local. Putting a watchlist on chain would cost gas to star an
 * item and would publish, permanently, exactly which lots an address is
 * interested in before it bids — which is a real disadvantage in an auction.
 * Local storage keeps it free and private, at the cost of not following the
 * user between devices. That is the right trade for a marketplace.
 *
 * A watchlist is also NOT authorisation for anything. It only decides which
 * rows get a star and which notifications fire, so a corrupt or hand-edited
 * value can never do worse than show the wrong stars.
 */

const STORAGE_KEY = "auction:watchlist:v1";

/** Cap the stored set. An unbounded list would grow forever and slow every read. */
const MAX_WATCHED = 500;

/**
 * Reads the set from storage, tolerating every way it can be broken:
 * absent, unparseable, the wrong shape, or storage disabled outright (Safari
 * private mode throws on access, it does not return null).
 */
function read(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    /* Ids only. Anything else in the array is discarded rather than trusted. */
    return new Set(parsed.filter((v): v is string => typeof v === "string" && /^\d+$/.test(v)));
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(0, MAX_WATCHED)));
  } catch {
    /* Storage full or blocked. The in-memory set still works for this tab,
       so the star reacts and only the persistence is lost. */
  }
}

export interface Watchlist {
  ids: ReadonlySet<string>;
  has: (id: bigint) => boolean;
  toggle: (id: bigint) => void;
  count: number;
}

export function useWatchlist(): Watchlist {
  const [ids, setIds] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : read(),
  );

  /* Cross-tab sync. Two tabs open on the same board should not disagree about
     which items are starred; the `storage` event fires in every OTHER tab. */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      setIds(read());
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggle = useCallback((id: bigint) => {
    setIds((current) => {
      const next = new Set(current);
      const key = id.toString();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      write(next);
      return next;
    });
  }, []);

  const has = useCallback((id: bigint) => ids.has(id.toString()), [ids]);

  return useMemo(() => ({ ids, has, toggle, count: ids.size }), [ids, has, toggle]);
}
