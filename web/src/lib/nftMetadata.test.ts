import { describe, expect, it } from "vitest";
import {
  decodeDataUriJson,
  normaliseMetadata,
  placeholderHue,
  planTokenUri,
  resolveUri,
} from "./nftMetadata";

const GATEWAY = "https://gateway.test/ipfs/";

describe("resolveUri", () => {
  it("refuses every scheme that is not http, https or a renderable data URI", () => {
    /* A tokenURI is seller-controlled. These are the values that must never
       reach an href or a src, and dropping them is what keeps that true. */
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      /* Protocol-relative: inherits the page scheme and reads as a path. */
      "//evil.example/x.png",
    ]) {
      expect(resolveUri(hostile, GATEWAY)).toBeNull();
    }
  });

  it("rewrites ipfs:// onto the configured gateway, including the ipfs/ prefix form", () => {
    expect(resolveUri("ipfs://QmHash/1.json", GATEWAY)).toBe(`${GATEWAY}QmHash/1.json`);
    /* The malformed-but-widespread double prefix must not produce
       .../ipfs/ipfs/QmHash. */
    expect(resolveUri("ipfs://ipfs/QmHash", GATEWAY)).toBe(`${GATEWAY}QmHash`);
  });

  it("passes through http(s) and renderable data URIs untouched", () => {
    expect(resolveUri("https://example.test/a.png", GATEWAY)).toBe("https://example.test/a.png");
    expect(resolveUri("data:image/svg+xml;base64,PHN2Zz4=", GATEWAY)).toBe(
      "data:image/svg+xml;base64,PHN2Zz4=",
    );
  });

  it("returns null for non-strings, blanks and empty schemes", () => {
    expect(resolveUri(undefined, GATEWAY)).toBeNull();
    expect(resolveUri(42, GATEWAY)).toBeNull();
    expect(resolveUri("   ", GATEWAY)).toBeNull();
    expect(resolveUri("ipfs://", GATEWAY)).toBeNull();
  });
});

describe("decodeDataUriJson", () => {
  it("decodes both the base64 and the percent-encoded forms", () => {
    const json = '{"name":"On-chain"}';
    expect(decodeDataUriJson(`data:application/json;base64,${btoa(json)}`)).toEqual({
      name: "On-chain",
    });
    expect(decodeDataUriJson(`data:application/json,${encodeURIComponent(json)}`)).toEqual({
      name: "On-chain",
    });
  });

  it("returns null rather than throwing on malformed payloads", () => {
    /* Broken metadata is a normal outcome; the caller renders a placeholder. */
    expect(decodeDataUriJson("data:application/json;base64,!!!not-base64!!!")).toBeNull();
    expect(decodeDataUriJson("data:application/json,{oops")).toBeNull();
    expect(decodeDataUriJson("nonsense")).toBeNull();
  });
});

describe("normaliseMetadata", () => {
  it("accepts every image field name collections actually use", () => {
    for (const key of ["image", "image_url", "imageUrl", "image_data"]) {
      const meta = normaliseMetadata({ [key]: "ipfs://QmArt" }, GATEWAY);
      expect(meta.image).toBe(`${GATEWAY}QmArt`);
    }
  });

  it("drops an image whose URI is not renderable", () => {
    expect(normaliseMetadata({ image: "javascript:alert(1)" }, GATEWAY).image).toBeUndefined();
  });

  it("clamps a hostile name instead of letting it break the layout", () => {
    const meta = normaliseMetadata({ name: "x".repeat(5_000) }, GATEWAY);
    expect(meta.name).toBeDefined();
    expect(meta.name!.length).toBeLessThanOrEqual(121); // 120 + the ellipsis
  });

  it("keeps well-formed traits, drops valueless ones, and caps the total", () => {
    const meta = normaliseMetadata(
      {
        attributes: [
          { trait_type: "Colour", value: "Blue" },
          /* No value: a row that would render an empty cell. */
          { trait_type: "Ghost" },
          "not an object",
          ...Array.from({ length: 50 }, (_, i) => ({ trait_type: `T${String(i)}`, value: i })),
        ],
      },
      GATEWAY,
    );
    expect(meta.attributes[0]).toEqual({ trait: "Colour", value: "Blue" });
    expect(meta.attributes.some((a) => a.trait === "Ghost")).toBe(false);
    expect(meta.attributes.length).toBeLessThanOrEqual(24);
  });

  it("survives every non-object a gateway might serve", () => {
    for (const junk of [null, undefined, "a string", 7, []]) {
      expect(normaliseMetadata(junk, GATEWAY).attributes).toEqual([]);
    }
  });
});

describe("planTokenUri", () => {
  it("treats a plain image URL as the artwork, which is what DemoNFT mints", () => {
    /* DemoNFT.mint documents its uri as "the metadata URI, or a plain image
       URL for the demo". Fetching that as JSON would fail for every seeded
       listing. */
    const plan = planTokenUri("https://example.test/cat.png", GATEWAY);
    expect(plan).toEqual({
      kind: "image",
      metadata: { image: "https://example.test/cat.png", attributes: [] },
    });
  });

  it("reads inline metadata without planning a network call", () => {
    const uri = `data:application/json;base64,${btoa('{"name":"Inline","image":"ipfs://QmX"}')}`;
    const plan = planTokenUri(uri, GATEWAY);
    expect(plan.kind).toBe("inline");
    expect(plan.kind === "inline" && plan.metadata.image).toBe(`${GATEWAY}QmX`);
  });

  it("plans a fetch for a URI with no image extension", () => {
    expect(planTokenUri("ipfs://QmMeta/7", GATEWAY)).toEqual({
      kind: "remote",
      url: `${GATEWAY}QmMeta/7`,
    });
  });

  it("plans nothing for an unusable URI", () => {
    expect(planTokenUri("", GATEWAY)).toEqual({ kind: "none" });
    expect(planTokenUri("javascript:alert(1)", GATEWAY)).toEqual({ kind: "none" });
  });
});

describe("placeholderHue", () => {
  it("is stable per token and case-insensitive in the address", () => {
    /* The same lot must not change colour between the grid and the detail
       page, or between renders where the address casing differs. */
    const lower = placeholderHue("0xabc", 4n);
    expect(placeholderHue("0xABC", 4n)).toBe(lower);
    expect(placeholderHue("0xabc", 4n)).toBe(lower);
  });

  it("stays inside the hue circle", () => {
    for (let i = 0n; i < 50n; i += 1n) {
      const hue = placeholderHue("0xdeadbeef", i);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
