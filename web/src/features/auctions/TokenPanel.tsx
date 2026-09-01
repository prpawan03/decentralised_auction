import type { Address } from "viem";
import { NftMedia } from "@/components/ui/NftMedia";
import { useNftMetadata } from "@/hooks/useNftMetadata";
import { fallbackName } from "@/lib/nftMetadata";
import { config } from "@/config/runtime";

/**
 * What is actually being sold.
 *
 * The old detail page described the lot as "Token #4" and a hex address, which
 * tells a bidder nothing about what they are bidding on. This panel is the
 * answer: artwork, name, description and traits, read from `tokenURI`.
 *
 * It is explicitly SECONDARY information. The metadata lives off chain, at a
 * URL the seller chose, and it can be changed or withdrawn after the listing
 * opens — so the panel says where it came from, and nothing here is ever used
 * to decide what a bid does. The contract's own fields (price, deadline,
 * status) are the terms of the sale; this is the picture on the box.
 */
export function TokenPanel({ nft, tokenId }: { nft: Address; tokenId: bigint }) {
  const art = useNftMetadata(nft, tokenId);
  const title = art.name ?? fallbackName(tokenId);

  return (
    <section aria-labelledby="token-heading" className="panel min-w-0 self-start">
      <header className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 id="token-heading" className="text-sm font-semibold text-[var(--color-ink)]">
          The item
        </h2>
      </header>

      <div className="px-4 py-4">
        {/* A real alt here, unlike the grid thumbnails: this image is the
            primary depiction of the lot and has no adjacent duplicate label. */}
        <NftMedia
          src={art.image}
          nft={nft}
          tokenId={tokenId}
          isLoading={art.isLoading}
          size="hero"
          alt={title}
        />

        <h3 className="mt-3 text-[0.9375rem] font-semibold text-[var(--color-ink)]">{title}</h3>
        {art.collection !== undefined ? (
          <p className="mt-0.5 text-[0.75rem] text-[var(--color-ink-3)]">{art.collection}</p>
        ) : null}

        {art.description !== undefined ? (
          <p className="mt-2.5 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--color-ink-2)]">
            {art.description}
          </p>
        ) : null}

        {art.attributes.length > 0 ? (
          <>
            <h4 className="col-head mt-4">Traits</h4>
            {/* A definition list, because that is exactly what a trait sheet
                is: each term paired with its value. */}
            <dl className="mt-2 grid grid-cols-2 gap-2">
              {art.attributes.map((attr) => (
                <div
                  key={`${attr.trait}:${attr.value}`}
                  className="rounded-[3px] border border-[var(--color-line)] px-2.5 py-1.5"
                >
                  <dt className="truncate text-[0.625rem] tracking-wide text-[var(--color-ink-3)] uppercase">
                    {attr.trait}
                  </dt>
                  <dd className="truncate text-[0.8125rem] text-[var(--color-ink)]">{attr.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        {!art.isLoading && art.image === undefined ? (
          <p className="mt-3 max-w-prose text-[0.75rem] leading-relaxed text-[var(--color-ink-3)]">
            This token serves no artwork the app could load. That is not a fault in the auction —
            the contract holds the token in escrow either way, and every figure above comes from
            contract storage.
          </p>
        ) : null}

        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--color-ink-3)]">
          {/* Naming the gateway is a privacy disclosure, not trivia: loading
              artwork tells that third party which lots this browser viewed. */}
          Artwork and traits are fetched from the token's own metadata URI, through{" "}
          <span className="tnum break-all">{config.ipfsGateway}</span> for IPFS content. Metadata is
          off-chain and can change; the sale terms above cannot.
        </p>
      </div>
    </section>
  );
}
