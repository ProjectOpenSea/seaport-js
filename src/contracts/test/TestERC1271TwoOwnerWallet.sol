//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

/**
 * A contract wallet that checks ERC-1271 signatures the way a 2-of-2 Safe
 * does: both owners sign a hash that binds the digest to this wallet, and only
 * their two 65 byte r, s, v signatures, 130 bytes in all, are accepted.
 */
contract TestERC1271TwoOwnerWallet {
    address public firstOwner;
    address public secondOwner;

    constructor(address firstOwner_, address secondOwner_) {
        firstOwner = firstOwner_;
        secondOwner = secondOwner_;
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
        require(signature.length == 130, "signature must be 130 bytes");
        bytes32 messageHash = getMessageHash(hash);

        if (
            recover(messageHash, signature[0:65]) == firstOwner &&
            recover(messageHash, signature[65:130]) == secondOwner
        ) {
            return 0x1626ba7e;
        }

        return 0x00000000;
    }

    function recover(
        bytes32 hash,
        bytes calldata signature
    ) internal pure returns (address) {
        return
            ecrecover(
                hash,
                uint8(signature[64]),
                bytes32(signature[0:32]),
                bytes32(signature[32:64])
            );
    }
}
