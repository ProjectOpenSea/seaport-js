import { BigNumber, Contract, providers } from "ethers";
import { ERC721ABI } from "../abi/ERC721";
import { ProxyRegistryInterfaceABI } from "../abi/ProxyRegistryInterface";
import { ItemType, MAX_INT } from "../constants";
import {
  Consideration,
  ERC20,
  ERC721,
  ProxyRegistryInterface,
} from "../typechain";
import { Item, OfferItem, OrderParameters } from "../types";
import {
  getSummedTokenAndIdentifierAmounts,
  isErc1155Item,
  isErc721Item,
} from "./item";
import { useOffererProxy } from "./order";
import { providers as multicallProviders } from "@0xsequence/multicall";
import {
  BalancesAndApprovals,
  getInsufficientBalanceAndApprovalAmounts,
} from "./balancesAndApprovals";

// get balances first
// get approvals
// get order status
// from multicall

// when fulfilling order
// if validated or order is already filled, it's validated
// then pass in empty signature into fulfillOrder call
export const approvedItemAmount = async (
  owner: string,
  item: Item,
  operator: string,
  provider: multicallProviders.MulticallProvider
) => {
  if (isErc721Item(item) || isErc1155Item(item)) {
    // isApprovedForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC721;
    return contract.isApprovedForAll(owner, operator);
  } else if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC20;

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * The following must be checked when creating orders
 * 1. If the order does not indicate proxy utilization, the offerer should have sufficient approvals
 *    set for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 2. If the order does indicate proxy utilization, the offerer should have sufficient approvals
 *    set for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const setNeededApprovalsForOrderCreation = async (
  { offer, offerer, orderType }: OrderParameters,
  balancesAndApprovals: BalancesAndApprovals,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
    readOnlyProvider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: providers.JsonRpcProvider;
    readOnlyProvider: multicallProviders.MulticallProvider;
  }
) => {
  const operator = await getApprovalOperator(
    { offerer, orderType },
    {
      considerationContract,
      legacyProxyRegistryAddress,
      provider: readOnlyProvider,
    }
  );

  const { insufficientApprovals } = getInsufficientBalanceAndApprovalAmounts(
    balancesAndApprovals,
    getSummedTokenAndIdentifierAmounts(offer)
  );

  const signer = provider.getSigner();

  for (const { token } of insufficientApprovals) {
    // This is guaranteed to exist
    const item = offer.find((item) => item.token === token) as OfferItem;

    if (isErc721Item(item) || isErc1155Item(item)) {
      // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
      const contract = new Contract(token, ERC721ABI, signer) as ERC721;
      await contract.setApprovalForAll(operator, true);
    } else if (item.itemType === ItemType.ERC20) {
      const contract = new Contract(token, ERC721ABI, signer) as ERC20;
      await contract.approve(operator, MAX_INT);
    }
  }
};

export const getApprovalOperator = async (
  { offerer, orderType }: Pick<OrderParameters, "offerer" | "orderType">,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: multicallProviders.MulticallProvider;
  }
) => {
  const useProxy = useOffererProxy(orderType);

  const proxyRegistryInterface = new Contract(
    legacyProxyRegistryAddress,
    ProxyRegistryInterfaceABI,
    provider
  ) as ProxyRegistryInterface;

  const operator = useProxy
    ? await proxyRegistryInterface.proxies(offerer)
    : considerationContract.address;

  return operator;
};
