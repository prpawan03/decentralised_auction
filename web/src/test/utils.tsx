import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TickerProvider } from "@/hooks/useTicker";
import { zeroAddress, type Address } from "viem";
import { AuctionStatus, type Auction } from "@/lib/auction";

/**
 * Test harness.
 *
 * Deliberately does NOT mount WagmiProvider: these tests exercise the
 * read-only, presentational layer, which must work with no wallet stack at
 * all. Anything that needs wagmi mocks it explicitly.
 */

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TickerProvider>{children}</TickerProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * "Now", in epoch seconds, captured once per test run.
 *
 * It tracks the REAL clock rather than a frozen constant, because components
 * read the shared ticker, which reads Date.now(). A frozen 2023 timestamp
 * would put every fixture in the past and quietly turn every auction into
 * "ended" — a fixture bug that looks exactly like a logic bug.
 */
export const NOW = Math.floor(Date.now() / 1000);

const ALICE = "0x1111111111111111111111111111111111111111" as Address;
const BOB = "0x2222222222222222222222222222222222222222" as Address;

export const accounts = { alice: ALICE, bob: BOB, zero: zeroAddress };

/** Build an Auction struct. Overrides are shallow-merged. */
export function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 1n,
    seller: ALICE,
    reservePrice: 1_000_000_000_000_000_000n, // 1 ETH
    highestBidder: BOB,
    highestBid: 2_500_000_000_000_000_000n, // 2.5 ETH
    nft: "0x3333333333333333333333333333333333333333" as Address,
    buyNowPrice: 0n,
    tokenId: 7n,
    endTime: BigInt(NOW + 3_600),
    startTime: BigInt(NOW - 3_600),
    extensionCount: 0,
    minIncrementBps: 500,
    status: AuctionStatus.Live,
    ...overrides,
  };
}
