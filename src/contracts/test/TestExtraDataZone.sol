// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "seaport/contracts/interfaces/ZoneInterface.sol";

/**
 * @notice A zone that only authorizes an order when the fulfiller supplies
 *         extraData, the way a signed zone needs its signature to arrive in
 *         extraData. It records what it was given so a test can read it back.
 */
contract TestExtraDataZone {
    error MissingExtraData();

    bytes public lastExtraData;

    function authorizeOrder(
        ZoneParameters calldata zoneParameters
    ) external returns (bytes4) {
        if (zoneParameters.extraData.length == 0) {
            revert MissingExtraData();
        }

        lastExtraData = zoneParameters.extraData;

        return this.authorizeOrder.selector;
    }

    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external pure returns (bytes4) {
        if (zoneParameters.extraData.length == 0) {
            revert MissingExtraData();
        }

        return this.validateOrder.selector;
    }

    function getSeaportMetadata()
        external
        pure
        returns (string memory name, Schema[] memory schemas)
    {
        return ("TestExtraDataZone", new Schema[](0));
    }

    function supportsInterface(
        bytes4 interfaceId
    ) external pure returns (bool) {
        return
            interfaceId == type(ZoneInterface).interfaceId ||
            interfaceId == 0x01ffc9a7;
    }
}
