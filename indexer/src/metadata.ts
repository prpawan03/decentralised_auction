// ---------------------------------------------------------------------------
// Token metadata resolution.
//
// WHY THE INDEXER DOES NOT FETCH REMOTE URIs.
//
// It would be easy to `fetch()` an ipfs:// or https:// token URI here, and it
// would be wrong. Indexing MUST be deterministic and replayable: Ponder can
// reorg back and reprocess a block, and two runs over the same chain must
// produce the same rows. A gateway that is slow today and gone tomorrow makes
// that false. It also turns a container with an RPC connection into one that
// makes arbitrary outbound requests to addresses chosen by whoever minted the
// token -- an SSRF primitive handed over for the sake of a thumbnail.
//
// So: `data:` URIs are decoded here, because they are part of the chain state
// and decoding them is a pure function. Anything else is recorded verbatim in
// `tokenURI` with `metadataStatus = "remote"`, and the CLIENT fetches it, in
// a browser, where a dead gateway costs one broken image rather than a stalled
// indexer. `contracts/src/art/OnChainArt.sol` exists precisely so the demo
// data takes the `data:` path.
// ---------------------------------------------------------------------------

/** What `resolveMetadata` managed to do with a token URI. */
export type Metadata = {
  name: string | null;
  description: string | null;
  image: string | null;
  /**
   * - `"decoded"`   the URI was a `data:` URI and its JSON parsed.
   * - `"remote"`    the URI points off-chain; see the note above.
   * - `"empty"`     the token has no URI at all.
   * - `"malformed"` the URI looked like a `data:` URI but did not decode.
   */
  status: "decoded" | "remote" | "empty" | "malformed";
};

const EMPTY: Metadata = { name: null, description: null, image: null, status: "empty" };

/**
 * Turns a token URI into the three fields a gallery needs.
 *
 * This function never throws and never performs I/O. A malformed URI is a
 * normal outcome on a chain anyone can mint on, so it is reported in `status`
 * rather than raised: one unreadable token MUST NOT stop the indexing run.
 */
export function resolveMetadata(tokenURI: string): Metadata {
  const uri = tokenURI.trim();
  if (uri === "") return EMPTY;

  if (!uri.startsWith("data:")) {
    return { name: null, description: null, image: null, status: "remote" };
  }

  const comma = uri.indexOf(",");
  if (comma === -1) {
    return { name: null, description: null, image: null, status: "malformed" };
  }

  // `data:[<mediatype>][;base64],<data>` -- the media type is frequently
  // omitted or wrong in practice, so the encoding flag is what is read here,
  // not the declared type.
  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);

  try {
    const json = header.includes(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : // A non-base64 data URI is percent-encoded. `decodeURIComponent`
        // throws on a stray `%`, which the catch below turns into "malformed".
        decodeURIComponent(payload);

    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return { name: null, description: null, image: null, status: "malformed" };
    }

    const record = parsed as Record<string, unknown>;
    return {
      name: asString(record.name),
      description: asString(record.description),
      image: asString(record.image),
      status: "decoded",
    };
  } catch {
    return { name: null, description: null, image: null, status: "malformed" };
  }
}

/** Accepts a value only if it is genuinely a string. Metadata is untrusted. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
