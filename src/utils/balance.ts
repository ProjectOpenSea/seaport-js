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

/**
 * When fulfilling a basic order, the following requirements need to be checked to ensure that the order will be fulfillable:
 * 1. Offer checks need to be performed to ensure that the offerer still has sufficient balance and approvals
 * 2. The fulfiller should have sufficient balance of all consideration items except for those with an
 *    item type that matches the order's offered item type — by way of example, if the fulfilled order offers
 *    an ERC20 item and requires an ERC721 item to the offerer and the same ERC20 item to another recipient,
 *    the fulfiller needs to own the ERC721 item but does not need to own the ERC20 item as it will be sourced from the offerer.
 * 3. If the fulfiller does not elect to utilize a proxy, they need to have sufficient approvals set for the
 *    Consideration contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order except
 *    for ERC20 items with an item type that matches the order's offered item type.
 * 4. If the fulfiller does elect to utilize a proxy, they need to have sufficient approvals set for their
 *    respective proxy contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order
 *    except for ERC20 items with an item type that matches the order's offered item type.
 * 5. If the fulfilled order specifies Ether (or other native tokens) as consideration items, the fulfiller must
 *    be able to supply the sum total of those items as msg.value.
 *
 * @returns the list of insufficient owner and proxy approvals
 */
export const validateBasicFulfillBalancesAndApprovals = (
  {
    offer,
    orderType,
    consideration,
  }: Pick<OrderParameters, "offer" | "orderType" | "consideration">,
  {
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
  }: {
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams?: TimeBasedItemParams;
  }
) => {
  validateOfferBalancesAndApprovals(
    { offer, orderType },
    {
      balancesAndApprovals: offererBalancesAndApprovals,
      timeBasedItemParams,
      throwOnInsufficientApprovals: true,
    }
  );

  const considerationWithoutOfferItemType = consideration.filter(
    (item) => item.itemType !== offer[0].itemType
  );

  const {
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  } = getInsufficientBalanceAndApprovalAmounts(
    fulfillerBalancesAndApprovals,
    getSummedTokenAndIdentifierAmounts(
      considerationWithoutOfferItemType,
      timeBasedItemParams
    )
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The fulfiller does not have the balances needed to fulfill."
    );
  }

  const approvalsToCheck = useOffererProxy(orderType)
    ? insufficientProxyApprovals
    : insufficientOwnerApprovals;

  if (approvalsToCheck.length > 0) {
    throw new Error("The offer does not have the sufficient approvals.");
  }

  return { insufficientOwnerApprovals, insufficientProxyApprovals };
};

export const balanceOf = async (
  owner: string,
  item: Item,
  multicallProvider: multicallProviders.MulticallProvider
): Promise<BigNumber> => {
  if (isErc721Item(item.itemType)) {
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
  } else if (isErc1155Item(item.itemType)) {
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
