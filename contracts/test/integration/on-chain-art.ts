import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

/**
 * The generative token renders entirely on chain.
 *
 * WHY THESE ASSERTIONS ARE STRICT ABOUT `data:`
 * The production shape serves `img-src 'self' data: blob:`
 * (docker/nginx/default.conf). A token whose image is an `https:` URL renders
 * a placeholder behind nginx while looking perfectly fine under the Vite
 * development server, which sets no policy. That difference is invisible until
 * someone demonstrates the production build, so the scheme is asserted here
 * rather than left to a reviewer to notice.
 */
const { viem } = await network.create();

/** Decodes a `data:...;base64,` payload. Throws when the prefix is wrong. */
function decodeBase64DataUri(uri: string, expectedMime: string): string {
  const prefix = `data:${expectedMime};base64,`;
  assert.ok(uri.startsWith(prefix), `expected a ${prefix} payload, got: ${uri.slice(0, 64)}`);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

describe("DemoNFT — on-chain generative art", () => {
  it("returns metadata and an image that need no network at all", async () => {
    const [owner] = await viem.getWalletClients();
    const nft = await viem.deployContract("DemoNFT");

    await nft.write.mintGenerative([owner.account.address]);
    const uri = await nft.read.tokenURI([0n]);

    const metadata = JSON.parse(decodeBase64DataUri(uri, "application/json"));

    assert.equal(metadata.name, "Auction House Demo #0");
    assert.ok(metadata.description.length > 0, "a token needs a description");

    // The whole point: the image is inline, not a URL to fetch.
    const svg = decodeBase64DataUri(metadata.image, "image/svg+xml");
    assert.ok(svg.startsWith("<svg "), "the image must be an SVG document");
    assert.ok(svg.endsWith("</svg>"), "the SVG must be closed");
    assert.ok(svg.includes("xmlns='http://www.w3.org/2000/svg'"), "the SVG needs its namespace");
    assert.ok(svg.includes(">#0</text>"), "the token id should appear in the artwork");

    // Nothing in the payload may reach out to a host. `https:` inside the SVG
    // namespace declaration is not a fetch, so it is excluded from the check.
    const fetchable = svg.replace("http://www.w3.org/2000/svg", "");
    assert.ok(!/https?:/.test(fetchable), "the SVG must not reference a remote host");
  });

  it("gives every trait a value the marketplace can filter on", async () => {
    const [owner] = await viem.getWalletClients();
    const nft = await viem.deployContract("DemoNFT");
    await nft.write.mintGenerative([owner.account.address]);

    const metadata = JSON.parse(
      decodeBase64DataUri(await nft.read.tokenURI([0n]), "application/json"),
    );
    const traits = Object.fromEntries(
      metadata.attributes.map((a: { trait_type: string; value: unknown }) => [
        a.trait_type,
        a.value,
      ]),
    );

    assert.ok(Number.isInteger(traits.Hue) && traits.Hue >= 0 && traits.Hue < 360);
    // The renderer draws 3..7 rings; outside that range a radius or an opacity
    // would underflow, so the bound is a correctness check and not a taste one.
    assert.ok(Number.isInteger(traits.Rings) && traits.Rings >= 3 && traits.Rings <= 7);
    assert.ok(traits.Palette === "Warm" || traits.Palette === "Cool");
  });

  it("is deterministic per token, and different between tokens", async () => {
    const [owner] = await viem.getWalletClients();
    const nft = await viem.deployContract("DemoNFT");
    await nft.write.mintGenerative([owner.account.address]);
    await nft.write.mintGenerative([owner.account.address]);

    const first = await nft.read.tokenURI([0n]);
    assert.equal(
      await nft.read.tokenURI([0n]),
      first,
      "the same token must always render the same",
    );
    assert.notEqual(await nft.read.tokenURI([1n]), first, "two tokens must not render identically");
  });

  it("still honours an explicitly stored URI, so the hosted path keeps working", async () => {
    const [owner] = await viem.getWalletClients();
    const nft = await viem.deployContract("DemoNFT");

    await nft.write.mint([owner.account.address, "ipfs://bafyexample"]);
    assert.equal(
      await nft.read.tokenURI([0n]),
      "ipfs://bafyexample",
      "a stored URI must win over the generated one",
    );
  });

  it("rejects a token that does not exist", async () => {
    const nft = await viem.deployContract("DemoNFT");
    await assert.rejects(() => nft.read.tokenURI([99n]));
  });
});
