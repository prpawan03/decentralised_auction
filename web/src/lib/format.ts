import { formatEther, type Address } from "viem";

/**
 * ETH for a dense column. Fixed decimals so the decimal points line up under
 * `font-variant-numeric: tabular-nums`; trailing zeros are kept on purpose.
 */
export function formatEth(wei: bigint, decimals = 4): string {
  const asNumber = Number(formatEther(wei));
  if (asNumber === 0) return (0).toFixed(decimals);
  /* Below the visible precision, say so rather than printing a lying 0.0000. */
  const smallest = 1 / 10 ** decimals;
  if (asNumber > 0 && asNumber < smallest) return `<${smallest.toFixed(decimals)}`;
  return asNumber.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Full precision, for the tooltip and the screen-reader label. */
export function formatEthExact(wei: bigint): string {
  return formatEther(wei);
}

/**
 * ENS-style truncation: 0x1234…cdef. Never truncate below this — 4 leading and
 * 4 trailing characters is the minimum that stays visually distinguishable.
 */
export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (!address) return "";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/**
 * The accessible name for a truncated address. Screen readers read
 * "0x1234…cdef" as gibberish; spacing the characters out makes it announce
 * as a sequence of characters instead of one nonsense word.
 */
export function spellAddress(address: string): string {
  return address.split("").join(" ");
}

const HHMMSS = (n: number) => n.toString().padStart(2, "0");

/**
 * A countdown, rendered at the granularity that matters at that range:
 *   > 1 day    2d 04:11:07
 *   > 1 hour      04:11:07
 *   otherwise        11:07
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${HHMMSS(hours)}:${HHMMSS(minutes)}:${HHMMSS(seconds)}`;
  if (hours > 0) return `${HHMMSS(hours)}:${HHMMSS(minutes)}:${HHMMSS(seconds)}`;
  return `${HHMMSS(minutes)}:${HHMMSS(seconds)}`;
}

/**
 * The same duration in words, for `aria-label` and the live region. A screen
 * reader must never be handed "04:11:07".
 */
export function speakDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "ended";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days) parts.push(plural(days, "day"));
  if (hours) parts.push(plural(hours, "hour"));
  if (minutes) parts.push(plural(minutes, "minute"));
  /* Seconds only matter once they are the headline. */
  if (!days && !hours && (seconds || !minutes)) parts.push(plural(seconds, "second"));
  return `${parts.join(" ")} remaining`;
}

/** A duration in seconds as an editable, human phrase: "1 h 30 min". */
export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  return parts.length > 0 ? parts.join(" ") : `${totalSeconds} s`;
}

/** ISO 8601 UTC, for `<time datetime>`. */
export function toIso(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

/** A readable absolute timestamp in the viewer's own zone. */
export function formatAbsolute(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "3 min ago" for the activity feed. */
export function formatRelativePast(unixSeconds: number, now: number): string {
  const delta = Math.max(0, now - unixSeconds);
  if (delta < 10) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

/** Gas fee estimate in ETH, at the precision a fee actually needs. */
export function formatFee(wei: bigint): string {
  const eth = Number(formatEther(wei));
  if (eth === 0) return "0 ETH";
  if (eth < 0.000001) return "<0.000001 ETH";
  return `${eth.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
}

export function isAddressLike(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
