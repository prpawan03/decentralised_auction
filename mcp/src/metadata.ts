/**
 * Decoding ERC-721 `tokenURI` values into readable metadata.
 *
 * The demo collection returns tokens in two very different shapes, and both must
 * work:
 *
 *   - `data:application/json;base64,<...>`  -- the common on-chain form.
 *   - `data:application/json;utf8,{...}`    -- what DemoNFT.contractURI() and
 *     the OnChainArt renderer emit. Note `;utf8,` is NOT part of RFC 2397 (the
 *     standard spelling is `;charset=utf-8`), but it is widespread in on-chain
 *     NFT contracts and this project's own art library uses it. A decoder that
 *     only handles `;base64,` returns nothing useful for this collection, so
 *     both spellings are handled explicitly.
 *
 * `ipfs://` is REWRITTEN to a gateway URL but deliberately NOT fetched. Fetching
 * it would mean this local-only server making outbound requests to the public
 * internet on behalf of an agent, which is both a privacy leak and a way to smuggle
 * attacker-controlled text into the model's context from a URI a seller chose.
 * The agent gets the resolved URL and can decide for itself.
 */

/** The gateway used to render `ipfs://` as something a human can click. */
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

export interface DecodedMetadata {
  /** The raw string the contract returned, always included for transparency. */
  tokenURI: string;
  /** How the URI was handled. */
  kind: "inline-json" | "http" | "ipfs" | "empty" | "opaque";
  /** Parsed JSON, when the URI carried its metadata inline and it parsed. */
  metadata?: unknown;
  /** For ipfs:, the gateway URL. For http(s):, the URI itself. Not fetched. */
  url?: string;
  /** Set when the URI looked inline but could not be decoded or parsed. */
  note?: string;
}

/**
 * Decodes a tokenURI as far as is possible without a network request.
 *
 * Never throws: a malformed URI from an untrusted seller-controlled contract
 * should degrade into a `note`, not take down the tool call.
 */
export function decodeTokenUri(tokenURI: string): DecodedMetadata {
  const uri = tokenURI.trim();

  if (uri === "") {
    return { tokenURI, kind: "empty", note: "The contract returned an empty tokenURI." };
  }

  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma === -1) {
      return { tokenURI, kind: "opaque", note: "Malformed data: URI (no comma separator)." };
    }

    const header = uri.slice(5, comma).toLowerCase();
    const body = uri.slice(comma + 1);

    let text: string;
    try {
      if (header.includes(";base64")) {
        text = Buffer.from(body, "base64").toString("utf8");
      } else {
        // Covers `;utf8`, `;charset=utf-8` and a bare `data:application/json,`.
        // decodeURIComponent because a percent-encoded body is legal here and
        // JSON braces/quotes are frequently escaped that way.
        try {
          text = decodeURIComponent(body);
        } catch {
          // Not percent-encoded (a stray literal % breaks decodeURIComponent).
          // The raw body is still the intended payload, so fall back to it.
          text = body;
        }
      }
    } catch (cause) {
      return {
        tokenURI,
        kind: "opaque",
        note: `Could not decode the data: URI body: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      };
    }

    // Only attempt JSON when the header claims JSON or the body looks like it.
    // An SVG data URI is a legitimate tokenURI too and should not be reported
    // as a parse failure.
    const looksJson = header.includes("json") || text.trimStart().startsWith("{");
    if (!looksJson) {
      return {
        tokenURI,
        kind: "opaque",
        note: `Inline data of type "${header || "text/plain"}" that is not JSON metadata.`,
      };
    }

    try {
      return { tokenURI, kind: "inline-json", metadata: JSON.parse(text) };
    } catch {
      return { tokenURI, kind: "opaque", note: "Inline data claimed to be JSON but did not parse." };
    }
  }

  if (uri.startsWith("ipfs://")) {
    // Strip an optional `ipfs/` prefix so both `ipfs://CID` and the
    // `ipfs://ipfs/CID` variant resolve to the same gateway path.
    const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return {
      tokenURI,
      kind: "ipfs",
      url: `${IPFS_GATEWAY}${path}`,
      note: "Not fetched. This server does not make outbound requests for seller-supplied URIs.",
    };
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return {
      tokenURI,
      kind: "http",
      url: uri,
      note: "Not fetched. This server does not make outbound requests for seller-supplied URIs.",
    };
  }

  return { tokenURI, kind: "opaque", note: "Unrecognised URI scheme." };
}
