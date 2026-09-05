import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "./Field";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Countdown } from "./Countdown";
import { AddressChip } from "./AddressChip";
import { AuctionTable } from "@/features/auctions/AuctionTable";
import { renderWithProviders, makeAuction, accounts, NOW } from "@/test/utils";
import type { AxeResults } from "axe-core";

/** axe's own summary, formatted so a failure names the rule and the node. */
function violationsOf(results: AxeResults): string[] {
  return results.violations.map(
    (v) => `${v.id} (${v.impact ?? "n/a"}): ${v.help} — ${v.nodes.length} node(s)`,
  );
}

describe("Field — SC 1.3.1, 3.3.1, 3.3.2, 4.1.2", () => {
  it("associates the label with the control via a real id/htmlFor pair", () => {
    renderWithProviders(<Field label="Your bid" />);
    /* getByLabelText only finds it if the association is real. */
    const input = screen.getByLabelText("Your bid");
    expect(input).toBeInTheDocument();
    expect(input.id).toBeTruthy();
  });

  it("generates unique ids so two instances never collide", () => {
    renderWithProviders(
      <>
        <Field label="Reserve price" />
        <Field label="Buy-now price" />
      </>,
    );
    const a = screen.getByLabelText("Reserve price");
    const b = screen.getByLabelText("Buy-now price");
    expect(a.id).not.toBe(b.id);
  });

  it("links helper text with aria-describedby", () => {
    renderWithProviders(<Field label="Your bid" hint="At least 2.5 ETH." />);
    const input = screen.getByLabelText("Your bid");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(" ")[0]!)).toHaveTextContent(
      "At least 2.5 ETH.",
    );
  });

  it("sets aria-invalid and announces the error through role=alert", () => {
    renderWithProviders(<Field label="Your bid" error="Your bid must be at least 2.5200 ETH." />);
    const input = screen.getByLabelText("Your bid");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your bid must be at least 2.5200 ETH.");
    /* The alert must ALSO be in aria-describedby, so it is read on focus and
       not only at the moment it appears. */
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("keeps helper text AND the error described, not one replacing the other", () => {
    renderWithProviders(<Field label="Your bid" hint="Minimum 2.5 ETH." error="Too low." />);
    const ids = screen.getByLabelText("Your bid").getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
  });

  it("marks a required field for assistive tech, not only with an asterisk", () => {
    renderWithProviders(<Field label="Token id" required />);
    expect(screen.getByLabelText(/Token id/)).toBeRequired();
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Field label="Your bid" hint="At least 2.5 ETH." suffix="ETH" error="Too low." />,
    );
    const results = await axe(container);
    expect(violationsOf(results)).toEqual([]);
  });
});

describe("Dialog — SC 2.1.2, 2.4.3, 3.2.1, 4.1.2", () => {
  function Harness() {
    return (
      <Dialog
        open
        onOpenChange={() => {}}
        title="Bid on auction #1"
        description="Your bid is simulated before you sign."
      >
        <Field label="Your bid" />
      </Dialog>
    );
  }

  it("is a real modal with an accessible name and description", () => {
    renderWithProviders(<Harness />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Bid on auction #1");
    expect(dialog).toHaveAccessibleDescription("Your bid is simulated before you sign.");
  });

  it("gives the close control a text name, not a bare glyph", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    let open = true;
    const onOpenChange = (next: boolean) => {
      open = next;
    };
    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange} title="T" description="D">
        <p>body</p>
      </Dialog>,
    );
    await user.keyboard("{Escape}");
    expect(open).toBe(false);
  });

  it("has no axe violations", async () => {
    renderWithProviders(<Harness />);
    /* The dialog portals to body, so scan the document, not the container. */
    const results = await axe(document.body);
    expect(violationsOf(results)).toEqual([]);
  });
});

describe("Countdown — SC 2.2.2, 4.1.3", () => {
  it("hides the digit string from assistive tech", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW + 3_600)} />);
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("aria-hidden", "true");
  });

  it("carries the spoken value in a POLITE live region, never assertive", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW + 30)} />);
    const status = document.querySelector('[role="status"]');
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("stays silent above every announcement threshold", () => {
    /* Two hours out, no threshold has been crossed, so the live region holds
       nothing and a screen reader says nothing. This is what stops the
       per-second chatter that makes a 1 Hz live region unusable. */
    renderWithProviders(<Countdown endTime={BigInt(NOW + 7_200)} />);
    expect(document.querySelector('[role="status"]')).toBeEmptyDOMElement();
  });

  it("announces in WORDS once a threshold is crossed, never as digit groups", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW + 25)} />);
    const status = document.querySelector('[role="status"]');
    expect(status).toHaveTextContent(/second/);
    expect(status).not.toHaveTextContent(/\d\d:\d\d/);
  });

  it("adds a non-colour urgency word inside the anti-snipe window", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW + 120)} />);
    expect(screen.getByText("ending")).toBeInTheDocument();
  });

  it("escalates that word under 60 seconds", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW + 30)} />);
    expect(screen.getByText("final")).toBeInTheDocument();
  });

  it("reads ENDED once the end time has passed", () => {
    renderWithProviders(<Countdown endTime={BigInt(NOW - 10)} />);
    expect(screen.getByText("ENDED")).toBeInTheDocument();
  });
});

describe("AddressChip — SC 1.1.1, 4.1.2", () => {
  it("spells the address out for assistive tech instead of reading the truncation", () => {
    renderWithProviders(<AddressChip address={accounts.alice} linked={false} />);
    const copy = screen.getByRole("button", { name: /Copy address/ });
    expect(copy).toHaveAccessibleName(`Copy address ${accounts.alice.split("").join(" ")}`);
  });

  it("has no axe violations", async () => {
    const { container } = renderWithProviders(<AddressChip address={accounts.alice} you />);
    const results = await axe(container);
    expect(violationsOf(results)).toEqual([]);
  });
});

describe("Button", () => {
  it("keeps its accessible name while loading, adding a status suffix", () => {
    renderWithProviders(
      <Button loading loadingLabel="Waiting for your wallet">
        Place bid
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Place bid/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(within(button).getByText("Waiting for your wallet")).toBeInTheDocument();
  });
});

describe("AuctionTable — SC 1.3.1, 1.4.10", () => {
  const auctions = [
    makeAuction({ id: 1n }),
    makeAuction({
      id: 2n,
      endTime: BigInt(NOW + 120),
      highestBid: 0n,
      highestBidder: accounts.zero,
    }),
    makeAuction({ id: 3n, buyNowPrice: 9_000_000_000_000_000_000n, reservePrice: 0n }),
  ];

  it("uses a table with a caption, column headers and row headers", () => {
    renderWithProviders(
      <AuctionTable auctions={auctions} now={NOW} account={undefined} caption="Three auctions" />,
    );
    const table = screen.getByRole("table", { name: "Three auctions" });
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(8);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
  });

  it("renders fully with NO connected account — read-only is the default", () => {
    renderWithProviders(
      <AuctionTable auctions={auctions} now={NOW} account={undefined} caption="Board" />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
  });

  it("says 'off' for a disabled buy-now, never 'free' or '0'", () => {
    renderWithProviders(
      <AuctionTable
        auctions={[makeAuction({ buyNowPrice: 0n })]}
        now={NOW}
        account={undefined}
        caption="One"
      />,
    );
    expect(screen.getByText("off")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWithProviders(
      <AuctionTable auctions={auctions} now={NOW} account={accounts.bob} caption="Board" />,
    );
    const results = await axe(container);
    expect(violationsOf(results)).toEqual([]);
  });
});
