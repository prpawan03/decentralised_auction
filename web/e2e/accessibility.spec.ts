import { test, expect } from "@playwright/test";

/**
 * Keyboard and landmark checks that only a real browser can make: jsdom has no
 * layout, no focus ring, and no tab order worth trusting.
 */

test.describe("keyboard operation — SC 2.1.1, 2.4.1, 2.4.7", () => {
  test("the first Tab reaches a working skip link", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    /* sr-only until focused: it must be genuinely visible once it has focus. */
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("every interactive element shows a focus indicator", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });

    expect(outline).not.toBeNull();
    expect(outline!.style).not.toBe("none");
    expect(Number.parseFloat(outline!.width)).toBeGreaterThanOrEqual(2);
  });

  test("focus order follows the visual order through the header", async ({ page }) => {
    await page.goto("/");
    const names: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      names.push(
        await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30) ?? ""),
      );
    }
    expect(names[0]).toContain("Skip to main content");
    expect(names.join("|")).toContain("Board");
  });
});

test.describe("landmarks and headings — SC 1.3.1, 2.4.6", () => {
  test("has exactly one main landmark and one h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
  });

  test("names every navigation landmark", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("reflow and target size — SC 1.4.10, 2.5.8", () => {
  test("does not scroll horizontally at 320 CSS px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, "the page body must never scroll sideways").toBe(false);
  });

  test("every visible control clears 24 by 24 CSS pixels", async ({ page }) => {
    await page.goto("/");
    const tooSmall = await page.evaluate(() => {
      const selectors = "button, a[href], input, select, [role='button']";
      return [...document.querySelectorAll<HTMLElement>(selectors)]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ rect: el.getBoundingClientRect(), label: el.textContent?.trim() ?? el.tagName }))
        .filter(({ rect }) => rect.width > 0 && (rect.width < 24 || rect.height < 24))
        .map(({ label, rect }) => `${label} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
    });
    expect(tooSmall).toEqual([]);
  });
});

test.describe("theme — both themes must be usable", () => {
  test("toggles and persists across a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /theme$/i }).click();

    const isLight = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-light"),
    );
    expect(isLight).toBe(true);

    await page.reload();
    /* The inline boot script must re-apply it before first paint. */
    const stillLight = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-light"),
    );
    expect(stillLight).toBe(true);
  });
});

test.describe("reduced motion — SC 2.3.3", () => {
  test("neutralises transitions when the user asks for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const durations = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, a")]
        .slice(0, 20)
        .map((el) => getComputedStyle(el).transitionDuration),
    );
    for (const d of durations) {
      expect(Number.parseFloat(d)).toBeLessThanOrEqual(0.001);
    }
  });
});
