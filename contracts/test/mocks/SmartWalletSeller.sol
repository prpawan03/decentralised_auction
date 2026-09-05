// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title SmartWalletSeller
 * @notice A contract account that sells an NFT, of the kind the old contract
 *         could not pay.
 * @dev The contract this replaces paid the seller with `seller.transfer(...)`,
 *      which forwards only the 2300 gas stipend. Any smart wallet whose
 *      `receive` writes storage - a nonce, a log, an accounting entry - ran out
 *      of gas, the `transfer` reverted, and the whole settlement reverted with
 *      it. The item was unsellable and the bidder's ETH was stuck.
 *
 *      This mock writes two storage slots on every ETH arrival, so the 2300 gas
 *      stipend is not enough for it. The new contract credits the seller and
 *      lets it pull with {AuctionHouse.withdraw}, which forwards all remaining
 *      gas, so the sale completes.
 */
contract SmartWalletSeller is IERC721Receiver {
    /// @notice The auction house it sells through.
    AuctionHouse public immutable HOUSE;

    /// @notice Total wei this wallet has received.
    uint256 public totalReceived;
    /// @notice How many payments it has taken. The second SSTORE per receive.
    uint256 public paymentCount;

    /**
     * @notice A payment landed.
     * @param amount The amount received, in wei.
     */
    event Received(uint256 amount);

    /// @param house The auction house to sell through.
    constructor(AuctionHouse house) {
        HOUSE = house;
    }

    /**
     * @notice Approves the house and lists a token this wallet holds.
     * @param nft The ERC-721 contract.
     * @param tokenId The token to sell.
     * @param reservePrice The reserve price. 0 means no reserve.
     * @param buyNowPrice The buy-now price. 0 disables it.
     * @param duration The auction duration, in seconds.
     * @return auctionId The new auction id.
     */
    function list(
        address nft,
        uint256 tokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint64 duration
    ) external returns (uint256 auctionId) {
        IERC721(nft).approve(address(HOUSE), tokenId);
        auctionId = HOUSE.createAuction(nft, tokenId, reservePrice, buyNowPrice, duration);
    }

    /// @notice Settles one of its own auctions. Anyone could do this instead.
    /// @param auctionId The auction to settle.
    function settle(uint256 auctionId) external {
        HOUSE.settle(auctionId);
    }

    /// @notice Pulls the sale proceeds. This is what the old contract could not do.
    /// @return The amount the house paid out.
    function collect() external returns (uint256) {
        return HOUSE.withdraw();
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Accepts payment, and costs far more than the 2300 gas stipend.
    receive() external payable {
        totalReceived += msg.value;
        paymentCount += 1;
        emit Received(msg.value);
    }
}
