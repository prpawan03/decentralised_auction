// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {OnChainArt} from "./art/OnChainArt.sol";

/**
 * @title DemoNFT
 * @author decentralised-auction
 * @notice A minimal ERC-721 with an open mint, so the seed script and the UI can
 *         create listable items without a marketplace behind them.
 * @dev Demo only. The mint is deliberately permissionless and there is no supply
 *      cap. This contract MUST NOT be deployed to a public network.
 *
 *      TWO KINDS OF TOKEN, ON PURPOSE
 *      {mint} stores an explicit metadata URI, as before. {mintGenerative}
 *      stores nothing and lets {tokenURI} build the metadata and the image on
 *      chain, as a `data:` URI.
 *
 *      The second path exists because the production shape serves
 *
 *          img-src 'self' data: blob:
 *
 *      (see docker/nginx/default.conf), so a token whose image lives on a
 *      remote host renders a placeholder behind nginx while looking correct
 *      under the Vite development server, which sets no policy at all. A
 *      generative token renders identically in both, offline, with no gateway.
 *
 *      Keeping both is the point: the demonstration can show a hosted-metadata
 *      token and a self-contained one side by side, which is the whole
 *      trade-off an NFT platform has to make.
 */
contract DemoNFT is ERC721URIStorage {
    /// @dev The id handed to the next mint. Ids start at 0 and never repeat.
    uint256 private _nextTokenId;

    /**
     * @notice A token was minted.
     * @dev `uri` is the EMPTY STRING for a token minted through
     *      {mintGenerative}. An empty value is the signal that the metadata is
     *      generated on chain; an indexer should call {tokenURI} rather than
     *      treat it as missing. The image is not emitted, because a base64 SVG
     *      in a log costs far more than reading it back on demand.
     * @param to The first owner.
     * @param tokenId The new token id.
     * @param uri The stored metadata URI, or "" when the art is on chain.
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
        tokenId = _mintTo(to);
        _setTokenURI(tokenId, uri);
        emit Minted(to, tokenId, uri);
    }

    /**
     * @notice Mints a token whose artwork and metadata are generated on chain.
     * @dev No URI is stored, so {tokenURI} falls through to {OnChainArt}. The
     *      result is deterministic in `address(this)` and the token id, so the
     *      same id always renders the same piece on the same deployment.
     * @param to The address that receives the token.
     * @return tokenId The id of the new token.
     */
    function mintGenerative(address to) external returns (uint256 tokenId) {
        tokenId = _mintTo(to);
        emit Minted(to, tokenId, "");
    }

    /**
     * @notice The metadata for `tokenId`.
     * @dev A stored URI wins. When none was stored the token is generative and
     *      the metadata is built here.
     *
     *      `super.tokenURI` does the existence check and returns the stored
     *      value, or the empty string when nothing was stored and no base URI
     *      is set -- which is this contract's case. Using that empty result as
     *      the discriminator avoids a second storage slot per token.
     * @param tokenId The token.
     * @return The metadata URI.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        string memory stored = super.tokenURI(tokenId);
        if (bytes(stored).length != 0) {
            return stored;
        }
        return OnChainArt.tokenURI(address(this), tokenId);
    }

    /**
     * @notice Collection-level metadata.
     * @dev ERC-7572. That EIP is a DRAFT at the time of writing, so treat this
     *      as a convenience rather than a guarantee: marketplaces may ignore
     *      it, and the shape may change before the EIP is final. It is inline
     *      `utf8` rather than base64 so it stays readable in a block explorer.
     * @return The contract metadata URI.
     */
    function contractURI() external pure returns (string memory) {
        return
            "data:application/json;utf8,{\"name\":\"Auction House Demo\","
            '"description":"Demonstration collection for a local-first NFT auction house. '
            'Generative tokens render entirely on chain.","image":"","external_link":""}';
    }

    /// @dev Assigns the next id and mints. Shared by both mint paths.
    function _mintTo(address to) private returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        unchecked {
            _nextTokenId = tokenId + 1;
        }
        _safeMint(to, tokenId);
    }
}
