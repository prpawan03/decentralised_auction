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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
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

  return <TickerContext.Provider value={value}>{children}</TickerContext.Provider>;
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
