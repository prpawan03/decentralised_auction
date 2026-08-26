// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title ReentrantBidder
 * @notice The reentrancy attacker from the audit, rebuilt against the new contract.
 * @dev The contract this replaces refunded the previous leader with a raw
 *      `call` in the middle of `bid()`, before it wrote the new leader to
 *      storage. The refund landed in this contract's `receive`, which called
 *      back in and drained the balance of every other auction.
 *
 *      This mock reproduces that behaviour exactly and re-enters on every ETH
 *      arrival. It exists to prove the attack no longer works:
 *
 *      - {AuctionHouse.bid} and {AuctionHouse.buyNow} make no external call at
 *        all, so there is no ETH arrival to hook.
 *      - {AuctionHouse.withdraw} zeroes the credit before it sends, and carries
 *        `nonReentrant`, so the re-entry finds nothing and is rejected.
 */
contract ReentrantBidder is IERC721Receiver {
    /// @notice What the attacker tries when ETH arrives.
    enum Mode {
        None,
        ReenterWithdraw,
        ReenterBuyNow,
        ReenterBid
    }

    /// @notice The auction house under attack.
    AuctionHouse public immutable HOUSE;

    /// @notice The auction the re-entry targets.
    uint256 public targetAuctionId;
    /// @notice The current attack mode.
    Mode public mode;
    /// @notice How many times `receive` fired.
    uint256 public receiveCount;
    /// @notice How many re-entry attempts were made.
    uint256 public reentryAttempts;
    /// @notice How many re-entry attempts the guard rejected.
    uint256 public reentryRejections;
    /// @notice Total wei this contract has actually received.
    uint256 public totalReceived;
    /// @notice The revert data from the last rejected re-entry.
    bytes public lastRevertData;

    /// @param house The auction house to attack.
    constructor(AuctionHouse house) {
        HOUSE = house;
    }

    /// @notice Arms the attacker.
    /// @param newMode What to do on the next ETH arrival.
    /// @param auctionId The auction the re-entry should target.
    function arm(Mode newMode, uint256 auctionId) external {
        mode = newMode;
        targetAuctionId = auctionId;
    }

    /// @notice Places an honest bid, so the attacker has a credit to attack with.
    /// @param auctionId The auction to bid on.
    function bid(uint256 auctionId) external payable {
        HOUSE.bid{value: msg.value}(auctionId);
    }

    /// @notice Buys at the buy-now price.
    /// @param auctionId The auction to buy.
    function buyNow(uint256 auctionId) external payable {
        HOUSE.buyNow{value: msg.value}(auctionId);
    }

    /// @notice Pulls the credit. The re-entry happens inside this call.
    /// @return The amount the house paid out.
    function withdraw() external returns (uint256) {
        return HOUSE.withdraw();
    }

    /// @notice Funds the attacker for a re-entry attempt.
    function fund() external payable {}

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice The hook the old exploit used. It fires while the house is mid-payout.
    receive() external payable {
        receiveCount += 1;
        totalReceived += msg.value;

        Mode current = mode;
        if (current == Mode.None) return;

        // Disarm first, so a successful re-entry cannot loop forever and hide
        // the result behind an out-of-gas.
        mode = Mode.None;
        reentryAttempts += 1;

        if (current == Mode.ReenterWithdraw) {
            try HOUSE.withdraw() returns (uint256) {
                // Reached only if the guard failed.
            } catch (bytes memory reason) {
                reentryRejections += 1;
                lastRevertData = reason;
            }
        } else if (current == Mode.ReenterBuyNow) {
            try HOUSE.buyNow{value: address(this).balance}(targetAuctionId) {
                // Reached only if the guard failed.
            } catch (bytes memory reason) {
                reentryRejections += 1;
                lastRevertData = reason;
            }
        } else if (current == Mode.ReenterBid) {
            try HOUSE.bid{value: address(this).balance}(targetAuctionId) {
                // Reached only if the guard failed.
            } catch (bytes memory reason) {
                reentryRejections += 1;
                lastRevertData = reason;
            }
        }
    }
}
