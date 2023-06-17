//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

import "hardhat/console.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract TestERC1271Wallet {

    address public orderSigner;

    constructor() {
        orderSigner = msg.sender;
    }

    function approveToken(
        address token,
        address spender,
        uint256 amount
    ) external {
        IERC20Approve(token).approve(spender, amount);
    }

    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4) {
        address signer_ = recover(hash, signature);
        if (signer_ == orderSigner) {
            return 0x1626ba7e;
        }
        return 0x00000000;
    }

    function recover(
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        // Version of signature should be 27 or 28, but 0 and 1 are also possible versions
        if (v < 27) {
            v += 27;
        }

        // If the version is correct return the signer address
        if (v != 27 && v != 28) {
            return (address(0));
        } else {
            return ecrecover(hash, v, r, s);
        }
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata _data
    ) public returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
