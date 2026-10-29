//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

/**
 * A contract wallet that checks ERC-1271 signatures the way a 1-of-1 Safe
 * does: its owner signs a hash that binds the digest to this wallet, and only
 * a 65 byte r, s, v signature over that hash is accepted.
 */
contract TestERC1271WrappedWallet {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function approveToken(
        address token,
        address spender,
        uint256 amount
    ) external {
        (bool success, ) = token.call(
            abi.encodeWithSignature(
                "approve(address,uint256)",
                spender,
                amount
            )
        );
        require(success, "approve failed");
    }

    function getMessageHash(bytes32 hash) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), hash));
    }

    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4) {
        require(signature.length == 65, "signature must be 65 bytes");

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);

        if (ecrecover(getMessageHash(hash), v, r, s) == owner) {
            return 0x1626ba7e;
        }
        return 0x00000000;
    }

    function onERC721Received(
        address /* operator */,
        address /* from */,
        uint256 /* tokenId */,
        bytes calldata /* data */
    ) public pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
