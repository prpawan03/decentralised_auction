import { test, expect, type Page } from "@playwright/test";

/**
 * READ-ONLY MODE.
 *
 * This spec runs in a stock Chromium context with no wallet extension and no
 * window.ethereum. Everything asserted here must work anyway. If any of it
 * fails, the app has regressed to the state of the one it replaced, which
 * rendered nothing at all without MetaMask.
 */

/** Fails loudly if a wallet somehow IS present, since that would void the test. */
async function assertNoWallet(page: Page): Promise<void> {
  const hasEthereum = await page.evaluate(() => "ethereum" in window);
  expect(hasEthereum, "this project must run without a wallet extension").toBe(false);
}

test.describe("browsing with no wallet installed", () => {
  test("renders the board and says it is in read-only mode", async ({ page }) => {
    await page.goto("/");
    await assertNoWallet(page);

    await expect(page.getByRole("heading", { name: "Auction board", level: 1 })).toBeVisible();
    await expect(page.getByText("read-only")).toBeVisible();
    await expect(
      page.getByText(/Browsing without a wallet. Everything here is readable./),
    ).toBeVisible();
  });

  test("offers connecting as an option, never as a gate", async ({ page }) => {
    await page.goto("/");
    /* The connect button exists, but the page content is already there. */
    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("shows a distinguishable state for loading, empty and error", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    /* Exactly one of these, and never the generic "nothing here" for all
       three. Which one depends on whether a node and contract are up. */
    const empty = main.getByText("No auctions have been created yet");
    const failed = main.getByText("Could not read the chain");
    const table = main.getByRole("table");
    await expect(empty.or(failed).or(table).first()).toBeVisible();
  });

  test("navigates to a portfolio for any address without connecting", async ({ page }) => {
    await page.goto("/u/0x1111111111111111111111111111111111111111");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Portfolio");
    await expect(page.getByText("read-only view")).toBeVisible();
  });

  test("explains the withdrawal vault rather than showing an empty box", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Withdrawable balance" })).toBeVisible();
    await expect(page.getByText(/your ETH is credited to a balance here/)).toBeVisible();
  });

  test("keeps the create form readable, gated only at the point of signing", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByRole("heading", { name: "List an item", level: 1 })).toBeVisible();
    await expect(page.getByLabel("NFT contract")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create the auction" })).toBeDisabled();
  });
});

test.describe("URLs are real", () => {
  test("a bad auction id gets a page, not a crash", async ({ page }) => {
    await page.goto("/auctions/banana");
    await expect(page.getByRole("heading", { name: "Not a valid auction id" })).toBeVisible();
  });

  test("a bad address gets a page, not a crash", async ({ page }) => {
    await page.goto("/u/nonsense");
    await expect(page.getByRole("heading", { name: "Not a valid address" })).toBeVisible();
  });

  test("an unknown path renders the router error boundary", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "This page failed to load" })).toBeVisible();
  });

  test("survives a reload on a deep link", async ({ page }) => {
    await page.goto("/portfolio");
    await page.reload();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByRole("main")).toBeVisible();
  });
});
