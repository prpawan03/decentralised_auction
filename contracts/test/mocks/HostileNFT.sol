// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title HostileNFT
 * @notice An ERC-721 that can be switched into refusing every transfer.
 * @dev A seller could list a token, wait for a bid, then freeze the token
 *      contract so settlement reverts on the handover and every bidder's ETH
 *      stayed locked in the auction house forever.
 *
 *      {AuctionHouse} wraps the handover in `try`/`catch`, so the money still
 *      moves and only the token stays in escrow, with a `NftReleaseFailed`
 *      event as the record.
 */
contract HostileNFT is ERC721 {
    /// @notice Thrown by every transfer while `blocking` is true.
    error TransfersBlocked();

    /// @notice When true, every transfer reverts.
    bool public blocking;

    /// @dev The id handed to the next mint.
    uint256 private _nextTokenId;

    /// @notice Deploys the hostile collection.
    constructor() ERC721("Hostile", "HOSTILE") {}

    /// @notice Turns the blocking on or off.
    /// @param value True to make every transfer revert.
    function setBlocking(bool value) external {
        blocking = value;
    }

    /// @notice Mints a token.
    /// @param to The first owner.
    /// @return tokenId The new token id.
    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        unchecked {
            _nextTokenId = tokenId + 1;
        }
        _safeMint(to, tokenId);
    }

    /// @dev The single choke point every ERC-721 transfer goes through in OZ v5.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (blocking) revert TransfersBlocked();
        return super._update(to, tokenId, auth);
    }
}
