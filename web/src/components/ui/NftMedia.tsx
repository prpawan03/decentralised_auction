import { useEffect, useState } from "react";
import { fallbackName, placeholderHue } from "@/lib/nftMetadata";
import { cn } from "@/lib/cn";

/**
 * Token artwork, with a placeholder that is never worse than the real thing.
 *
 * Three states, and all three occupy the same box so nothing reflows when the
 * image arrives: loading, loaded, and unavailable. "Unavailable" is the common
 * case, not an edge case — a token may have no metadata extension, the gateway
 * may be down, or the seller may have listed something with no artwork at all
 * — so the placeholder is a designed state, not an error badge. It carries the
 * token id and a hue derived from the contract and id, which makes a grid of
 * artless listings still scannable.
 *
 * The image is always `loading="lazy"` and `decoding="async"`. A board of a
 * hundred auctions must not fetch a hundred images to paint the first row.
 *
 * ACCESSIBILITY: pass `alt=""` wherever the artwork sits beside a text label
 * that already names the token. Announcing "Token #3" twice is worse than not
 * announcing the image at all.
 */

export type NftMediaSize = "thumb" | "card" | "hero";

const SIZES: Record<NftMediaSize, string> = {
  thumb: "h-9 w-9 rounded-[3px]",
  card: "h-24 w-24 rounded-[4px]",
  hero: "aspect-square w-full rounded-[6px]",
};

const LABEL_SIZES: Record<NftMediaSize, string> = {
  thumb: "text-[0.5rem]",
  card: "text-[0.6875rem]",
  hero: "text-[0.9375rem]",
};

export interface NftMediaProps {
  /** Resolved image URL, or undefined when there is none. */
  src?: string | undefined;
  /** The collection address — part of the placeholder's stable hue. */
  nft: string;
  tokenId: bigint;
  /** True while the metadata lookup is still in flight. */
  isLoading?: boolean;
  size?: NftMediaSize;
  /** Empty string when adjacent text already names the token. */
  alt: string;
  className?: string | undefined;
}

export function NftMedia({
  src,
  nft,
  tokenId,
  isLoading = false,
  size = "thumb",
  alt,
  className,
}: NftMediaProps) {
  /* A URL that 404s or serves a broken payload is indistinguishable from one
     that was never there, so a load failure collapses into the same state. */
  const [failed, setFailed] = useState(false);

  /* Reset when the token changes: this component is reused across rows as a
     virtualised or re-sorted list re-keys, and a stale failure flag would
     blank out artwork that loads perfectly well. */
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const box = cn(
    "relative shrink-0 overflow-hidden border border-[var(--color-line)] bg-[var(--color-raised)]",
    SIZES[size],
    className,
  );

  if (isLoading && src === undefined) {
    return (
      <div
        className={cn(box, "animate-pulse")}
        /* Decorative while it is still a rectangle. The surrounding row
           already announces which auction is loading. */
        aria-hidden="true"
      />
    );
  }

  if (src !== undefined && !failed) {
    return (
      <div className={box}>
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          /* object-cover: token art is any aspect ratio, and letterboxing a
             hundred thumbnails makes the grid look broken. */
          className="h-full w-full object-cover"
          /* Metadata is third-party. Do not leak which auction a viewer is
             looking at back to the gateway operator as a referrer. */
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  const hue = placeholderHue(nft, tokenId);
  return (
    <div
      className={cn(box, "flex items-center justify-center")}
      style={{
        /* Low chroma so the placeholder reads as a slot, not as artwork
           competing with the real images beside it. */
        background: `linear-gradient(135deg, hsl(${String(hue)} 40% 30% / 0.45), hsl(${String((hue + 40) % 360)} 40% 18% / 0.45))`,
      }}
      title={fallbackName(tokenId)}
      role={alt === "" ? "presentation" : "img"}
      aria-label={alt === "" ? undefined : `${alt} — no artwork available`}
    >
      <span
        aria-hidden="true"
        className={cn("tnum font-semibold text-[var(--color-ink-2)]", LABEL_SIZES[size])}
      >
        #{tokenId.toString()}
      </span>
    </div>
  );
}
