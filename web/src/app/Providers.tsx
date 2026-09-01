import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/config/wagmi";
import { TickerProvider } from "@/hooks/useTicker";
import { TxTrackerProvider } from "@/hooks/useTxTracker";
import { ActivityProvider } from "@/hooks/useAuctionEvents";
import { AlertsProvider } from "@/hooks/useAuctionAlerts";
import { useTheme } from "@/hooks/useTheme";

/**
 * Provider order matters:
 *
 *   WagmiProvider          transport + connectors (reads work with no wallet)
 *     QueryClientProvider  TanStack Query owns ALL chain data
 *       RainbowKit         wallet modal only
 *         TickerProvider   one 1 Hz clock for every countdown on the page
 *           TxTracker      receipt watchers, mounted above the routes so a
 *                          navigation cannot orphan a pending transaction
 *             Activity     event watchers -> query invalidation
 *               Alerts     snapshot diffing -> outbid / ending / settled
 */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /* A local chain is fast and events invalidate precisely, so a modest
           staleTime avoids a refetch storm without ever showing stale prices. */
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          /* A missing contract will never succeed on retry; a dead node might. */
          const text = String(error);
          if (/reverted|AuctionNotFound|returned no data/i.test(text)) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  /* Created once per mount, never on re-render. A new QueryClient per render
     would drop every cache entry on every keystroke. */
  const [queryClient] = useState(makeQueryClient);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitThemeBridge>
          <TickerProvider>
            <TxTrackerProvider>
              <ActivityProvider>
                <AlertsProvider>{children}</AlertsProvider>
              </ActivityProvider>
            </TxTrackerProvider>
          </TickerProvider>
        </RainbowKitThemeBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * RainbowKit's modal has its own theme object. Feed it the app's tokens so the
 * wallet sheet is not a bright white rectangle in the middle of a dark
 * terminal, and so it inherits the same accent.
 */
function RainbowKitThemeBridge({ children }: { children: ReactNode }) {
  const { theme } = useTheme();

  const base =
    theme === "light"
      ? lightTheme({ accentColor: "#0b5cd8", accentColorForeground: "#ffffff", borderRadius: "small" })
      : darkTheme({ accentColor: "#4c8dff", accentColorForeground: "#0a0f14", borderRadius: "small" });

  return (
    <RainbowKitProvider theme={base} modalSize="compact" appInfo={{ appName: "AuctionHouse" }}>
      {children}
    </RainbowKitProvider>
  );
}
