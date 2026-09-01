import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { config } from "@/config/runtime";
import { localChain } from "@/config/chain";
import {
  normaliseMetadata,
  planTokenUri,
  type NftMetadata,
  type TokenUriPlan,
} from "@/lib/nftMetadata";

/**
 * Token artwork and traits, for the grid and the detail page.
 *
 * Two stages, because they have completely different failure modes:
 *
 *   1. `tokenURI(tokenId)` for every visible token, folded into ONE multicall.
 *      This is a chain read: fast, local, and either it works or the whole
 *      node is down.
 *   2. For the URIs that turn out to point somewhere, a plain HTTP fetch of
 *      the JSON. This one talks to a public gateway that may be slow, rate
 *      limited, or serving something hostile.
 *
 * Stage 2 is allowed to fail without consequence. Metadata is decoration: an
 * auction with no artwork still shows its price, its countdown and its Bid
 * button. Nothing in the bidding path ever waits on a gateway.
 *
 * A `tokenURI` that reverts is normal, not exceptional — plenty of ERC-721s
 * do not implement the metadata extension at all — so `allowFailure` is on and
 * a reverting call simply yields no artwork.
 */

/** Minimal ERC-721 metadata surface. Arbitrary collections, not just DemoNFT. */
const erc721MetadataAbi = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** What the UI needs to render one token. */
export interface NftView extends NftMetadata {
  /** True while either stage is still in flight. */
  isLoading: boolean;
  /** The collection name from `name()`, when the contract has one. */
  collection?: string;
}

const EMPTY: NftView = { attributes: [], isLoading: false };

export interface NftRef {
  nft: Address;
  tokenId: bigint;
}

/** The cache key. Lowercased, because addresses arrive in mixed case. */
export function nftKey(nft: string, tokenId: bigint): string {
  return `${nft.toLowerCase()}:${tokenId.toString()}`;
}

/** Longest metadata document we will read. Past this the token gets a placeholder. */
const MAX_METADATA_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Fetches and parses one metadata document.
 *
 * Hard-capped in both time and size. A gateway that streams forever, or serves
 * a 200 MB "description", must not be able to wedge the tab — and it is a
 * third party we have no reason to trust with unbounded resources.
 */
async function fetchMetadata(url: string, signal: AbortSignal): Promise<NftMetadata> {
  /* AbortSignal.any lets react-query's own cancellation and our timeout both
     apply. Where it is missing we still get react-query's signal. */
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined =
    typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;

  const response = await fetch(url, { signal: combined, redirect: "follow" });
  if (!response.ok) throw new Error(`Metadata request failed: ${String(response.status)}`);

  const type = response.headers.get("content-type") ?? "";
  /* Some collections point `tokenURI` straight at the artwork with no
     extension in the path. The content type is the only way to know. */
  if (type.startsWith("image/")) return { image: url, attributes: [] };

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_METADATA_BYTES) throw new Error("Metadata document too large");

  const body = await response.text();
  /* content-length is a hint, not a guarantee; check what actually arrived. */
  if (body.length > MAX_METADATA_BYTES) throw new Error("Metadata document too large");

  return normaliseMetadata(JSON.parse(body), config.ipfsGateway);
}

/**
 * Metadata for a batch of tokens, keyed by {@link nftKey}.
 *
 * Callers pass every token on screen at once so both stages batch. Passing an
 * empty array is valid and does no work, which is what a loading or errored
 * auction list wants.
 */
export function useNftMetadataMany(refs: readonly NftRef[]): Map<string, NftView> {
  /* Deduplicate first: the same token can legitimately appear twice (a relist
     after a cancel), and one read per screen slot would be wasteful. */
  const unique = useMemo(() => {
    const seen = new Map<string, NftRef>();
    for (const ref of refs) {
      const key = nftKey(ref.nft, ref.tokenId);
      if (!seen.has(key)) seen.set(key, ref);
    }
    return [...seen.values()];
  }, [refs]);

  /* Distinct collections, for the one `name()` call each deserves. */
  const collections = useMemo(() => {
    const set = new Set<string>();
    for (const ref of unique) set.add(ref.nft.toLowerCase());
    return [...set] as Address[];
  }, [unique]);

  const uriReads = useReadContracts({
    allowFailure: true,
    contracts: [
      ...unique.map((ref) => ({
        address: ref.nft,
        abi: erc721MetadataAbi,
        chainId: localChain.id,
        functionName: "tokenURI" as const,
        args: [ref.tokenId] as const,
      })),
      ...collections.map((address) => ({
        address,
        abi: erc721MetadataAbi,
        chainId: localChain.id,
        functionName: "name" as const,
        args: [] as const,
      })),
    ],
    query: {
      enabled: unique.length > 0,
      /* A tokenURI is immutable for almost every collection. Re-reading it on
         every focus would be pure noise. */
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  });

  /* The two request groups share one array; split it back apart by offset. */
  const uriResults = uriReads.data?.slice(0, unique.length);
  const nameResults = uriReads.data?.slice(unique.length);

  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    collections.forEach((address, i) => {
      const result = nameResults?.[i];
      if (result?.status === "success" && typeof result.result === "string") {
        map.set(address.toLowerCase(), result.result);
      }
    });
    return map;
  }, [collections, nameResults]);

  /* Stage 1 output: what each token's URI turned out to be. */
  const plans = useMemo(() => {
    return unique.map((ref, i) => {
      const result = uriResults?.[i];
      const uri = result?.status === "success" ? result.result : undefined;
      return { ref, key: nftKey(ref.nft, ref.tokenId), plan: planTokenUri(uri, config.ipfsGateway) };
    });
  }, [unique, uriResults]);

  /* Stage 2: only the ones that need the network. `useQueries` gives each its
     own cache entry, so two auctions sharing a metadata document share one
     request, and one slow gateway never blocks the others. */
  const remote = useMemo(() => plans.filter((p) => p.plan.kind === "remote"), [plans]);

  const fetches = useQueries({
    queries: remote.map((p) => {
      const url = (p.plan as Extract<TokenUriPlan, { kind: "remote" }>).url;
      return {
        queryKey: ["nft-metadata", url] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchMetadata(url, signal),
        staleTime: 10 * 60_000,
        gcTime: 60 * 60_000,
        /* One retry, then give up and show the placeholder. A gateway that
           failed twice is not going to succeed on the fifth attempt, and the
           user is looking at an auction, not at artwork. */
        retry: 1,
        refetchOnWindowFocus: false,
      };
    }),
  });

  return useMemo(() => {
    const byUrl = new Map<string, (typeof fetches)[number]>();
    remote.forEach((p, i) => {
      const entry = fetches[i];
      if (entry) byUrl.set((p.plan as Extract<TokenUriPlan, { kind: "remote" }>).url, entry);
    });

    const out = new Map<string, NftView>();
    for (const { ref, key, plan } of plans) {
      const collection = collectionNames.get(ref.nft.toLowerCase());
      const withCollection = (view: NftView): NftView =>
        collection !== undefined ? { ...view, collection } : view;

      if (plan.kind === "inline" || plan.kind === "image") {
        out.set(key, withCollection({ ...plan.metadata, isLoading: false }));
        continue;
      }
      if (plan.kind === "none") {
        /* No usable URI. Still loading if stage 1 has not answered yet —
           otherwise this token genuinely has no metadata. */
        out.set(key, withCollection({ ...EMPTY, isLoading: uriReads.isLoading }));
        continue;
      }
      const entry = byUrl.get(plan.url);
      out.set(
        key,
        withCollection({
          ...(entry?.data ?? EMPTY),
          attributes: entry?.data?.attributes ?? [],
          isLoading: entry?.isLoading ?? true,
        }),
      );
    }
    return out;
  }, [plans, remote, fetches, collectionNames, uriReads.isLoading]);
}

/** The single-token case. Same machinery, one entry. */
export function useNftMetadata(nft: Address | undefined, tokenId: bigint | undefined): NftView {
  const refs = useMemo<NftRef[]>(
    () => (nft && tokenId !== undefined ? [{ nft, tokenId }] : []),
    [nft, tokenId],
  );
  const map = useNftMetadataMany(refs);
  if (!nft || tokenId === undefined) return EMPTY;
  return map.get(nftKey(nft, tokenId)) ?? EMPTY;
}
