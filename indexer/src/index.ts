// ---------------------------------------------------------------------------
// Indexing entry point.
//
// Ponder discovers indexing functions by loading every module under `src/`
// except `src/api/`, so these imports are not strictly required. They are here
// anyway, because a registration that depends on file-system discovery is a
// registration nobody can find by reading the code -- and because an explicit
// list makes it obvious when a contract is being indexed and nothing is
// listening to it.
//
// The handlers are split by CONTRACT rather than by event, because the
// invariants are per contract: everything in `auctions.ts` shares the
// lifecycle row and the rollups, and everything in `nft.ts` shares the token
// row.
// ---------------------------------------------------------------------------

import "./auctions";
import "./nft";
