// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title DemoNFT
 * @author decentralised-auction
 * @notice A minimal ERC-721 with an open mint, so the seed script and the UI can
 *         create listable items without a marketplace behind them.
 * @dev Demo only. The mint is deliberately permissionless and there is no supply
 *      cap. This contract MUST NOT be deployed to a public network.
 */
contract DemoNFT is ERC721URIStorage {
    /// @dev The id handed to the next mint. Ids start at 0 and never repeat.
    uint256 private _nextTokenId;

    /**
     * @notice A token was minted.
     * @param to The first owner.
     * @param tokenId The new token id.
     * @param uri The metadata URI.
     */
    event Minted(address indexed to, uint256 indexed tokenId, string uri);

    /// @notice Deploys the demo collection.
    constructor() ERC721("Auction House Demo", "AHDEMO") {}

    /**
     * @notice How many tokens have been minted.
     * @return The next token id, which equals the number minted so far.
     */
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @notice Mints a token to `to` and sets its metadata URI.
     * @dev Open to anyone, on purpose. `_safeMint` is used so a contract
     *      recipient MUST implement `onERC721Received`.
     * @param to The address that receives the token.
     * @param uri The metadata URI, or a plain image URL for the demo.
     * @return tokenId The id of the new token.
     */
    function mint(address to, string memory uri) public returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        unchecked {
            _nextTokenId = tokenId + 1;
        }
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit Minted(to, tokenId, uri);
    }
}
