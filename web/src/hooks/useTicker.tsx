import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * ONE interval for the whole page.
 *
 * The app renders dozens of countdowns. Giving each card its own setInterval
 * means dozens of timers drifting against each other, dozens of re-renders per
 * second, and a battery bill. This provider runs a single 1 Hz tick and every
 * countdown derives its own value from the shared clock during render.
 *
 * The interval is self-correcting: it schedules to the next whole second
 * rather than every 1000 ms, so it does not drift when the tab is throttled.
 * It also stops entirely when the tab is hidden, and resyncs on return.
 */

interface TickerValue {
  /** Seconds since the Unix epoch, updated once per second. */
  now: number;
}

const TickerContext = createContext<TickerValue | null>(null);

/**
 * Chain-time anchoring.
 *
 * The contract judges "ended", "ending soon" and the Dutch price by
 * block.timestamp. The browser only has Date.now(). On a public chain the two
 * agree to within a block; on a local node they can be minutes apart, because a
 * seed script jumps the clock to settle closed auctions and interval mining
 * only advances block time when a block is mined. Measured on this stack: 296 s.
 *
 * So the clock is wall time plus a skew, and the skew is re-derived from every
 * new block by <ChainClockAnchor/> (hooks/useChainClock.tsx). Countdowns,
 * status pills, the settle button and the Dutch price all read this one value,
 * which is what makes them agree with the contract instead of with the laptop.
 */
const SkewContext = createContext<(skewSeconds: number) => void>(() => {});
let skewSeconds = 0;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000) + skewSeconds;
}

export function TickerProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<number>(nowSeconds);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };

    const schedule = () => {
      /* Aim at the next whole second, not "1000 ms from whenever we ran". */
      const msToNextSecond = 1000 - (Date.now() % 1000);
      timeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        setNow(nowSeconds());
        schedule();
      }, msToNextSecond);
    };

    const onVisibility = () => {
      stop();
      if (document.visibilityState === "visible") {
        /* Resync immediately: the clock may be minutes stale. */
        setNow(nowSeconds());
        schedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") schedule();

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const value = useMemo<TickerValue>(() => ({ now }), [now]);

  /* Re-anchor at once, so a corrected skew is visible on the next paint rather
     than up to a second later. */
  const setSkew = useMemo(
    () => (next: number) => {
      if (next === skewSeconds) return;
      skewSeconds = next;
      setNow(nowSeconds());
    },
    [],
  );

  return (
    <SkewContext.Provider value={setSkew}>
      <TickerContext.Provider value={value}>{children}</TickerContext.Provider>
    </SkewContext.Provider>
  );
}

/**
 * The shared clock, in seconds since the epoch.
 *
 * Falls back to a one-shot read outside a provider (unit tests that render a
 * leaf component in isolation) rather than throwing, because a countdown that
 * renders a stale time is better than a page that crashes.
 */
export function useNow(): number {
  const ctx = useContext(TickerContext);
  const [fallback] = useState(nowSeconds);
  return ctx ? ctx.now : fallback;
}

/** Lets the chain anchor publish the offset between block time and wall time. */
export function useSetClockSkew(): (skewSeconds: number) => void {
  return useContext(SkewContext);
}
