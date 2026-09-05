// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title OnChainArt
 * @author decentralised-auction
 * @notice Renders a deterministic SVG and its ERC-721 metadata entirely on
 *         chain, as a `data:` URI. No IPFS, no gateway, no HTTP.
 * @dev WHY THIS EXISTS
 *      The demonstration seeded tokens whose metadata pointed at images on
 *      upload.wikimedia.org. That works under the Vite development server,
 *      which sets no Content-Security-Policy, and it silently FAILS in the
 *      production shape: docker/nginx/default.conf sends
 *
 *          img-src 'self' data: blob:
 *
 *      so a remote image is blocked and every listing renders a placeholder.
 *      Rather than widen the policy -- which would let any seller's metadata
 *      make the browser fetch an arbitrary URL -- the art moves on chain. A
 *      `data:` URI is already allowed, so the policy does not change.
 *
 *      This is a library rather than part of {DemoNFT} so the renderer can be
 *      read and replaced on its own. A library's internal functions are
 *      inlined into the caller, so this still costs code size in the token;
 *      the split is about SEPARATION, not about the EIP-170 limit. If the art
 *      grows, move it behind an external descriptor contract.
 */
library OnChainArt {
    using Strings for uint256;

    /// @dev Rings drawn: MIN_RINGS to MIN_RINGS + RING_SPREAD - 1, so 3..7.
    uint256 private constant MIN_RINGS = 3;
    uint256 private constant RING_SPREAD = 5;

    /**
     * @notice The complete `tokenURI` payload for one token.
     * @dev Returns `data:application/json;base64,...`. Base64 rather than a
     *      plain `utf8` payload, because every wallet that reads a data URI at
     *      all reads the base64 form.
     * @param collection The token contract, mixed into the seed so two
     *        deployments do not produce identical art.
     * @param tokenId The token.
     * @return The metadata data URI.
     */
    function tokenURI(address collection, uint256 tokenId) internal pure returns (string memory) {
        uint256 seed = uint256(keccak256(abi.encode(collection, tokenId)));

        uint256 hue = seed % 360;
        uint256 rings = MIN_RINGS + ((seed >> 16) % RING_SPREAD);
        bool warm = ((seed >> 32) & 1) == 1;

        string memory svg = _svg(hue, rings, warm, tokenId);

        // Single quotes are used inside the SVG so that nothing in it needs
        // escaping when it is placed into the JSON string below.
        string memory json = string.concat(
            "{\"name\":\"Auction House Demo #",
            tokenId.toString(),
            "\",\"description\":\"A fully on-chain generative piece. The image is an SVG built by the contract at read time and returned as a data URI, so this token needs no IPFS gateway and no external host to render.\",\"image\":\"data:image/svg+xml;base64,",
            Base64.encode(bytes(svg)),
            "\",\"attributes\":[{\"trait_type\":\"Hue\",\"value\":",
            hue.toString(),
            "},{\"trait_type\":\"Rings\",\"value\":",
            rings.toString(),
            "},{\"trait_type\":\"Palette\",\"value\":\"",
            warm ? "Warm" : "Cool",
            "\"}]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /**
     * @dev Builds the SVG: concentric rings, hue rotated, on a dark ground.
     */
    function _svg(
        uint256 hue,
        uint256 rings,
        bool warm,
        uint256 tokenId
    ) private pure returns (string memory) {
        // A warm piece rotates hue forward between rings, a cool one back.
        // 342 is -18 modulo 360.
        uint256 step = warm ? 18 : 342;

        string memory shapes = "";
        for (uint256 i = 0; i < rings; ++i) {
            uint256 ringHue = (hue + i * step) % 360;
            // `rings` is at most 7, so `i` is at most 6: the smallest radius is
            // 210 - 6*28 = 42 and the lowest opacity is 0.3. Neither underflows.
            uint256 radius = 210 - i * 28;
            shapes = string.concat(
                shapes,
                "<circle cx='256' cy='256' r='",
                radius.toString(),
                "' fill='none' stroke='hsl(",
                ringHue.toString(),
                ",72%,58%)' stroke-width='",
                (i % 2 == 0) ? "10" : "4",
                "' opacity='0.",
                (9 - i).toString(),
                "'/>"
            );
        }

        return
            string.concat(
                "<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'>",
                "<rect width='512' height='512' fill='hsl(",
                hue.toString(),
                ",45%,9%)'/>",
                shapes,
                "<circle cx='256' cy='256' r='16' fill='hsl(",
                hue.toString(),
                ",80%,72%)'/>",
                "<text x='256' y='486' font-family='monospace' font-size='22' fill='hsl(",
                hue.toString(),
                ",30%,70%)' text-anchor='middle'>#",
                tokenId.toString(),
                "</text></svg>"
            );
    }
}
