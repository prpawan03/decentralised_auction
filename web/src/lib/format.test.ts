import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatEth,
  formatRelativePast,
  isAddressLike,
  speakDuration,
  spellAddress,
  toIso,
  truncateAddress,
} from "./format";

describe("formatEth", () => {
  it("pads to a fixed width so decimal points line up in a column", () => {
    expect(formatEth(1_000_000_000_000_000_000n)).toBe("1.0000");
    expect(formatEth(2_500_000_000_000_000_000n)).toBe("2.5000");
  });

  it("says '<0.0001' rather than printing a lying 0.0000", () => {
    /* 1 wei is not zero, and rounding it to 0.0000 would misrepresent a bid. */
    expect(formatEth(1n)).toBe("<0.0001");
  });

  it("prints an exact zero as zero", () => {
    expect(formatEth(0n)).toBe("0.0000");
  });
});

describe("truncateAddress", () => {
  it("uses an ellipsis, keeping both ends recognisable", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("leaves a short string alone rather than mangling it", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });

  it("returns an empty string for empty input instead of throwing", () => {
    expect(truncateAddress("")).toBe("");
  });
});

describe("spellAddress", () => {
  it("spaces characters so a screen reader spells rather than mumbles", () => {
    expect(spellAddress("0xAb")).toBe("0 x A b");
  });
});

describe("formatCountdown", () => {
  it("shows only the units that matter at that range", () => {
    expect(formatCountdown(45)).toBe("00:45");
    expect(formatCountdown(90)).toBe("01:30");
    expect(formatCountdown(3_661)).toBe("01:01:01");
    expect(formatCountdown(90_061)).toBe("1d 01:01:01");
  });

  it("clamps at zero rather than showing a negative countdown", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-500)).toBe("00:00");
  });
});

describe("speakDuration", () => {
  it("produces words, never digit groups, for the live region", () => {
    expect(speakDuration(3_600)).toBe("1 hour remaining");
    expect(speakDuration(1)).toBe("1 second remaining");
    expect(speakDuration(120)).toBe("2 minutes remaining");
  });

  it("says 'ended' at zero", () => {
    expect(speakDuration(0)).toBe("ended");
  });

  it("drops seconds once hours are the headline, to stay short", () => {
    expect(speakDuration(3_725)).toBe("1 hour 2 minutes remaining");
  });
});

describe("formatRelativePast", () => {
  it("scales its unit with the age", () => {
    expect(formatRelativePast(1_000, 1_005)).toBe("just now");
    expect(formatRelativePast(1_000, 1_030)).toBe("30s ago");
    expect(formatRelativePast(1_000, 1_180)).toBe("3m ago");
    expect(formatRelativePast(1_000, 8_200)).toBe("2h ago");
  });
});

describe("toIso", () => {
  it("emits ISO 8601 UTC for the datetime attribute", () => {
    expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(toIso(1_700_000_000n)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("isAddressLike", () => {
  it("accepts a 20-byte hex address and rejects near-misses", () => {
    expect(isAddressLike("0x1234567890abcdef1234567890abcdef12345678")).toBe(true);
    expect(isAddressLike("0x1234")).toBe(false);
    expect(isAddressLike("1234567890abcdef1234567890abcdef12345678")).toBe(false);
    expect(isAddressLike("banana")).toBe(false);
  });
});
