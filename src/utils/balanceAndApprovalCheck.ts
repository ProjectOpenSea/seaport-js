import type { ethers } from "ethers"
import { type ItemType, MAX_INT } from "../constants"
import type { InputCriteria, Item, OrderParameters } from "../types"
import { approvedItemAmount } from "./approval"
import { balanceOf } from "./balance"
import { getItemToCriteriaMap } from "./criteria"
import {
  getSummedTokenAndIdentifierAmounts,
  isErc20Item,
  isErc721Item,
  isErc1155Item,
  type TimeBasedItemParams,
} from "./item"

export type BalancesAndApprovals = {
  token: string
  identifierOrCriteria: string
  balance: bigint
  approvedAmount: bigint
  itemType: ItemType
}[]

export type InsufficientBalances = {
  token: string
  identifierOrCriteria: string
  requiredAmount: bigint
  amountHave: bigint
  itemType: ItemType
}[]

export type InsufficientApprovals = {
  token: string
  identifierOrCriteria: string
  approvedAmount: bigint
  requiredApprovedAmount: bigint
  operator: string
  itemType: ItemType
}[]

const findBalanceAndApproval = (
  balancesAndApprovals: BalancesAndApprovals,
  token: string,
  identifierOrCriteria: string,
) => {
  const balanceAndApproval = balancesAndApprovals.find(
    ({
      token: checkedToken,
      identifierOrCriteria: checkedIdentifierOrCriteria,
    }) =>
      token.toLowerCase() === checkedToken.toLowerCase() &&
      checkedIdentifierOrCriteria.toLowerCase() ===
        identifierOrCriteria.toLowerCase(),
  )

  if (!balanceAndApproval) {
    throw new Error(
      `Checking for balance and approvals for token ${token} id ${identifierOrCriteria} failed`,
    )
  }

  return balanceAndApproval
}

export const getBalancesAndApprovals = async ({
  owner,
  items,
  criterias,
  operator,
  provider,
}: {
  owner: string
  items: Item[]
  criterias: InputCriteria[]
  operator: string
  provider: ethers.Provider
}): Promise<BalancesAndApprovals> => {
  const itemToCriteria = getItemToCriteriaMap(items, criterias)

  return Promise.all(
    items.map(async item => {
      let approvedAmount = 0n

      if (isErc721Item(item.itemType) || isErc1155Item(item.itemType)) {
        approvedAmount = await approvedItemAmount(
          owner,
          item,
          operator,
          provider,
        )
      } else if (isErc20Item(item.itemType)) {
        approvedAmount = await approvedItemAmount(
          owner,
          item,
          operator,
          provider,
        )
      } else {
        // If native token, we don't need to check for approvals
        approvedAmount = MAX_INT
      }

      return {
        token: item.token,
        identifierOrCriteria:
          itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
        balance: await balanceOf(
          owner,
          item,
          provider,
          itemToCriteria.get(item),
        ),
        approvedAmount,
        itemType: item.itemType,
      }
    }),
  )
}

export const getInsufficientBalanceAndApprovalAmounts = ({
  balancesAndApprovals,
  tokenAndIdentifierAmounts,
  operator,
}: {
  balancesAndApprovals: BalancesAndApprovals
  tokenAndIdentifierAmounts: ReturnType<
    typeof getSummedTokenAndIdentifierAmounts
  >
  operator: string
}): {
  insufficientBalances: InsufficientBalances
  insufficientApprovals: InsufficientApprovals
} => {
  const tokenAndIdentifierAndAmountNeeded = [
    ...Object.entries(tokenAndIdentifierAmounts).map(
      ([token, identifierToAmount]) =>
        Object.entries(identifierToAmount).map(
          ([identifierOrCriteria, amountNeeded]) =>
            [token, identifierOrCriteria, amountNeeded] as const,
        ),
    ),
  ].flat()

  const filterBalancesOrApprovals = (
    filterKey: "balance" | "approvedAmount",
  ): InsufficientBalances =>
    tokenAndIdentifierAndAmountNeeded
      .filter(
        ([token, identifierOrCriteria, amountNeeded]) =>
          findBalanceAndApproval(
            balancesAndApprovals,
            token,
            identifierOrCriteria,
          )[filterKey] < amountNeeded,
      )
      .map(([token, identifierOrCriteria, amount]) => {
        const balanceAndApproval = findBalanceAndApproval(
          balancesAndApprovals,
          token,
          identifierOrCriteria,
        )

        return {
          // Report the address as the order carried it, not as the summation
          // keyed it. `token` here is a key from getSummedTokenAndIdentifierAmounts,
          // which lowercases so that two casings of one address sum into a
          // single bucket. That key is an internal grouping detail; it reaches
          // callers through InsufficientApprovals -> ApprovalAction.token, so
          // using it here silently lowercased every approval action's token and
          // broke consumers comparing against a checksummed address.
          token: balanceAndApproval.token,
          identifierOrCriteria,
          requiredAmount: amount,
          amountHave: balanceAndApproval[filterKey],
          itemType: balanceAndApproval.itemType,
        }
      })

  const mapToApproval = (
    insufficientBalance: InsufficientBalances[number],
  ): InsufficientApprovals[number] => ({
    token: insufficientBalance.token,
    identifierOrCriteria: insufficientBalance.identifierOrCriteria,
    approvedAmount: insufficientBalance.amountHave,
    requiredApprovedAmount: insufficientBalance.requiredAmount,
    itemType: insufficientBalance.itemType,
    operator,
  })

  const [insufficientBalances, insufficientApprovals] = [
    filterBalancesOrApprovals("balance"),
    filterBalancesOrApprovals("approvedAmount").map(mapToApproval),
  ]

  return {
    insufficientBalances,
    insufficientApprovals,
  }
}

/**
 * 1. The offerer should have sufficient balance of all offered items.
 * 2. If the order does not indicate proxy utilization, the offerer should have sufficient approvals set
 *    for the Seaport contract for all offered ERC20, ERC721, and ERC1155 items.
 * 3. If the order does indicate proxy utilization, the offerer should have sufficient approvals set
 *    for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const validateOfferBalancesAndApprovals = ({
  offer,
  criterias,
  balancesAndApprovals,
  timeBasedItemParams,
  throwOnInsufficientBalances = true,
  throwOnInsufficientApprovals,
  operator,
}: {
  balancesAndApprovals: BalancesAndApprovals
  timeBasedItemParams?: TimeBasedItemParams
  throwOnInsufficientBalances?: boolean
  throwOnInsufficientApprovals?: boolean
  operator: string
} & Pick<OrderParameters, "offer"> & {
    criterias: InputCriteria[]
  }): InsufficientApprovals => {
  const { insufficientBalances, insufficientApprovals } =
    getInsufficientBalanceAndApprovalAmounts({
      balancesAndApprovals,
      tokenAndIdentifierAmounts: getSummedTokenAndIdentifierAmounts({
        items: offer,
        criterias,
        timeBasedItemParams: timeBasedItemParams
          ? { ...timeBasedItemParams, isConsiderationItem: false }
          : undefined,
      }),
      operator,
    })

  if (throwOnInsufficientBalances && insufficientBalances.length > 0) {
    throw new Error(
      "The offerer does not have the amount needed to create or fulfill.",
    )
  }

  if (throwOnInsufficientApprovals && insufficientApprovals.length > 0) {
    throw new Error("The offerer does not have the sufficient approvals.")
  }

  return insufficientApprovals
}

/**
 * When fulfilling a basic order, the following requirements need to be checked to ensure that the order will be fulfillable:
 * 1. Offer checks need to be performed to ensure that the offerer still has sufficient balance and approvals
 * 2. The fulfiller should have sufficient balance of all consideration items except for those with an
 *    item type that matches the order's offered item type — by way of example, if the fulfilled order offers
 *    an ERC20 item and requires an ERC721 item to the offerer and the same ERC20 item to another recipient,
 *    the fulfiller needs to own the ERC721 item but does not need to own the ERC20 item as it will be sourced from the offerer.
 * 3. If the fulfiller does not elect to utilize a proxy, they need to have sufficient approvals set for the
 *    Seaport contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order except
 *    for ERC20 items with an item type that matches the order's offered item type.
 * 4. If the fulfiller does elect to utilize a proxy, they need to have sufficient approvals set for their
 *    respective proxy contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order
 *    except for ERC20 items with an item type that matches the order's offered item type.
 * 5. If the fulfilled order specifies Ether (or other native tokens) as consideration items, the fulfiller must
 *    be able to supply the sum total of those items as msg.value.
 *
 * @returns the list of insufficient owner and proxy approvals
 */
export const validateBasicFulfillBalancesAndApprovals = ({
  offer,
  consideration,
  offererBalancesAndApprovals,
  fulfillerBalancesAndApprovals,
  timeBasedItemParams,
  offererOperator,
  fulfillerOperator,
}: {
  offererBalancesAndApprovals: BalancesAndApprovals
  fulfillerBalancesAndApprovals: BalancesAndApprovals
  timeBasedItemParams: TimeBasedItemParams
  offererOperator: string
  fulfillerOperator: string
} & Pick<OrderParameters, "offer" | "consideration">) => {
  validateOfferBalancesAndApprovals({
    offer,
    criterias: [],
    balancesAndApprovals: offererBalancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientApprovals: true,
    operator: offererOperator,
  })

  const considerationWithoutOfferItemType = consideration.filter(
    item => item.itemType !== offer[0].itemType,
  )

  const { insufficientBalances, insufficientApprovals } =
    getInsufficientBalanceAndApprovalAmounts({
      balancesAndApprovals: fulfillerBalancesAndApprovals,
      tokenAndIdentifierAmounts: getSummedTokenAndIdentifierAmounts({
        items: considerationWithoutOfferItemType,
        criterias: [],
        timeBasedItemParams: {
          ...timeBasedItemParams,
          isConsiderationItem: true,
        },
      }),
      operator: fulfillerOperator,
    })

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The fulfiller does not have the balances needed to fulfill.",
    )
  }

  return insufficientApprovals
}

/**
 * When fulfilling a standard order, the following requirements need to be checked to ensure that the order will be fulfillable:
 * 1. Offer checks need to be performed to ensure that the offerer still has sufficient balance and approvals
 * 2. The fulfiller should have sufficient balance of all consideration items after receiving all offered items
 *    — by way of example, if the fulfilled order offers an ERC20 item and requires an ERC721 item to the offerer
 *    and the same ERC20 item to another recipient with an amount less than or equal to the offered amount,
 *    the fulfiller does not need to own the ERC20 item as it will first be received from the offerer.
 * 3. If the fulfiller does not elect to utilize a proxy, they need to have sufficient approvals set for the
 *    Seaport contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order.
 * 4. If the fulfiller does elect to utilize a proxy, they need to have sufficient approvals set for their
 *    respective proxy contract for all ERC20, ERC721, and ERC1155 consideration items on the fulfilled order.
 * 5. If the fulfilled order specifies Ether (or other native tokens) as consideration items, the fulfiller must
 *    be able to supply the sum total of those items as msg.value.
 *
 * @returns the list of insufficient owner and proxy approvals
 */
/**
 * Check the fulfiller can cover a whole batch, not just each order in it.
 *
 * `fulfillOrders` validates every order against the same un-decremented
 * balances, so a fulfiller who can afford each order individually but not all
 * of them together was handed a transaction that cannot succeed, with no error.
 *
 * Currency the batch pays the fulfiller is credited, because it is load-bearing:
 * accepting a bid means its ERC20 fee items sit in the consideration the
 * fulfiller owes while being funded by the bid's own ERC20 offer. The per-order
 * check handles that by crediting each order's offer before checking its
 * consideration, and this has to match, or every offer-fulfillment batch would
 * be rejected. Note the credit is batch-wide while the per-order check is
 * per-order, so this is the looser of the two and cannot reject anything the
 * per-order check accepts for a reason other than the batch total.
 *
 * Scoped to ERC20 deliberately. Native balances cannot be checked without
 * modelling gas, and an over-strict check here would block a working batch,
 * which is worse than the silence it replaces. A token with no entry is skipped
 * for the same reason.
 */
export const validateCumulativeFulfillerBalances = ({
  requiredAmounts,
  receivedAmounts,
  fulfillerBalancesAndApprovals,
}: {
  requiredAmounts: Record<string, Record<string, bigint>>
  receivedAmounts: Record<string, Record<string, bigint>>
  fulfillerBalancesAndApprovals: BalancesAndApprovals
}) => {
  for (const [token, identifierToAmount] of Object.entries(requiredAmounts)) {
    for (const [identifierOrCriteria, required] of Object.entries(
      identifierToAmount,
    )) {
      const balanceAndApproval = fulfillerBalancesAndApprovals.find(
        entry =>
          entry.token.toLowerCase() === token.toLowerCase() &&
          entry.identifierOrCriteria === identifierOrCriteria,
      )
      if (!balanceAndApproval || !isErc20Item(balanceAndApproval.itemType)) {
        continue
      }
      const received = receivedAmounts[token]?.[identifierOrCriteria] ?? 0n
      if (balanceAndApproval.balance + received < required) {
        throw new Error(
          "The fulfiller does not have the balances needed to fulfill.",
        )
      }
    }
  }
}

export const validateStandardFulfillBalancesAndApprovals = ({
  offer,
  consideration,
  offerCriteria,
  considerationCriteria,
  offererBalancesAndApprovals,
  fulfillerBalancesAndApprovals,
  timeBasedItemParams,
  offererOperator,
  fulfillerOperator,
  offerItemsGoToFulfiller = true,
}: Pick<OrderParameters, "offer" | "consideration"> & {
  offerCriteria: InputCriteria[]
  considerationCriteria: InputCriteria[]
  offererBalancesAndApprovals: BalancesAndApprovals
  fulfillerBalancesAndApprovals: BalancesAndApprovals
  timeBasedItemParams: TimeBasedItemParams
  offererOperator: string
  fulfillerOperator: string
  offerItemsGoToFulfiller?: boolean
}) => {
  validateOfferBalancesAndApprovals({
    offer,
    criterias: offerCriteria,
    balancesAndApprovals: offererBalancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientApprovals: true,
    operator: offererOperator,
  })

  // Requirement 2 above only holds while the offered items land with the
  // fulfiller. When they are forwarded to someone else, the fulfiller never
  // receives them and has to cover every consideration item out of what they
  // already hold, so crediting the offer here would clear a fulfillment that
  // reverts on transfer.
  const fulfillerBalancesAndApprovalsAfterReceivingOfferedItems =
    offerItemsGoToFulfiller
      ? addToExistingBalances({
          items: offer,
          criterias: offerCriteria,
          balancesAndApprovals: fulfillerBalancesAndApprovals,
          timeBasedItemParams,
        })
      : fulfillerBalancesAndApprovals

  const { insufficientBalances, insufficientApprovals } =
    getInsufficientBalanceAndApprovalAmounts({
      balancesAndApprovals:
        fulfillerBalancesAndApprovalsAfterReceivingOfferedItems,
      tokenAndIdentifierAmounts: getSummedTokenAndIdentifierAmounts({
        items: consideration,
        criterias: considerationCriteria,
        timeBasedItemParams: {
          ...timeBasedItemParams,
          isConsiderationItem: true,
        },
      }),
      operator: fulfillerOperator,
    })

  if (insufficientBalances.length > 0) {
    throw new Error(
      "The fulfiller does not have the balances needed to fulfill.",
    )
  }

  return insufficientApprovals
}

const addToExistingBalances = ({
  items,
  criterias,
  timeBasedItemParams,
  balancesAndApprovals,
}: {
  items: Item[]
  criterias: InputCriteria[]
  timeBasedItemParams: TimeBasedItemParams
  balancesAndApprovals: BalancesAndApprovals
}) => {
  const summedItemAmounts = getSummedTokenAndIdentifierAmounts({
    items,
    criterias,
    timeBasedItemParams: { ...timeBasedItemParams, isConsiderationItem: false },
  })

  // Deep clone existing balances
  const balancesAndApprovalsAfterReceivingItems = balancesAndApprovals.map(
    item => ({ ...item }),
  )

  // Add each summed item amount to the existing balances as we may want to check balances after receiving all items
  Object.entries(summedItemAmounts).forEach(
    ([token, identifierOrCriteriaToAmount]) =>
      Object.entries(identifierOrCriteriaToAmount).forEach(
        ([identifierOrCriteria, amount]) => {
          const balanceAndApproval = findBalanceAndApproval(
            balancesAndApprovalsAfterReceivingItems,
            token,
            identifierOrCriteria,
          )

          const balanceAndApprovalIndex =
            balancesAndApprovalsAfterReceivingItems.indexOf(balanceAndApproval)

          balancesAndApprovalsAfterReceivingItems[
            balanceAndApprovalIndex
          ].balance =
            balancesAndApprovalsAfterReceivingItems[balanceAndApprovalIndex]
              .balance + amount
        },
      ),
  )

  return balancesAndApprovalsAfterReceivingItems
}
