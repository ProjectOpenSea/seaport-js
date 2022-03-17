/* eslint-disable no-unused-vars */
export const CONSIDERATION_CONTRACT_NAME = "Consideration";
export const CONSIDERATION_CONTRACT_VERSION = "1";
export const EIP_712_ORDER_TYPE = {
  OrderComponents: [
    {
      name: "offerer",
      type: "address",
    },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferedItem[]" },
    { name: "consideration", type: "ReceivedItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  OfferedItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ReceivedItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
};

export enum OrderType {
  FULL_OPEN = 0, // no partial fills, anyone can execute
  PARTIAL_OPEN = 1, // partial fills supported, anyone can execute
  FULL_RESTRICTED = 2, // no partial fills, only offerer or zone can execute
  PARTIAL_RESTRICTED = 3, // partial fills supported, only offerer or zone can execute
  FULL_OPEN_VIA_PROXY = 4, // no partial fills, anyone can execute, routed through proxy
  PARTIAL_OPEN_VIA_PROXY = 5, // partial fills supported, anyone can execute, routed through proxy
  FULL_RESTRICTED_VIA_PROXY = 6, // no partial fills, only offerer or zone can execute, routed through proxy
  PARTIAL_RESTRICTED_VIA_PROXY = 7, // partial fills supported, only offerer or zone can execute, routed through proxy
}

export enum ItemType {
  NATIVE = 0,
  ERC20 = 1,
  ERC721 = 2,
  ERC1155 = 3,
  ERC721_WITH_CRITERIA = 4,
  ERC1155_WITH_CRITERIA = 5,
}

export type NftItemType =
  | ItemType.ERC721
  | ItemType.ERC1155
  | ItemType.ERC721_WITH_CRITERIA
  | ItemType.ERC1155_WITH_CRITERIA;

export enum Side {
  OFFER = 0, // Items being supplied
  CONSIDERATION = 1, // Items being received
}

export enum BasicFulfillOrder {
  ETH_FOR_ERC721,
  ETH_FOR_ERC1155,
  ERC20_FOR_ERC721,
  ERC20_FOR_ERC1155,
  ERC721_FOR_ERC20,
  ERC1155_FOR_ERC20,
}
