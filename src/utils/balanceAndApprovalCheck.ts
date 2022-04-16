import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, ethers } from "ethers";
import { ItemType, MAX_INT, ProxyStrategy } from "../constants";
import type { Consideration } from "../typechain";
import type { InputCriteria, Item, OrderParameters } from "../types";
import { approvedItemAmount } from "./approval";
import { balanceOf } from "./balance";
import { getItemToCriteriaMap } from "./criteria";
import {
  getSummedTokenAndIdentifierAmounts,
  isErc1155Item,
  isErc20Item,
  isErc721Item,
  TimeBasedItemParams,
} from "./item";
import { useOffererProxy, useProxyFromApprovals } from "./order";

export type BalancesAndApprovals = {
  token: string;
  identifierOrCriteria: string;
  balance: BigNumber;
  ownerApprovedAmount: BigNumber;
  proxyApprovedAmount: BigNumber;
  itemType: ItemType;
}[];

export type InsufficientBalances = {
  token: string;
  identifierOrCriteria: string;
  requiredAmount: BigNumber;
  amountHave: BigNumber;
  itemType: ItemType;
}[];

export type InsufficientApprovals = {
  token: string;
  identifierOrCriteria: string;
  approvedAmount: BigNumber;
  requiredApprovedAmount: BigNumber;
  operator: string;
  itemType: ItemType;
}[];

const findBalanceAndApproval = (
  balancesAndApprovals: BalancesAndApprovals,
  token: string,
  identifierOrCriteria: string
) => {
  const balanceAndApproval = balancesAndApprovals.find(
    ({
      token: checkedToken,
      identifierOrCriteria: checkedIdentifierOrCriteria,
    }) =>
      token.toLowerCase() === checkedToken.toLowerCase() &&
      checkedIdentifierOrCriteria.toLowerCase() ===
        identifierOrCriteria.toLowerCase()
  );

  if (!balanceAndApproval) {
    throw new Error(
      "Balances and approvals didn't contain all tokens and identifiers"
    );
  }

  return balanceAndApproval;
};

export const getBalancesAndApprovals = async (
  owner: string,
  items: Item[],
  criterias: InputCriteria[],
  {
    considerationContract,
    proxy,
    multicallProvider,
  }: {
    considerationContract: Consideration;
    proxy: string;
    multicallProvider: multicallProviders.MulticallProvider;
  }
): Promise<BalancesAndApprovals> => {
  const itemToCriteria = getItemToCriteriaMap(items, criterias);

  return Promise.all(
    items.map(async (item) => {
      let ownerApprovedAmountPromise = Promise.resolve(BigNumber.from(0));
      let proxyApprovedAmountPromise = Promise.resolve(BigNumber.from(0));

      // If erc721 or erc1155 check both consideration and proxy approvals unless config says ignore proxy
      if (isErc721Item(item.itemType) || isErc1155Item(item.itemType)) {
        ownerApprovedAmountPromise = approvedItemAmount(
          owner,
          item,
          considerationContract.address,
          multicallProvider
        );

        if (proxy !== ethers.constants.AddressZero) {
          proxyApprovedAmountPromise = approvedItemAmount(
            owner,
            item,
            proxy,
            multicallProvider
          );
        }
      }
      // If erc20 check just consideration contract for approvals
      else if (isErc20Item(item.itemType)) {
        ownerApprovedAmountPromise = approvedItemAmount(
          owner,
          item,
          considerationContract.address,
          multicallProvider
        );

        // There technically is no proxy approved amount for ERC-20s.
        // Making it the same as the owner approved amount except changing the operator
        // to be the consideration contract
        proxyApprovedAmountPromise = ownerApprovedAmountPromise;
      }
      // If native token, we don't need to check for approvals
      else {
        ownerApprovedAmountPromise = Promise.resolve(MAX_INT);
        proxyApprovedAmountPromise = Promise.resolve(MAX_INT);
      }

      return {
        token: item.token,
        identifierOrCriteria:
          itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
        balance: await balanceOf(
          owner,
          item,
          multicallProvider,
          itemToCriteria.get(item)
        ),
        ownerApprovedAmount: await ownerApprovedAmountPromise,
        proxyApprovedAmount: await proxyApprovedAmountPromise,
        itemType: item.itemType,
      };
    })
  );
};

export const getInsufficientBalanceAndApprovalAmounts = (
  balancesAndApprovals: BalancesAndApprovals,
  tokenAndIdentifierAmounts: ReturnType<
    typeof getSummedTokenAndIdentifierAmounts
  >,
  {
    considerationContract,
    proxy,
    proxyStrategy,
  }: {
    considerationContract: Consideration;
    proxy: string;
    proxyStrategy: ProxyStrategy;
  }
): {
  insufficientBalances: InsufficientBalances;
  insufficientOwnerApprovals: InsufficientApprovals;
  insufficientProxyApprovals: InsufficientApprovals;
} => {
  const tokenAndIdentifierAndAmountNeeded = [
    ...Object.entries(tokenAndIdentifierAmounts).map(
      ([token, identifierToAmount]) =>
        Object.entries(identifierToAmount).map(
          ([identifierOrCriteria, amountNeeded]) =>
            [token, identifierOrCriteria, amountNeeded] as const
        )
    ),
  ].flat();

  const filterBalancesOrApprovals = (
    filterKey: "balance" | "ownerApprovedAmount" | "proxyApprovedAmount"
  ): InsufficientBalances =>
    tokenAndIdentifierAndAmountNeeded
      .filter(([token, identifierOrCriteria, amountNeeded]) =>
        findBalanceAndApproval(
          balancesAndApprovals,
          token,
          identifierOrCriteria
        )[filterKey].lt(amountNeeded)
      )
      .map(([token, identifierOrCriteria, amount]) => {
        const balanceAndApproval = findBalanceAndApproval(
          balancesAndApprovals,
          token,
          identifierOrCriteria
        );

        return {
          token,
          identifierOrCriteria,
          requiredAmount: amount,
          amountHave: balanceAndApproval[filterKey],
          itemType: balanceAndApproval.itemType,
        };
      });

  const mapToApproval = (
    insufficientBalance: InsufficientBalances[number]
  ): InsufficientApprovals[number] => ({
    token: insufficientBalance.token,
    identifierOrCriteria: insufficientBalance.identifierOrCriteria,
    approvedAmount: insufficientBalance.amountHave,
    requiredApprovedAmount: insufficientBalance.requiredAmount,
    itemType: insufficientBalance.itemType,
    operator: "",
  });

  const [
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  ] = [
    filterBalancesOrApprovals("balance"),
    filterBalancesOrApprovals("ownerApprovedAmount").map(mapToApproval),
    filterBalancesOrApprovals("proxyApprovedAmount").map(mapToApproval),
  ];

  const mapOperator = (insufficientApproval: InsufficientApprovals[number]) => {
    // We always use consideration contract as the operator for ERC-20s
    const operator = isErc20Item(insufficientApproval.itemType)
      ? considerationContract.address
      : useProxyFromApprovals({
          insufficientOwnerApprovals,
          insufficientProxyApprovals,
          proxyStrategy,
        })
      ? proxy
      : considerationContract.address;

    return { ...insufficientApproval, operator };
  };

  return {
    insufficientBalances,
    insufficientOwnerApprovals: insufficientOwnerApprovals.map(mapOperator),
    insufficientProxyApprovals: insufficientProxyApprovals.map(mapOperator),
  };
};

/**
 * 1. The offerer should have sufficient balance of all offered items.
 * 2. If the order does not indicate proxy utilization, the offerer should have sufficient approvals set
 *    for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 3. If the order does indicate proxy utilization, the offerer should have sufficient approvals set
 *    for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const validateOfferBalancesAndApprovals = (
  {
    offer,
    orderType,
    criterias,
  }: Pick<OrderParameters, "offer" | "orderType"> & {
    criterias: InputCriteria[];
  },
  {
    balancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientBalances = true,
    throwOnInsufficientApprovals,
    considerationContract,
    proxy,
    proxyStrategy,
  }: {
    balancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams?: TimeBasedItemParams;
    throwOnInsufficientBalances?: boolean;
    throwOnInsufficientApprovals?: boolean;
    considerationContract: Consideration;
    proxy: string;
    proxyStrategy: ProxyStrategy;
  }
): InsufficientApprovals => {
  const {
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  } = getInsufficientBalanceAndApprovalAmounts(
    balancesAndApprovals,
    getSummedTokenAndIdentifierAmounts(offer, {
      criterias,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: false }
        : undefined,
    }),
    { considerationContract, proxy, proxyStrategy }
  );

  if (throwOnInsufficientBalances && insufficientBalances.length > 0) {
    throw new Error(
      "The offerer does not have the amount needed to create or fulfill."
    );
  }

  const approvalsToCheck = useOffererProxy(orderType)
    ? insufficientProxyApprovals
    : insufficientOwnerApprovals;

  if (throwOnInsufficientApprovals && approvalsToCheck.length > 0) {
    throw new Error("The offerer does not have the sufficient approvals.");
  }

  return approvalsToCheck;
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
    considerationContract,
    offererProxy,
    fulfillerProxy,
    proxyStrategy,
  }: {
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    considerationContract: Consideration;
    offererProxy: string;
    fulfillerProxy: string;
    proxyStrategy: ProxyStrategy;
  }
) => {
  validateOfferBalancesAndApprovals(
    { offer, orderType, criterias: [] },
    {
      balancesAndApprovals: offererBalancesAndApprovals,
      timeBasedItemParams,
      throwOnInsufficientApprovals: true,
      considerationContract,
      proxy: offererProxy,
      proxyStrategy,
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
    getSummedTokenAndIdentifierAmounts(considerationWithoutOfferItemType, {
      criterias: [],
      timeBasedItemParams: {
        ...timeBasedItemParams,
        isConsiderationItem: true,
      },
    }),
    { considerationContract, proxy: fulfillerProxy, proxyStrategy }
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The fulfiller does not have the balances needed to fulfill."
    );
  }

  return { insufficientOwnerApprovals, insufficientProxyApprovals };
};

/**
 * When fulfilling a standard order, the following requirements need to be checked to ensure that the order will be fulfillable:
 * 1. Offer checks need to be performed to ensure that the offerer still has sufficient balance and approvals
 * 2. The fulfiller should have sufficient balance of all consideration items after receiving all offered items
 *    — by way of example, if the fulfilled order offers an ERC20 item and requires an ERC721 item to the offerer
 *    and the same ERC20 item to another recipient with an amount less than or equal to the offered amount,
 *    the fulfiller does not need to own the ERC20 item as it will first be received from the offerer.
 * 3. If the fulfiller does not elect to utilize a proxy, they need to have sufficient approvals set for the
 *    Consideration contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order.
 * 4. If the fulfiller does elect to utilize a proxy, they need to have sufficient approvals set for their
 *    respective proxy contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order.
 * 5. If the fulfilled order specifies Ether (or other native tokens) as consideration items, the fulfiller must
 *    be able to supply the sum total of those items as msg.value.
 *
 * @returns the list of insufficient owner and proxy approvals
 */
export const validateStandardFulfillBalancesAndApprovals = (
  {
    offer,
    orderType,
    consideration,
    offerCriteria,
    considerationCriteria,
  }: Pick<OrderParameters, "offer" | "orderType" | "consideration"> & {
    offerCriteria: InputCriteria[];
    considerationCriteria: InputCriteria[];
  },
  {
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    considerationContract,
    offererProxy,
    fulfillerProxy,
    proxyStrategy,
  }: {
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    considerationContract: Consideration;
    offererProxy: string;
    fulfillerProxy: string;
    proxyStrategy: ProxyStrategy;
  }
) => {
  validateOfferBalancesAndApprovals(
    { offer, orderType, criterias: offerCriteria },
    {
      balancesAndApprovals: offererBalancesAndApprovals,
      timeBasedItemParams,
      throwOnInsufficientApprovals: true,
      considerationContract,
      proxy: offererProxy,
      proxyStrategy,
    }
  );

  const fulfillerBalancesAndApprovalsAfterReceivingOfferedItems =
    addToExistingBalances({
      items: offer,
      criterias: offerCriteria,
      balancesAndApprovals: fulfillerBalancesAndApprovals,
      timeBasedItemParams,
    });

  const {
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  } = getInsufficientBalanceAndApprovalAmounts(
    fulfillerBalancesAndApprovalsAfterReceivingOfferedItems,
    getSummedTokenAndIdentifierAmounts(consideration, {
      criterias: considerationCriteria,
      timeBasedItemParams: {
        ...timeBasedItemParams,
        isConsiderationItem: true,
      },
    }),
    { considerationContract, proxy: fulfillerProxy, proxyStrategy }
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The fulfiller does not have the balances needed to fulfill."
    );
  }

  return { insufficientOwnerApprovals, insufficientProxyApprovals };
};

const addToExistingBalances = ({
  items,
  criterias,
  timeBasedItemParams,
  balancesAndApprovals,
}: {
  items: Item[];
  criterias: InputCriteria[];
  timeBasedItemParams: TimeBasedItemParams;
  balancesAndApprovals: BalancesAndApprovals;
}) => {
  const summedItemAmounts = getSummedTokenAndIdentifierAmounts(items, {
    criterias,
    timeBasedItemParams: { ...timeBasedItemParams, isConsiderationItem: false },
  });

  // Deep clone existing balances
  const balancesAndApprovalsAfterReceivingItems = balancesAndApprovals.map(
    (item) => ({ ...item })
  );

  // Add each summed item amount to the existing balances as we may want tocheck balances after receiving all items
  Object.entries(summedItemAmounts).forEach(
    ([token, identifierOrCriteriaToAmount]) =>
      Object.entries(identifierOrCriteriaToAmount).forEach(
        ([identifierOrCriteria, amount]) => {
          const balanceAndApproval = findBalanceAndApproval(
            balancesAndApprovalsAfterReceivingItems,
            token,
            identifierOrCriteria
          );

          const balanceAndApprovalIndex =
            balancesAndApprovalsAfterReceivingItems.indexOf(balanceAndApproval);

          balancesAndApprovalsAfterReceivingItems[
            balanceAndApprovalIndex
          ].balance =
            balancesAndApprovalsAfterReceivingItems[
              balanceAndApprovalIndex
            ].balance.add(amount);
        }
      )
  );

  return balancesAndApprovalsAfterReceivingItems;
};
