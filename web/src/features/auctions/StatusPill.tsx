import { Pill, type Tone } from "@/components/ui/Pill";
import { phaseOf, standingOf, type Auction, type AuctionPhase, type Standing } from "@/lib/auction";
import type { Address } from "viem";

/**
 * Auction state as a pill.
 *
 * Every phase gets its own WORD and its own GLYPH (from <Pill>), so the state
 * survives greyscale, a colour-vision deficiency, and a screen reader. Colour
 * is the third channel, never the only one (SC 1.4.1).
 */

const PHASE: Record<AuctionPhase, { tone: Tone; label: string; title: string }> = {
  live: { tone: "live", label: "live", title: "Accepting bids" },
  ending: {
    tone: "warn",
    label: "ending",
    title: "Under 5 minutes: a bid now extends the auction (anti-snipe)",
  },
  final: { tone: "danger", label: "final", title: "Under 60 seconds" },
  "awaiting-settlement": {
    tone: "action",
    label: "settle",
    title: "Time is up. Anyone can settle this auction.",
  },
  settled: { tone: "neutral", label: "settled", title: "Sold and paid out" },
  cancelled: { tone: "neutral", label: "cancelled", title: "Withdrawn by the seller before any bid" },
  "reserve-not-met": {
    tone: "danger",
    label: "no reserve",
    title: "Ended below the reserve price. The bidder was refunded in full.",
  },
};

export function StatusPill({ auction, now }: { auction: Auction; now: number }) {
  const p = phaseOf(auction, now);
  const meta = PHASE[p];
  return (
    <Pill tone={meta.tone} title={meta.title}>
      {meta.label}
    </Pill>
  );
}

const STANDING: Partial<Record<Standing, { tone: Tone; label: string; title: string }>> = {
  seller: { tone: "action", label: "yours", title: "You listed this auction" },
  winning: { tone: "live", label: "winning", title: "You are the highest bidder" },
  outbid: { tone: "danger", label: "outbid", title: "Someone has bid above you" },
  won: { tone: "live", label: "won", title: "You won this auction" },
  lost: { tone: "neutral", label: "lost", title: "You bid but did not win" },
  "refund-due": {
    tone: "warn",
    label: "refund due",
    title: "Your bid is credited to your withdrawable balance",
  },
};

/** Where the connected account stands. Renders nothing for a read-only visitor. */
export function StandingPill({
  auction,
  account,
  now,
}: {
  auction: Auction;
  account: Address | undefined;
  now: number;
}) {
  const standing = standingOf(auction, account, now);
  const meta = STANDING[standing];
  if (!meta) return null;
  return (
    <Pill tone={meta.tone} title={meta.title} solid={standing === "winning" || standing === "won"}>
      {meta.label}
    </Pill>
  );
}

export { PHASE as phaseMeta };
