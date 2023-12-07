// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface DomainRegistryInterface {
    function setDomain(string calldata domain) external returns (bytes4 tag);

    function getDomains(bytes4 tag)
        external
        view
        returns (string[] memory domains);

    function getNumberOfDomains(bytes4 tag)
        external
        view
        returns (uint256 totalDomains);

    function getDomain(bytes4 tag, uint256 index)
        external
        view
        returns (string memory domain);

    event DomainRegistered(string domain, bytes4 tag, uint256 index);

    error DomainAlreadyRegistered(string domain);

    error DomainIndexOutOfRange(
        bytes4 tag,
        uint256 maxIndex,
        uint256 suppliedIndex
    );
}

/**
 * @title  DomainRegistry
 * @author stephankmin, 0age
 * @notice DomainRegistry is a public reverse registry of tags (hash values included as components to
 *         function arguments or appended to calldata) and their corresponding domains (keys).
 *         Users can look up a tag from a transaction in the registry to find its registered domains.
 */
contract DomainRegistry is DomainRegistryInterface {
    // Returns an array of registered domains for an input tag.
    mapping(bytes4 => string[]) private _registry;

    // Returns true if the domain has already been registered.
    mapping(string => bool) private _hasDomainBeenRegistered;

    /**
     * @notice Hash the domain and insert it in the registry. The call will fail
     *         if the domain has already been registered.
     *
     * @param domain A string domain to be hashed and inserted into the registry.
     *
     * @return tag The hash of the domain.
     */
    function setDomain(string calldata domain) external returns (bytes4 tag) {
        // Revert if the domain has already been registered.
        if (_hasDomainBeenRegistered[domain]) {
            revert DomainAlreadyRegistered(domain);
        }

        // Set the domain as having been registered.
        _hasDomainBeenRegistered[domain] = true;

        // Create the tag by hashing the string domain.
        tag = bytes4(keccak256(abi.encodePacked(domain)));

        // Store the index of the new domain to be emitted in the event.
        uint256 index = _registry[tag].length;

        // Append the domain to the array of domains in the registry.
        _registry[tag].push(domain);

        // Emit an event signaling the domain has been registered.
        emit DomainRegistered(domain, tag, index);
    }

    /**
     * @notice Get the array of registered domains that are keys for the tag hash value.
     *         The call may run out of gas depending on the size of the returned array.
     *
     * @param tag The tag to get the registered domains for.
     *
     * @return domains The array of registered domains corresponding to the tag.
     */
    function getDomains(bytes4 tag)
        external
        view
        returns (string[] memory domains)
    {
        // Return the string array of registered domains that hash to the input tag.
        return _registry[tag];
    }

    /**
     * @notice Get the total number of domains registered for a specific tag.
     *
     * @param tag The tag to get the total number of registered domains for.
     *
     * @return totalDomains The number of registered domains corresponding to the tag.
     */
    function getNumberOfDomains(bytes4 tag)
        external
        view
        returns (uint256 totalDomains)
    {
        // Return the total number of registered domains that hash to the input tag.
        return _registry[tag].length;
    }

    /**
     * @notice Get the domain for a specific tag at a specific index. The call will revert
     *         if the index is out of range.
     *
     * @param tag   The key value tag to pass into the registry mapping.
     * @param index The index to pass into the array of domains returned by the registry.
     *
     * @return domain The domain for the given tag and array index.
     */
    function getDomain(bytes4 tag, uint256 index)
        external
        view
        returns (string memory domain)
    {
        // Get the maximum possible index of the array of registered domains for the input tag.
        uint256 maxIndex = _registry[tag].length - 1;

        // Revert if the index parameter is out of range for the array of domains
        // corresponding to the tag.
        if (index > maxIndex) {
            revert DomainIndexOutOfRange(tag, maxIndex, index);
        }

        // Return the domain for the given tag at the given index.
        return _registry[tag][index];
    }
}