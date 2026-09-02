// ---------------------------------------------------------------------------
// DemoNFT indexing functions.
//
// The goal of this file is that a gallery can be rendered from ONE query.
// Metadata is resolved here, once, at index time, instead of by every browser
// on every page load.
// ---------------------------------------------------------------------------

import { ponder } from "ponder:registry";
import { nftToken } from "ponder:schema";
import { zeroAddress } from "viem";

import { demoNftAbi } from "../abis/demoNft";
import { resolveMetadata } from "./metadata";
import { tokenKey } from "./shared";

ponder.on("DemoNFT:Minted", async ({ event, context }) => {
  const { to, tokenId, uri } = event.args;

  // The event already carries `uri`, so why call `tokenURI(tokenId)`?
  //
  // Because they are not the same string. `uri` is the argument that was
  // passed to `mint`, while `tokenURI` is what ERC-721 metadata consumers
  // actually resolve -- ERC721URIStorage composes it with `_baseURI()`, and a
  // later `_setTokenURI` can replace it outright. Indexing the argument would
  // mean the indexer and a wallet disagree about the same token the moment
  // either of those is true. The read is pinned to this block by Ponder, so it
  // stays deterministic and replayable.
  let tokenURI = uri;
  try {
    tokenURI = await context.client.readContract({
      abi: demoNftAbi,
      address: event.log.address,
      functionName: "tokenURI",
      args: [tokenId],
    });
  } catch {
    // Fall back to the event's own argument. A token whose `tokenURI` reverts
    // is still a token, and the mint argument is the best value available.
  }

  const metadata = resolveMetadata(tokenURI);

  // `onConflictDoNothing` guards a re-mint of a burned id. It also makes this
  // handler idempotent, which matters because `Transfer` for the same mint has
  // already been processed -- see the handler below.
  await context.db
    .insert(nftToken)
    .values({
      id: tokenKey(event.log.address, tokenId),
      contract: event.log.address,
      tokenId,
      owner: to,
      minter: to,
      tokenURI,
      name: metadata.name,
      description: metadata.description,
      image: metadata.image,
      metadataStatus: metadata.status,
      auctionCount: 0,
      mintedAt: event.block.timestamp,
      mintedBlock: event.block.number,
    })
    .onConflictDoNothing();
});

ponder.on("DemoNFT:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args;

  // The mint's own Transfer arrives BEFORE `Minted`, because `mint()` calls
  // `_safeMint` first and emits afterwards. There is no row to update yet, and
  // creating a stub here would race the insert above for the metadata columns.
  // Skipping it is correct: `Minted` writes `owner` from the same transfer.
  if (from === zeroAddress) return;

  const key = tokenKey(event.log.address, tokenId);
  if (!(await context.db.find(nftToken, { id: key }))) return;

  // Every hop is recorded, including the two escrow moves an auction makes
  // (seller -> AuctionHouse on listing, AuctionHouse -> winner on settlement).
  // That is deliberate: `owner` should answer "who holds this right now", and
  // during a live auction the honest answer is the auction contract.
  await context.db.update(nftToken, { id: key }).set({ owner: to });
});
