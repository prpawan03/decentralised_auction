import { Suspense } from "react";
import { NavLink, Outlet, useNavigation } from "react-router-dom";
import { Toaster } from "sonner";
import { WalletButton } from "@/features/wallet/WalletButton";
import { ConnectionStrip, NodeDownBanner } from "@/features/wallet/ReadOnlyNotice";
import { WithdrawPanel } from "@/features/portfolio/WithdrawPanel";
import { AlertsToggle } from "@/features/auctions/AlertsToggle";
import { TxTray } from "@/components/ui/TxTray";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/cn";

/**
 * The shell.
 *
 * Landmark structure, once, here:
 *   skip link -> <header> (banner) -> <nav> -> <main id="main"> -> <footer>
 *
 * <main> is rendered by each PAGE rather than by this layout, because a page
 * that replaces its whole content (an error, a 404) needs to own the landmark.
 * Every page component therefore starts with <main id="main">, and the skip
 * link below targets that id.
 */

const NAV = [
  { to: "/", label: "Board", end: true },
  { to: "/create", label: "List an item", end: false },
  { to: "/portfolio", label: "Portfolio", end: false },
];

export function RootLayout() {
  const navigation = useNavigation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-dvh bg-[var(--color-ground)]">
      {/* SC 2.4.1 Bypass Blocks. Visible on focus, and it clears the sticky
          header thanks to scroll-padding-top in the base layer. */}
      <a
        href="#main"
        className={cn(
          "sr-only focus:not-sr-only",
          "focus:fixed focus:top-2 focus:left-2 focus:z-[60]",
          "focus:rounded-[3px] focus:border focus:border-[var(--color-action)]",
          "focus:bg-[var(--color-surface)] focus:px-4 focus:py-2.5",
          "focus:text-sm focus:font-medium focus:text-[var(--color-ink)]",
        )}
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 bg-[var(--color-ground)]">
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] px-4 py-1 sm:h-14 sm:flex-nowrap sm:gap-6 sm:py-0 lg:px-6">
          <NavLink to="/" className="flex shrink-0 items-baseline gap-2 no-underline">
            <span className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">
              AUCTIONHOUSE
            </span>
            <span className="hidden text-[0.625rem] tracking-[0.14em] text-[var(--color-ink-3)] uppercase sm:inline">
              local terminal
            </span>
          </NavLink>

          <nav aria-label="Main" className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
            <ul className="flex items-center gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "tap inline-flex h-8 items-center rounded-[3px] px-3 text-[0.8125rem] no-underline",
                        /* The active item gets an underline as well as a
                           colour, so "where am I" is not colour-only. */
                        isActive
                          ? "font-medium text-[var(--color-ink)] underline decoration-[var(--color-action)] decoration-2 underline-offset-[6px]"
                          : "text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <AlertsToggle />

          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
            className="tap inline-flex h-8 items-center rounded-[3px] border border-[var(--color-line-strong)] px-3 text-[0.75rem] text-[var(--color-ink-2)] hover:bg-[var(--color-raised)]"
          >
            {/* The label states the ACTION, not the current state, and it is
                text rather than an icon, so it needs no extra name. */}
            <span className="sm:hidden">Theme</span>
            <span className="hidden sm:inline">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>

          <WalletButton />
        </div>

        <ConnectionStrip />
        <WithdrawPanel variant="banner" />
        <NodeDownBanner />

        {/* Route transitions are announced once, politely. */}
        <p role="status" aria-live="polite" className="sr-only">
          {navigation.state === "loading" ? "Loading page" : ""}
        </p>
      </header>

      <Suspense
        fallback={
          <main id="main" className="mx-auto w-full max-w-[90rem] px-4 py-10">
            <p role="status" className="text-sm text-[var(--color-ink-3)]">
              Loading…
            </p>
          </main>
        }
      >
        <Outlet />
      </Suspense>

      <footer className="mt-10 border-t border-[var(--color-line)] px-4 py-5 lg:px-6">
        <p className="max-w-prose text-[0.75rem] leading-relaxed text-[var(--color-ink-3)]">
          A local-chain demo. The accounts are the public test mnemonic and hold no real money.
          Every figure on this page is read from contract storage, not from a cache of events.
        </p>
      </footer>

      <TxTray />

      {/*
        EXACTLY ONE Toaster, mounted once, at the root.

        The app this replaces mounted one inside every auction card. React Hot
        Toast renders every toast into every mounted Toaster, so with 13 cards
        on screen a single "Bid placed" appeared 13 times and was announced 13
        times by a screen reader. One root Toaster is the entire fix, and
        src/app/regressions.test.tsx fails if a second one ever appears.
      */}
      <Toaster
        position="bottom-left"
        closeButton
        richColors={false}
        toastOptions={{
          className: "auction-toast",
          style: {
            background: "var(--color-surface)",
            border: "1px solid var(--color-line-strong)",
            borderRadius: "3px",
            color: "var(--color-ink)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.8125rem",
          },
        }}
      />
    </div>
  );
}
