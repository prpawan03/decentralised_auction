// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionCore} from "./core/AuctionCore.sol";
import {EnglishAuction} from "./formats/EnglishAuction.sol";
import {DutchAuction} from "./formats/DutchAuction.sol";

/**
 * @title AuctionHouse
 * @author decentralised-auction
 * @notice An auction house for ERC-721 tokens, with an escrowed NFT and pull
 *         payments, offering two formats:
 *
 *           - English ascending, with anti-snipe extension and optional buy-now.
 *           - Dutch descending, where the price falls and the first buyer wins.
 * @dev The contract is immutable. There is no proxy and no upgrade path.
 *
 *      This file is the COMPOSITION POINT. It names which formats this
 *      deployment offers, and resolves the one question that only something
 *      seeing all of them can answer: when a closed auction is settled, whose
 *      rule decides whether it sold. Everything else lives in {AuctionCore} or
 *      in a format.
 *
 *      Both formats share one auction id space, one escrow pool and one
 *      pull-payment ledger, so `getAuctions` pages across them and a listing
 *      has one address and one number wherever it is shown.
 */
contract AuctionHouse is EnglishAuction, DutchAuction {
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

    /**
     * @notice Routes settlement to the rule of the format the auction was
     *         listed under.
     * @dev Dispatched EXPLICITLY on the stored format rather than left to
     *      `super` and C3 linearisation. Both would work today, but a `super`
     *      chain makes the answer depend on the order the parents are named on
     *      the contract line above, and reordering that list is the kind of
     *      edit nobody expects to change who gets paid. A switch on the
     *      auction's own record cannot be broken by reordering anything.
     *
     *      A new format is added by naming it above and adding its arm here.
     *      The compiler will not force that second step, so it is worth saying
     *      plainly: an unhandled format would settle under the English rule.
     *      That default is the conservative one - it credits nobody unless a
     *      bid actually cleared the reserve - but it is still a default, and a
     *      third format MUST add its own arm.
     * @param auction The auction storage pointer.
     * @return The outcome to finalise with.
     */
    function _settlementOutcome(Auction storage auction) internal view override returns (Status) {
        if (auction.format == Format.Dutch) return _dutchSettlementOutcome();
        return _englishSettlementOutcome(auction);
    }
}
