// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title RevertingReceiver
 * @notice The griefing bidder from the audit: a contract that refuses ETH and
 *         refuses NFTs.
 * @dev The contract this replaces pushed the refund to the previous leader and
 *      then did `require(success)`. A bidder that reverted on receive could
 *      therefore make every later `bid()` revert, freezing the auction with
 *      itself in the lead, and `endAuction` used `transfer` so the seller could
 *      be blocked too.
 *
 *      Against the new contract this mock must be harmless:
 *
 *      - A refund is only credited, so a later bid still succeeds.
 *      - Settlement uses `transferFrom`, not `safeTransferFrom`, so a revert in
 *        `onERC721Received` cannot block the handover.
 *      - Only this contract's own {AuctionHouse.withdraw} fails, and only for
 *        this contract.
 */
contract RevertingReceiver is IERC721Receiver {
    /// @notice Thrown whenever this contract is offered ETH.
    error EthRejected();
    /// @notice Thrown whenever this contract is offered an NFT.
    error NftRejected();

    /// @notice The auction house it interacts with.
    AuctionHouse public immutable HOUSE;

    /// @notice When false, the contract behaves normally.
    bool public rejecting = true;

    /// @param house The auction house to interact with.
    constructor(AuctionHouse house) {
        HOUSE = house;
    }

    /// @notice Turns the griefing on or off.
    /// @param value True to reject ETH and NFTs.
    function setRejecting(bool value) external {
        rejecting = value;
    }

    /// @notice Places a real bid, so the contract becomes a refundable leader.
    /// @param auctionId The auction to bid on.
    function bid(uint256 auctionId) external payable {
        HOUSE.bid{value: msg.value}(auctionId);
    }

    /// @notice Lists an NFT, so the contract can be a griefing seller too.
    /// @param nft The ERC-721 contract.
    /// @param tokenId The token to sell.
    /// @param reservePrice The reserve price.
    /// @param buyNowPrice The buy-now price. 0 disables it.
    /// @param duration The auction duration, in seconds.
    /// @return The new auction id.
    function createAuction(
        address nft,
        uint256 tokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 duration
    ) external returns (uint256) {
        return HOUSE.createAuction(nft, tokenId, reservePrice, buyNowPrice, duration);
    }

    /// @notice Approves the house to escrow a token this contract holds.
    /// @param nft The ERC-721 contract.
    /// @param tokenId The token to approve.
    function approveHouse(address nft, uint256 tokenId) external {
        IERC721(nft).approve(address(HOUSE), tokenId);
    }

    /// @notice Tries to pull its credit. Reverts while `rejecting` is true.
    /// @return The amount the house paid out.
    function withdraw() external returns (uint256) {
        return HOUSE.withdraw();
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        if (rejecting) revert NftRejected();
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Refuses every payment. This is the whole point of the mock.
    receive() external payable {
        if (rejecting) revert EthRejected();
    }
}
