import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { copyText } from "@/lib/clipboard";
import { spellAddress, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * A truncated address you can actually copy.
 *
 * - The visible "0x1234…cdef" is aria-hidden; the button's accessible name
 *   spells the address out character by character, because a screen reader
 *   otherwise reads the truncation as one unpronounceable word.
 * - The copy result is ANNOUNCED, not assumed. `copyText` returns false over
 *   plain http when both paths fail, and the user is told so instead of
 *   being shown a checkmark for a copy that did not happen.
 * - The status message lives in a polite live region that only changes when
 *   the result changes.
 */

export interface AddressChipProps {
  address: Address;
  /** Marks this as the connected account. */
  you?: boolean;
  /** Links to /u/:address. */
  linked?: boolean;
  label?: string;
  className?: string;
  lead?: number;
  tail?: number;
}

export function AddressChip({
  address,
  you = false,
  linked = true,
  label,
  className,
  lead = 6,
  tail = 4,
}: AddressChipProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const onCopy = async () => {
    const ok = await copyText(address);
    setStatus(ok ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 4000);
  };

  const short = truncateAddress(address, lead, tail);
  const accessibleAddress = spellAddress(address);

  const text = (
    <span aria-hidden="true" className="tnum">
      {short}
    </span>
  );

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {linked ? (
        <Link
          to={`/u/${address}`}
          className="tap rounded-[2px] text-[var(--color-action)] no-underline hover:underline"
        >
          {text}
          <span className="sr-only">
            {label ? `${label}, ` : ""}account {accessibleAddress}
          </span>
        </Link>
      ) : (
        <span className="text-[var(--color-ink-2)]">
          {text}
          <span className="sr-only">
            {label ? `${label}, ` : ""}account {accessibleAddress}
          </span>
        </span>
      )}

      {you ? (
        <span className="rounded-[2px] border border-[var(--color-line-strong)] px-1 text-[0.625rem] font-semibold tracking-wide text-[var(--color-ink-2)] uppercase">
          you
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => void onCopy()}
        className={cn(
          "tap flex h-6 w-6 items-center justify-center rounded-[2px]",
          "border border-transparent text-[var(--color-ink-3)]",
          "hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
        )}
      >
        <span aria-hidden="true" className="text-[0.75rem] leading-none">
          ⧉
        </span>
        <span className="sr-only">Copy address {accessibleAddress}</span>
      </button>

      {/* Result of the last copy. Silent while idle. */}
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Address copied to clipboard" : ""}
        {status === "failed" ? "Could not copy. Select the address and copy it manually." : ""}
      </span>

      {/* The sighted equivalent of the same message. */}
      {status !== "idle" ? (
        <span
          aria-hidden="true"
          className={cn(
            "text-[0.6875rem]",
            status === "copied" ? "text-[var(--color-live)]" : "text-[var(--color-danger)]",
          )}
        >
          {status === "copied" ? "copied" : "copy failed"}
        </span>
      ) : null}
    </span>
  );
}
