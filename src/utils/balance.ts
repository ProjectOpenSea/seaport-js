import { BigNumber, Contract } from "ethers";
import { ERC1155ABI } from "../abi/ERC1155";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType } from "../constants";
import { ERC1155, ERC20, ERC721 } from "../typechain";
import { Item, OrderParameters } from "../types";
import {
  getSummedTokenAndIdentifierAmounts,
  isErc1155Item,
  isErc721Item,
  TimeBasedItemParams,
} from "./item";
import { providers as multicallProviders } from "@0xsequence/multicall";
import {
  BalancesAndApprovals,
  getInsufficientBalanceAndApprovalAmounts,
} from "./balancesAndApprovals";
import { useOffererProxy } from "./order";

/**
 * 1. The offerer should have sufficient balance of all offered items.
 * 2. If the order does not indicate proxy utilization, the offerer should have sufficient approvals set
 *    for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 3. If the order does indicate proxy utilization, the offerer should have sufficient approvals set
 *    for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const validateOfferBalancesAndApprovals = (
  { offer, orderType }: Pick<OrderParameters, "offer" | "orderType">,
  {
    balancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientApprovals,
  }: {
    balancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams?: TimeBasedItemParams;
    throwOnInsufficientApprovals?: boolean;
  }
) => {
  const {
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  } = getInsufficientBalanceAndApprovalAmounts(
    balancesAndApprovals,
    getSummedTokenAndIdentifierAmounts(offer, timeBasedItemParams)
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The offerer does not have the amount needed to create or fulfill."
    );
  }

  const approvalsToCheck = useOffererProxy(orderType)
    ? insufficientProxyApprovals
    : insufficientOwnerApprovals;

  if (throwOnInsufficientApprovals && approvalsToCheck.length > 0) {
    throw new Error("The offer does not have the sufficient approvals.");
  }
};

export const balanceOf = async (
  owner: string,
  item: Item,
  multicallProvider: multicallProviders.MulticallProvider
): Promise<BigNumber> => {
  if (isErc721Item(item)) {
    const contract = new Contract(
      item.token,
      ERC721ABI,
      multicallProvider
    ) as ERC721;

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return contract.balanceOf(owner);
    }

    const isOwner = await contract.ownerOf(item.identifierOrCriteria);
    return BigNumber.from(Number(isOwner));
  } else if (isErc1155Item(item)) {
    if (item.itemType === ItemType.ERC1155_WITH_CRITERIA) {
      throw new Error("ERC1155 Criteria based offers are not supported");
    }

    const contract = new Contract(
      item.token,
      ERC1155ABI,
      multicallProvider
    ) as ERC1155;
    return contract.balanceOf(owner, item.identifierOrCriteria);
  }

  if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(
      item.token,
      ERC721ABI,
      multicallProvider
    ) as ERC20;
    return contract.balanceOf(owner);
  }

  return multicallProvider.getBalance(owner);
};
