/**
 * ERC-721 metadata, parsed defensively.
 *
 * A `tokenURI` is attacker-controlled data. Any seller can list a token whose
 * metadata points anywhere and says anything, so every value that reaches the
 * DOM passes through here first. Three rules hold throughout:
 *
 *   1. Only `https:`, `http:` and `data:` survive {@link resolveUri}. A
 *      `javascript:` or `file:` URL is dropped, not sanitised — there is no
 *      legitimate reason for one to appear in token metadata, and a dropped
 *      image renders a placeholder instead of running.
 *   2. Strings are clamped in length before display. A 2 MB "name" is a denial
 *      of service against the layout, not a name.
 *   3. Nothing here is ever rendered as HTML. Values become text nodes and
 *      `src` attributes, never markup.
 *
 * Everything in this file is pure, so it is unit-testable without a network.
 */

/** Trait rows, as shown on the detail page. */
export interface NftAttribute {
  trait: string;
  value: string;
}

export interface NftMetadata {
  name?: string;
  description?: string;
  /** Resolved to a directly loadable `http(s):` or `data:` URL. */
  image?: string;
  attributes: NftAttribute[];
}

/** The default public gateway. Overridable through runtime config. */
export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/** Longest description we will show. Beyond this the value is truncated. */
const MAX_TEXT = 500;
const MAX_NAME = 120;
/** Traits past this point are dropped: no real collection needs more. */
const MAX_ATTRIBUTES = 24;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;

/**
 * Turns any metadata URI into something an `<img src>` can load, or `null`.
 *
 * `ipfs://` and `ar://` are rewritten onto a gateway. `data:` passes through
 * only for image and JSON payloads. Every other scheme — including the
 * protocol-relative `//host/path` form, which inherits the page's scheme and
 * is a common obfuscation — is refused.
 */
export function resolveUri(uri: unknown, gateway = DEFAULT_IPFS_GATEWAY): string | null {
  if (typeof uri !== "string") return null;
  const raw = uri.trim();
  if (raw === "") return null;

  /* Protocol-relative. Refused rather than upgraded: metadata should carry an
     explicit scheme, and inventing one for it is guesswork. */
  if (raw.startsWith("//")) return null;

  if (raw.startsWith("ipfs://")) {
    /* Both `ipfs://CID/path` and the malformed-but-common `ipfs://ipfs/CID`. */
    const path = raw.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path === "" ? null : gateway + path;
  }

  if (raw.startsWith("ar://")) {
    const path = raw.slice("ar://".length);
    return path === "" ? null : "https://arweave.net/" + path;
  }

  if (raw.startsWith("data:")) {
    /* Only payloads we actually render. A `data:text/html` would be inert in
       an <img>, but refusing it keeps the invariant simple to state. */
    return /^data:(image\/|application\/json|text\/plain)/i.test(raw) ? raw : null;
  }

  if (/^https?:\/\//i.test(raw)) return raw;

  /* A bare CID, which some contracts store unprefixed. */
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})(\/.*)?$/.test(raw)) {
    return gateway + raw;
  }

  return null;
}

/** Clamp and flatten a value that will become a text node. */
function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return undefined;
  const s = String(value).trim();
  if (s === "") return undefined;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Decodes a `data:` URI carrying JSON. Handles both the base64 form and the
 * percent-encoded form; on-chain generative collections use either.
 */
export function decodeDataUriJson(uri: string): unknown {
  const comma = uri.indexOf(",");
  if (comma === -1) return null;
  const header = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    const json = header.includes(";base64") ? atob(body) : decodeURIComponent(body);
    return JSON.parse(json) as unknown;
  } catch {
    /* Malformed metadata is a normal outcome, not an exception worth throwing:
       the caller renders a placeholder. */
    return null;
  }
}

/**
 * Reshapes whatever JSON a collection happens to serve into {@link NftMetadata}.
 *
 * The ERC-721 metadata schema is a suggestion in practice. `image`,
 * `image_url` and `image_data` all appear in the wild, so all three are read.
 */
export function normaliseMetadata(json: unknown, gateway = DEFAULT_IPFS_GATEWAY): NftMetadata {
  if (typeof json !== "object" || json === null) return { attributes: [] };
  const o = json as Record<string, unknown>;

  const imageField = o.image ?? o.image_url ?? o.imageUrl ?? o.image_data;
  const image = resolveUri(imageField, gateway);

  const attributes: NftAttribute[] = [];
  const rawAttrs = Array.isArray(o.attributes) ? o.attributes : [];
  for (const entry of rawAttrs) {
    if (attributes.length >= MAX_ATTRIBUTES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as Record<string, unknown>;
    const trait = text(a.trait_type ?? a.traitType ?? a.trait, 60);
    const value = text(a.value, 80);
    /* A trait with no value tells the reader nothing; drop it rather than
       render an empty row. */
    if (value === undefined) continue;
    attributes.push({ trait: trait ?? "Trait", value });
  }

  const name = text(o.name, MAX_NAME);
  const description = text(o.description);

  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(image !== null ? { image } : {}),
    attributes,
  };
}

/** What a `tokenURI` turned out to be. */
export type TokenUriPlan =
  /** The metadata was inline in a `data:` URI; no network call is needed. */
  | { kind: "inline"; metadata: NftMetadata }
  /** The URI is the image itself. DemoNFT mints these. */
  | { kind: "image"; metadata: NftMetadata }
  /** JSON has to be fetched from `url`. */
  | { kind: "remote"; url: string }
  /** Unusable — render the placeholder. */
  | { kind: "none" };

/**
 * Decides what to do with a `tokenURI` without touching the network.
 *
 * The image case matters: `DemoNFT.mint` documents its `uri` as "the metadata
 * URI, or a plain image URL for the demo", and the seed script uses the
 * latter. Treating an image URL as JSON would fail to parse and would show a
 * placeholder for every demo listing.
 */
export function planTokenUri(tokenUri: unknown, gateway = DEFAULT_IPFS_GATEWAY): TokenUriPlan {
  const resolved = resolveUri(tokenUri, gateway);
  if (resolved === null) return { kind: "none" };

  if (resolved.startsWith("data:image/")) {
    return { kind: "image", metadata: { image: resolved, attributes: [] } };
  }

  if (resolved.startsWith("data:")) {
    const json = decodeDataUriJson(resolved);
    return json === null
      ? { kind: "none" }
      : { kind: "inline", metadata: normaliseMetadata(json, gateway) };
  }

  if (IMAGE_EXTENSIONS.test(resolved)) {
    return { kind: "image", metadata: { image: resolved, attributes: [] } };
  }

  return { kind: "remote", url: resolved };
}

/**
 * The label shown when a token has no metadata name — never a blank cell.
 * Deterministic, so the same token reads the same everywhere in the app.
 */
export function fallbackName(tokenId: bigint): string {
  return `Token #${tokenId.toString()}`;
}

/**
 * A stable hue for a token, used by the placeholder tile so a listing with no
 * artwork is still visually distinguishable from its neighbours in a grid.
 */
export function placeholderHue(nft: string, tokenId: bigint): number {
  const key = `${nft.toLowerCase()}:${tokenId.toString()}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    /* djb2, truncated to 32 bits. Any cheap avalanche would do; this one is
       short enough to read and stable across engines. */
    hash = (hash * 33 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
