import { BigNumber } from "ethers";
import { mapKeys, mapValues, pickBy } from "lodash";

import DEPLOYED_CONTRACTS from "./deployed-contracts.json";

export type ContractName = keyof typeof DEPLOYED_CONTRACTS;

type ContractAddress = string;
export type ContractMap = Record<ContractName, ContractAddress>;

// map 'UniswapV3' in DEPLOYED_CONTRACTS to 'UNI-V3-POS'
const NORMALIZED_DEPLOYED_CONTRACTS = mapKeys(DEPLOYED_CONTRACTS, (_v, k) =>
  k === "UniswapV3" ? "UNI-V3-POS" : k
);

const extractContractMapFromDeployedContracts = (network: "goerli") => {
  const rawContractMap = mapValues(NORMALIZED_DEPLOYED_CONTRACTS, (it) =>
    network in it ? it[network].address : null
  );
  // ignore invalid(length is not 42) contract address
  return pickBy(
    rawContractMap,
    (v, k) => v?.length === 42 || k === "ConduitKey"
  ) as ContractMap;
};

export const CONTRACT_MAP: ContractMap = {
  ...extractContractMapFromDeployedContracts("goerli"),
};

export const SEAPORT_CONTRACT_NAME = "ParaSpace";
export const SEAPORT_CONTRACT_VERSION = "1.1";
export const OPENSEA_CONDUIT_KEY = CONTRACT_MAP.ConduitKey;
export const OPENSEA_CONDUIT_ADDRESS = CONTRACT_MAP.Conduit;
export const EIP_712_ORDER_TYPE = {
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" },
  ],
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
};

export enum OrderType {
  FULL_OPEN = 0, // No partial fills, anyone can execute
  PARTIAL_OPEN = 1, // Partial fills supported, anyone can execute
  FULL_RESTRICTED = 2, // No partial fills, only offerer or zone can execute
  PARTIAL_RESTRICTED = 3, // Partial fills supported, only offerer or zone can execute
}

export enum ItemType {
  NATIVE = 0,
  ERC20 = 1,
  ERC721 = 2,
  ERC1155 = 3,
  ERC721_WITH_CRITERIA = 4,
  ERC1155_WITH_CRITERIA = 5,
}

export enum Side {
  OFFER = 0,
  CONSIDERATION = 1,
}

export type NftItemType =
  | ItemType.ERC721
  | ItemType.ERC1155
  | ItemType.ERC721_WITH_CRITERIA
  | ItemType.ERC1155_WITH_CRITERIA;

export enum BasicOrderRouteType {
  ETH_TO_ERC721,
  ETH_TO_ERC1155,
  ERC20_TO_ERC721,
  ERC20_TO_ERC1155,
  ERC721_TO_ERC20,
  ERC1155_TO_ERC20,
}

export const MAX_INT = BigNumber.from(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);
export const ONE_HUNDRED_PERCENT_BP = 10000;
export const NO_CONDUIT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// Supply here any known conduit keys as well as their conduits
export const KNOWN_CONDUIT_KEYS_TO_CONDUIT = {
  [OPENSEA_CONDUIT_KEY]: OPENSEA_CONDUIT_ADDRESS,
};

export const CROSS_CHAIN_SEAPORT_ADDRESS = CONTRACT_MAP.Seaport;

export const DOMAIN_REGISTRY_ADDRESS =
  "0x000000000DaD0DE04D2B2D4a5A74581EBA94124A";
