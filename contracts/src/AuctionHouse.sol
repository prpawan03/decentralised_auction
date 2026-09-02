// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionCore} from "./core/AuctionCore.sol";
import {EnglishAuction} from "./formats/EnglishAuction.sol";

/**
 * @title AuctionHouse
 * @author decentralised-auction
 * @notice An auction house for ERC-721 tokens, with an escrowed NFT, pull
 *         payments and one auction format: English ascending, with anti-snipe
 *         extension and an optional buy-now price.
 * @dev The contract is immutable. There is no proxy and no upgrade path.
 *
 *      This file is deliberately almost empty. It is the COMPOSITION POINT:
 *      it names which formats this deployment offers and nothing else. The
 *      machinery every format shares is in {AuctionCore}; the ascending-price
 *      rules are in {EnglishAuction}. Adding a format means adding a parent
 *      here, not editing the settlement path that the audit signed off on.
 *
 *      The external ABI is unchanged by the split. `createAuction`, `bid`,
 *      `buyNow`, `settle`, `cancelAuction`, `withdraw`, `claimNft`, every
 *      admin call and every view keep the signature and the behaviour they
 *      had when this was one file, which is what the existing test suite
 *      checks.
 */
contract AuctionHouse is EnglishAuction {
    /**
     * @notice Deploys the auction house.
     * @dev The parameters are forwarded to {AuctionCore}, which owns the fee
     *      state and validates both values.
     * @param initialOwner The first owner. Ownership transfer is two-step.
     * @param initialFeeRecipient Where fees are credited. `address(0)` means no fee.
     * @param initialFeeBps The starting fee, in basis points. It MUST NOT exceed
     *        {MAX_FEE_BPS}.
     */
    constructor(
        address initialOwner,
        address initialFeeRecipient,
        uint16 initialFeeBps
    ) AuctionCore(initialOwner, initialFeeRecipient, initialFeeBps) {}
}
