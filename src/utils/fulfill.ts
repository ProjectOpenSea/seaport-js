import {
  type BigNumberish,
  ethers,
  type Overrides,
  type Signer,
  type TransactionResponse,
} from "ethers"
import { BasicOrderRouteType, ItemType, NO_CONDUIT } from "../constants"
import type {
  BasicOrderParametersStruct,
  FulfillmentComponentStruct,
  OrderStruct,
} from "../typechain-types/seaport/contracts/Seaport"
import type {
  AdvancedOrder,
  ConsiderationItem,
  ExchangeAction,
  InputCriteria,
  Order,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
  OrderWithCounter,
  SeaportContract,
} from "../types"
import { getApprovalActions, getApprovalDedupKey } from "./approval"
import {
  type BalancesAndApprovals,
  type InsufficientApprovals,
  validateBasicFulfillBalancesAndApprovals,
  validateCumulativeFulfillerBalances,
  validateStandardFulfillBalancesAndApprovals,
} from "./balanceAndApprovalCheck"
import { generateCriteriaResolvers, getItemToCriteriaMap } from "./criteria"
import { gcd } from "./gcd"
import {
  getMaximumSizeForOrder,
  getSummedTokenAndIdentifierAmounts,
  isCriteriaItem,
  isCurrencyItem,
  isErc721Item,
  isNativeCurrencyItem,
  type TimeBasedItemParams,
} from "./item"
import {
  areAllCurrenciesSame,
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
  mapTipAmountsFromFilledStatus,
  mapTipAmountsFromUnitsToFill,
  totalItemsAmount,
} from "./order"
import {
  type ContractMethodReturnType,
  executeAllActions,
  executeApprovals,
  getTransactionMethods,
} from "./usecase"

/**
 * We should use basic fulfill order if the order adheres to the following criteria:
 * 1. The order should not be partially filled.
 * 2. The order only contains a single offer item and contains at least one consideration item
 * 3. The order does not offer an item with Ether (or other native tokens) as its item type.
 * 4. The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
 * 5. All other items have the same Native or ERC20 item type and token
 * 6. All items have the same startAmount and endAmount
 * 7. First consideration item must contain the offerer as the recipient
 * 8. If the order has multiple consideration items and all consideration items other than the
 *    first consideration item have the same item type as the offered item, the offered item
 *    amount is not less than the sum of all consideration item amounts excluding the
 *    first consideration item amount
 * 9. The token on native currency items needs to be set to the null address and the identifier on
 *    currencies needs to be zero, and the amounts on the 721 item need to be 1
 */
export const shouldUseBasicFulfill = (
  { offer, consideration, offerer }: OrderParameters,
  totalFilled: OrderStatus["totalFilled"],
  tips: ConsiderationItem[] = [],
) => {
  // 1. The order must not be partially filled
  if (totalFilled !== 0n) {
    return false
  }

  // 2. Must be single offer and at least one consideration
  if (offer.length > 1 || consideration.length === 0) {
    return false
  }

  // Tips are passed to Seaport as additional recipients on the basic order, so
  // they have to satisfy the same constraints as the order's own consideration.
  const considerationIncludingTips = [...consideration, ...tips]

  const allItems = [...offer, ...considerationIncludingTips]

  const nfts = allItems.filter(({ itemType }) =>
    [ItemType.ERC721, ItemType.ERC1155].includes(itemType),
  )

  const nftsWithCriteria = allItems.filter(({ itemType }) =>
    isCriteriaItem(itemType),
  )

  const offersNativeCurrency = isNativeCurrencyItem(offer[0])

  // 3. The order does not offer an item with Ether (or other native tokens) as its item type.
  if (offersNativeCurrency) {
    return false
  }

  // 4. The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
  if (nfts.length !== 1 || nftsWithCriteria.length !== 0) {
    return false
  }

  // 5. All currencies need to have the same address and item type (Native, ERC20)
  if (
    !areAllCurrenciesSame({
      offer,
      consideration: considerationIncludingTips,
    })
  ) {
    return false
  }

  // 6. All individual items need to have the same startAmount and endAmount
  const differentStartAndEndAmount = allItems.some(
    ({ startAmount, endAmount }) => startAmount !== endAmount,
  )

  if (differentStartAndEndAmount) {
    return false
  }

  const [firstConsideration, ...restConsideration] = considerationIncludingTips

  // 7. First consideration item must contain the offerer as the recipient
  const firstConsiderationRecipientIsNotOfferer =
    firstConsideration.recipient.toLowerCase() !== offerer.toLowerCase()

  if (firstConsiderationRecipientIsNotOfferer) {
    return false
  }

  // 8. If the order has multiple consideration items and all consideration items other than the
  // first consideration item have the same item type as the offered item, the offered item
  // amount is not less than the sum of all consideration item amounts excluding the
  // first consideration item amount
  if (
    considerationIncludingTips.length > 1 &&
    restConsideration.every(item => item.itemType === offer[0].itemType) &&
    totalItemsAmount(restConsideration).endAmount > BigInt(offer[0].endAmount)
  ) {
    return false
  }

  const currencies = allItems.filter(isCurrencyItem)

  //  9. The token on native currency items needs to be set to the null address and the identifier on
  //  currencies needs to be zero, and the amounts on the 721 item need to be 1
  const nativeCurrencyIsZeroAddress = currencies
    .filter(({ itemType }) => itemType === ItemType.NATIVE)
    .every(({ token }) => token === ethers.ZeroAddress)

  const currencyIdentifiersAreZero = currencies.every(
    ({ identifierOrCriteria }) => BigInt(identifierOrCriteria) === 0n,
  )

  const erc721sAreSingleAmount = nfts
    .filter(({ itemType }) => itemType === ItemType.ERC721)
    .every(({ endAmount }) => endAmount === "1")

  return (
    nativeCurrencyIsZeroAddress &&
    currencyIdentifiersAreZero &&
    erc721sAreSingleAmount
  )
}

const offerAndConsiderationFulfillmentMapping: {
  [_key in ItemType]?: { [_key in ItemType]?: BasicOrderRouteType }
} = {
  [ItemType.ERC20]: {
    [ItemType.ERC721]: BasicOrderRouteType.ERC721_TO_ERC20,
    [ItemType.ERC1155]: BasicOrderRouteType.ERC1155_TO_ERC20,
  },
  [ItemType.ERC721]: {
    [ItemType.NATIVE]: BasicOrderRouteType.ETH_TO_ERC721,
    [ItemType.ERC20]: BasicOrderRouteType.ERC20_TO_ERC721,
  },
  [ItemType.ERC1155]: {
    [ItemType.NATIVE]: BasicOrderRouteType.ETH_TO_ERC1155,
    [ItemType.ERC20]: BasicOrderRouteType.ERC20_TO_ERC1155,
  },
} as const

export function fulfillBasicOrder(
  {
    order,
    seaportContract,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    offererOperator,
    fulfillerOperator,
    signer,
    tips = [],
    conduitKey = NO_CONDUIT,
    domain,
    overrides,
  }: {
    order: Order
    seaportContract: SeaportContract
    offererBalancesAndApprovals: BalancesAndApprovals
    fulfillerBalancesAndApprovals: BalancesAndApprovals
    timeBasedItemParams: TimeBasedItemParams
    offererOperator: string
    fulfillerOperator: string
    signer: Signer
    tips?: ConsiderationItem[]
    conduitKey: string
    domain?: string
    overrides?: Overrides
  },
  exactApproval: boolean,
): OrderUseCase<
  ExchangeAction<ContractMethodReturnType<SeaportContract, "fulfillBasicOrder">>
> {
  const { offer, consideration } = order.parameters
  const considerationIncludingTips = [...consideration, ...tips]

  const offerItem = offer[0]
  const [forOfferer, ...forAdditionalRecipients] = considerationIncludingTips

  const basicOrderRouteType =
    offerAndConsiderationFulfillmentMapping[offerItem.itemType]?.[
      forOfferer.itemType
    ]

  if (basicOrderRouteType === undefined) {
    throw new Error(
      "Order parameters did not result in a valid basic fulfillment",
    )
  }

  const additionalRecipients = forAdditionalRecipients.map(
    ({ startAmount, recipient }) => ({
      amount: startAmount,
      recipient,
    }),
  )

  const considerationWithoutOfferItemType = considerationIncludingTips.filter(
    item => item.itemType !== offer[0].itemType,
  )

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts({
    items: considerationWithoutOfferItemType,
    criterias: [],
    timeBasedItemParams: {
      ...timeBasedItemParams,
      isConsiderationItem: true,
    },
  })[ethers.ZeroAddress]?.["0"]

  const insufficientApprovals = validateBasicFulfillBalancesAndApprovals({
    offer,
    consideration: considerationIncludingTips,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    offererOperator,
    fulfillerOperator,
  })

  const basicOrderParameters: BasicOrderParametersStruct = {
    offerer: order.parameters.offerer,
    offererConduitKey: order.parameters.conduitKey,
    zone: order.parameters.zone,
    //  Note the use of a "basicOrderType" enum;
    //  this represents both the usual order type as well as the "route"
    //  of the basic order (a simple derivation function for the basic order
    //  type is `basicOrderType = orderType + (4 * basicOrderRoute)`.)
    basicOrderType: order.parameters.orderType + 4 * basicOrderRouteType,
    offerToken: offerItem.token,
    offerIdentifier: offerItem.identifierOrCriteria,
    offerAmount: offerItem.endAmount,
    considerationToken: forOfferer.token,
    considerationIdentifier: forOfferer.identifierOrCriteria,
    considerationAmount: forOfferer.endAmount,
    startTime: order.parameters.startTime,
    endTime: order.parameters.endTime,
    salt: order.parameters.salt,
    totalOriginalAdditionalRecipients:
      order.parameters.consideration.length - 1,
    signature: order.signature,
    fulfillerConduitKey: conduitKey,
    additionalRecipients,
    zoneHash: order.parameters.zoneHash,
  }

  overrides = { ...overrides, value: totalNativeAmount }

  const approvalActions = getApprovalActions(
    insufficientApprovals,
    exactApproval,
    signer,
  )

  const exchangeAction = {
    type: "exchange",
    transactionMethods: getTransactionMethods(
      signer,
      seaportContract,
      "fulfillBasicOrder",
      [basicOrderParameters, overrides],
      domain,
    ),
  } as const

  const actions = [...approvalActions, exchangeAction] as const

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<TransactionResponse>,
    executeApprovals: () => executeApprovals(actions),
  }
}

export function fulfillStandardOrder(
  {
    order,
    unitsToFill = 0,
    totalSize,
    totalFilled,
    offerCriteria,
    considerationCriteria,
    tips = [],
    extraData,
    seaportContract,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    offererOperator,
    fulfillerOperator,
    timeBasedItemParams,
    conduitKey,
    recipientAddress,
    fulfillerAddress,
    signer,
    domain,
    overrides,
  }: {
    order: Order
    unitsToFill?: BigNumberish
    totalFilled: bigint
    totalSize: bigint
    offerCriteria: InputCriteria[]
    considerationCriteria: InputCriteria[]
    tips?: ConsiderationItem[]
    extraData?: string
    seaportContract: SeaportContract
    offererBalancesAndApprovals: BalancesAndApprovals
    fulfillerBalancesAndApprovals: BalancesAndApprovals
    offererOperator: string
    fulfillerOperator: string
    conduitKey: string
    recipientAddress: string
    fulfillerAddress: string
    timeBasedItemParams: TimeBasedItemParams
    signer: Signer
    domain?: string
    overrides?: Overrides
  },
  exactApproval: boolean,
): OrderUseCase<
  ExchangeAction<
    ContractMethodReturnType<
      SeaportContract,
      "fulfillAdvancedOrder" | "fulfillOrder"
    >
  >
> {
  assertNoCriteriaTips(tips)

  if (unitsToFill) {
    unitsToFill = clampUnitsToRemaining(unitsToFill, { totalFilled, totalSize })
  }

  // If we are supplying units to fill, we adjust the order by the minimum of the amount to fill and
  // the remaining order left to be fulfilled
  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalSize,
      })
    : // Else, we adjust the order by the remaining order left to be fulfilled
      mapOrderAmountsFromFilledStatus(order, {
        totalFilled,
        totalSize,
      })

  let adjustedTips: ConsiderationItem[] = []

  if (tips.length > 0) {
    if (unitsToFill) {
      // mapOrderAmountsFromUnitsToFill resolves a totalSize of 0 (an order
      // that hasn't been partially filled yet) to the order's own maximum
      // size internally; tips must be scaled by that same resolved value,
      // or a raw totalSize of 0 passed straight through divides by zero.
      const resolvedTotalSize =
        totalSize === 0n ? getMaximumSizeForOrder(order) : totalSize
      adjustedTips = mapTipAmountsFromUnitsToFill(
        tips,
        unitsToFill,
        resolvedTotalSize,
      )
    } else {
      // mapTipAmountsFromFilledStatus already treats totalSize === 0n as
      // "leave unscaled", matching mapOrderAmountsFromFilledStatus above -
      // no resolution needed here.
      adjustedTips = mapTipAmountsFromFilledStatus(tips, totalFilled, totalSize)
    }
  }

  const {
    parameters: { offer, consideration },
  } = orderWithAdjustedFills

  const considerationIncludingTips = [...consideration, ...adjustedTips]

  const offerCriteriaItems = offer.filter(({ itemType }) =>
    isCriteriaItem(itemType),
  )

  const considerationCriteriaItems = considerationIncludingTips.filter(
    ({ itemType }) => isCriteriaItem(itemType),
  )

  const hasCriteriaItems =
    offerCriteriaItems.length > 0 || considerationCriteriaItems.length > 0

  if (
    offerCriteriaItems.length !== offerCriteria.length ||
    considerationCriteriaItems.length !== considerationCriteria.length
  ) {
    throw new Error(
      "You must supply the appropriate criterias for criteria based items",
    )
  }

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts({
    items: considerationIncludingTips,
    criterias: considerationCriteria,
    timeBasedItemParams: {
      ...timeBasedItemParams,
      isConsiderationItem: true,
    },
  })[ethers.ZeroAddress]?.["0"]

  const insufficientApprovals = validateStandardFulfillBalancesAndApprovals({
    offer,
    consideration: considerationIncludingTips,
    offerCriteria,
    considerationCriteria,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    offererOperator,
    fulfillerOperator,
    offerItemsGoToFulfiller: offerItemsLandWithFulfiller(
      recipientAddress,
      fulfillerAddress,
    ),
  })

  overrides = { ...overrides, value: totalNativeAmount }

  const approvalActions = getApprovalActions(
    insufficientApprovals,
    exactApproval,
    signer,
  )

  const isGift = recipientAddress !== ethers.ZeroAddress

  const useAdvanced = Boolean(unitsToFill) || hasCriteriaItems || isGift

  const orderAccountingForTips: OrderStruct = {
    ...order,
    parameters: {
      ...order.parameters,
      consideration: [...order.parameters.consideration, ...tips],
      totalOriginalConsiderationItems: consideration.length,
    },
  }

  const { numerator, denominator } = getAdvancedOrderNumeratorDenominator(
    order,
    unitsToFill,
  )

  const exchangeAction = {
    type: "exchange",
    transactionMethods: useAdvanced
      ? getTransactionMethods(
          signer,
          seaportContract,
          "fulfillAdvancedOrder",
          [
            {
              ...orderAccountingForTips,
              numerator,
              denominator,
              extraData: extraData ?? "0x",
            },
            hasCriteriaItems
              ? generateCriteriaResolvers({
                  orders: [order],
                  offerCriterias: [offerCriteria],
                  considerationCriterias: [considerationCriteria],
                })
              : [],
            conduitKey,
            recipientAddress,
            overrides,
          ],
          domain,
        )
      : getTransactionMethods(
          signer,
          seaportContract,
          "fulfillOrder",
          [orderAccountingForTips, conduitKey, overrides],
          domain,
        ),
  } as const

  const actions = [...approvalActions, exchangeAction] as const

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<TransactionResponse>,
    executeApprovals: () => executeApprovals(actions),
  }
}

/**
 * Whether the order's offered items end up with the fulfiller.
 *
 * `recipientAddress` forwards them somewhere else, with the zero address
 * meaning "leave them with the fulfiller". Naming the fulfiller explicitly is
 * the same thing, so it counts as landing with them too.
 */
export function offerItemsLandWithFulfiller(
  recipientAddress: string,
  fulfillerAddress: string,
): boolean {
  return (
    recipientAddress === ethers.ZeroAddress ||
    recipientAddress.toLowerCase() === fulfillerAddress.toLowerCase()
  )
}

export function validateAndSanitizeFromOrderStatus(
  order: Order,
  orderStatus: OrderStatus,
): Order {
  const { isValidated, isCancelled, totalFilled, totalSize } = orderStatus

  if (totalSize > 0n && totalFilled / totalSize === 1n) {
    throw new Error("The order you are trying to fulfill is already filled")
  }

  if (isCancelled) {
    throw new Error("The order you are trying to fulfill is cancelled")
  }

  if (isValidated) {
    // If the order is already validated, manually wipe the signature off of the order to save gas
    return { parameters: { ...order.parameters }, signature: "0x" }
  }

  return order
}

/**
 * Whether an order can still be filled at all.
 *
 * Mirrors the two rejections in `validateAndSanitizeFromOrderStatus`, which
 * throws so that a single-order fulfill fails loudly. A batch fulfill cannot
 * use that: `fulfillAvailableAdvancedOrders` skips orders it cannot fill and
 * settles the rest, so one stale order in the batch has to be dropped rather
 * than take the whole call down with it.
 */
export function isOrderFulfillable({
  isCancelled,
  totalFilled,
  totalSize,
}: OrderStatus): boolean {
  return !isCancelled && !(totalSize > 0n && totalFilled / totalSize === 1n)
}

export type FulfillOrdersMetadata = {
  order: Order
  unitsToFill?: BigNumberish
  orderStatus: OrderStatus
  offerCriteria: InputCriteria[]
  considerationCriteria: InputCriteria[]
  tips: ConsiderationItem[]
  extraData: string
  offererBalancesAndApprovals: BalancesAndApprovals
  offererOperator: string
}[]

export function fulfillAvailableOrders({
  ordersMetadata,
  seaportContract,
  fulfillerBalancesAndApprovals,
  fulfillerOperator,
  currentBlockTimestamp,
  ascendingAmountTimestampBuffer,
  conduitKey,
  signer,
  recipientAddress,
  fulfillerAddress,
  exactApproval,
  domain,
  overrides,
}: {
  ordersMetadata: FulfillOrdersMetadata
  seaportContract: SeaportContract
  fulfillerBalancesAndApprovals: BalancesAndApprovals
  fulfillerOperator: string
  currentBlockTimestamp: number
  ascendingAmountTimestampBuffer: number
  conduitKey: string
  signer: Signer
  recipientAddress: string
  fulfillerAddress: string
  exactApproval: boolean
  domain?: string
  overrides?: Overrides
}): OrderUseCase<
  ExchangeAction<
    ContractMethodReturnType<SeaportContract, "fulfillAvailableAdvancedOrders">
  >
> {
  ordersMetadata.forEach(({ tips }) => assertNoCriteriaTips(tips))

  // Drop the orders that cannot be filled instead of throwing on the first one.
  // Every array built below is indexed by position in this list, so the
  // fulfillments and criteria resolvers are derived from it too.
  const sanitizedOrdersMetadata = ordersMetadata
    .filter(({ orderStatus }) => isOrderFulfillable(orderStatus))
    .map(orderMetadata => ({
      ...orderMetadata,
      unitsToFill: orderMetadata.unitsToFill
        ? clampUnitsToRemaining(
            orderMetadata.unitsToFill,
            orderMetadata.orderStatus,
          )
        : orderMetadata.unitsToFill,
      order: validateAndSanitizeFromOrderStatus(
        orderMetadata.order,
        orderMetadata.orderStatus,
      ),
    }))

  if (sanitizedOrdersMetadata.length === 0) {
    throw new Error(
      "None of the orders can be fulfilled: every one is already filled or cancelled.",
    )
  }

  const adjustTips = (orderMetadata: {
    order: Order
    unitsToFill?: BigNumberish
    orderStatus: OrderStatus
    offerCriteria: InputCriteria[]
    considerationCriteria: InputCriteria[]
    tips: ConsiderationItem[]
    extraData: string
    offererBalancesAndApprovals: BalancesAndApprovals
    offererOperator: string
  }): ConsiderationItem[] => {
    if (!orderMetadata.tips?.length) {
      return []
    }

    if (orderMetadata.unitsToFill) {
      // mapOrderAmountsFromUnitsToFill (used just below for the order
      // itself) resolves a totalSize of 0 to the order's own maximum size
      // internally; tips must be scaled by that same resolved value, or a
      // raw totalSize of 0 passed straight through divides by zero.
      const resolvedTotalSize =
        orderMetadata.orderStatus.totalSize === 0n
          ? getMaximumSizeForOrder(orderMetadata.order)
          : orderMetadata.orderStatus.totalSize
      return mapTipAmountsFromUnitsToFill(
        orderMetadata.tips,
        orderMetadata.unitsToFill,
        resolvedTotalSize,
      )
    }
    // mapTipAmountsFromFilledStatus already treats totalSize === 0n as
    // "leave unscaled", matching mapOrderAmountsFromFilledStatus below - no
    // resolution needed here.
    return mapTipAmountsFromFilledStatus(
      orderMetadata.tips,
      orderMetadata.orderStatus.totalFilled,
      orderMetadata.orderStatus.totalSize,
    )
  }

  const ordersMetadataWithAdjustedFills = sanitizedOrdersMetadata.map(
    orderMetadata => ({
      ...orderMetadata,
      // If we are supplying units to fill, we adjust the order by the minimum of the amount to fill and
      // the remaining order left to be fulfilled
      order: orderMetadata.unitsToFill
        ? mapOrderAmountsFromUnitsToFill(orderMetadata.order, {
            unitsToFill: orderMetadata.unitsToFill,
            totalSize: orderMetadata.orderStatus.totalSize,
          })
        : // Else, we adjust the order by the remaining order left to be fulfilled
          mapOrderAmountsFromFilledStatus(orderMetadata.order, {
            totalFilled: orderMetadata.orderStatus.totalFilled,
            totalSize: orderMetadata.orderStatus.totalSize,
          }),
      tips: adjustTips(orderMetadata),
    }),
  )

  let totalNativeAmount = 0n
  const totalInsufficientApprovals: InsufficientApprovals = []
  // What the fulfiller owes across the WHOLE batch, per lowercased token and
  // identifier. Each order's own requirement is checked separately below, but
  // an ERC20 approval is one allowance shared by every order in the batch, so
  // the amount to approve is this total rather than any single order's share.
  const cumulativeFulfillerAmounts: Record<string, Record<string, bigint>> = {}
  // What the batch pays the fulfiller, which funds part of what it owes: a
  // bid's ERC20 fee items are consideration the fulfiller owes but are paid out
  // of the bid's own ERC20 offer.
  //
  // Only when the offer actually reaches the fulfiller. `recipientAddress`
  // forwards it elsewhere, and then every consideration item has to come out of
  // what the fulfiller already holds -- the same reasoning the per-order check
  // applies via `offerItemsGoToFulfiller`.
  const offerItemsGoToFulfiller = offerItemsLandWithFulfiller(
    recipientAddress,
    fulfillerAddress,
  )
  const cumulativeReceivedAmounts: Record<string, Record<string, bigint>> = {}
  const criteriaOffersAndConsiderations = sanitizedOrdersMetadata
    .flatMap(orderMetadata => [
      orderMetadata.order.parameters.offer,
      orderMetadata.order.parameters.consideration,
    ])
    .flat()
    .filter(({ itemType }) => isCriteriaItem(itemType))

  const hasCriteriaItems = criteriaOffersAndConsiderations.length > 0

  const addApprovalIfNeeded = (
    orderInsufficientApprovals: InsufficientApprovals,
  ) => {
    orderInsufficientApprovals.forEach(insufficientApproval => {
      const key = getApprovalDedupKey(insufficientApproval, exactApproval)
      if (
        !totalInsufficientApprovals.some(
          approval => getApprovalDedupKey(approval, exactApproval) === key,
        )
      ) {
        totalInsufficientApprovals.push(insufficientApproval)
      }
    })
  }

  ordersMetadataWithAdjustedFills.forEach(
    ({
      order,
      tips,
      offerCriteria,
      considerationCriteria,
      offererBalancesAndApprovals,
      offererOperator,
    }) => {
      const considerationIncludingTips = [
        ...order.parameters.consideration,
        ...tips,
      ]

      const timeBasedItemParams = {
        startTime: order.parameters.startTime,
        endTime: order.parameters.endTime,
        currentBlockTimestamp,
        ascendingAmountTimestampBuffer,
        isConsiderationItem: true,
      }

      const summedConsideration = getSummedTokenAndIdentifierAmounts({
        items: considerationIncludingTips,
        criterias: considerationCriteria,
        timeBasedItemParams,
      })

      totalNativeAmount =
        totalNativeAmount +
        (summedConsideration[ethers.ZeroAddress]?.["0"] ?? 0n)

      for (const [token, identifierToAmount] of Object.entries(
        summedConsideration,
      )) {
        for (const [identifier, amount] of Object.entries(identifierToAmount)) {
          cumulativeFulfillerAmounts[token] ??= {}
          cumulativeFulfillerAmounts[token][identifier] =
            (cumulativeFulfillerAmounts[token][identifier] ?? 0n) + amount
        }
      }

      if (offerItemsGoToFulfiller) {
        const summedOffer = getSummedTokenAndIdentifierAmounts({
          items: order.parameters.offer,
          criterias: offerCriteria,
          timeBasedItemParams: {
            ...timeBasedItemParams,
            isConsiderationItem: false,
          },
        })

        for (const [token, identifierToAmount] of Object.entries(summedOffer)) {
          for (const [identifier, amount] of Object.entries(
            identifierToAmount,
          )) {
            cumulativeReceivedAmounts[token] ??= {}
            cumulativeReceivedAmounts[token][identifier] =
              (cumulativeReceivedAmounts[token][identifier] ?? 0n) + amount
          }
        }
      }

      const insufficientApprovals = validateStandardFulfillBalancesAndApprovals(
        {
          offer: order.parameters.offer,
          consideration: considerationIncludingTips,
          offerCriteria,
          considerationCriteria,
          offererBalancesAndApprovals,
          fulfillerBalancesAndApprovals,
          timeBasedItemParams,
          offererOperator,
          fulfillerOperator,
          offerItemsGoToFulfiller,
        },
      )

      const offerCriteriaItems = order.parameters.offer.filter(({ itemType }) =>
        isCriteriaItem(itemType),
      )

      const considerationCriteriaItems = considerationIncludingTips.filter(
        ({ itemType }) => isCriteriaItem(itemType),
      )

      if (
        offerCriteriaItems.length !== offerCriteria.length ||
        considerationCriteriaItems.length !== considerationCriteria.length
      ) {
        throw new Error(
          "You must supply the appropriate criterias for criteria based items",
        )
      }

      addApprovalIfNeeded(insufficientApprovals)
    },
  )

  overrides = { ...overrides, value: totalNativeAmount }

  validateCumulativeFulfillerBalances({
    requiredAmounts: cumulativeFulfillerAmounts,
    receivedAmounts: cumulativeReceivedAmounts,
    fulfillerBalancesAndApprovals,
  })

  // An approval is deduped to one action per token and operator, and with
  // exactApproval that action approves `requiredApprovedAmount`. Left as the
  // first order's share it under-approves the batch and the fulfillment reverts.
  // Raise it to the batch total, never lower it: an order whose allowance
  // already covers it contributes no entry here at all, so summing the entries
  // that are present would still undercount.
  const approvalsForBatch = totalInsufficientApprovals.map(approval => {
    const cumulative =
      cumulativeFulfillerAmounts[approval.token.toLowerCase()]?.[
        approval.identifierOrCriteria
      ]
    return cumulative !== undefined &&
      cumulative > approval.requiredApprovedAmount
      ? { ...approval, requiredApprovedAmount: cumulative }
      : approval
  })

  const approvalActions = getApprovalActions(
    approvalsForBatch,
    exactApproval,
    signer,
  )

  const advancedOrdersWithTips: AdvancedOrder[] = sanitizedOrdersMetadata.map(
    ({ order, unitsToFill = 0, tips, extraData }) => {
      const { numerator, denominator } = getAdvancedOrderNumeratorDenominator(
        order,
        unitsToFill,
      )

      const considerationIncludingTips = [
        ...order.parameters.consideration,
        ...tips,
      ]

      return {
        ...order,
        parameters: {
          ...order.parameters,
          consideration: considerationIncludingTips,
          totalOriginalConsiderationItems:
            order.parameters.consideration.length,
        },
        numerator,
        denominator,
        extraData,
      }
    },
  )

  const { offerFulfillments, considerationFulfillments } =
    generateFulfillOrdersFulfillments(sanitizedOrdersMetadata)

  const exchangeAction = {
    type: "exchange",
    transactionMethods: getTransactionMethods(
      signer,
      seaportContract,
      "fulfillAvailableAdvancedOrders",
      [
        advancedOrdersWithTips,
        hasCriteriaItems
          ? generateCriteriaResolvers({
              orders: sanitizedOrdersMetadata.map(({ order }) => order),
              offerCriterias: sanitizedOrdersMetadata.map(
                ({ offerCriteria }) => offerCriteria,
              ),
              considerationCriterias: sanitizedOrdersMetadata.map(
                ({ considerationCriteria }) => considerationCriteria,
              ),
            })
          : [],
        offerFulfillments,
        considerationFulfillments,
        conduitKey,
        recipientAddress,
        advancedOrdersWithTips.length,
        overrides,
      ],
      domain,
    ),
  } as const

  const actions = [...approvalActions, exchangeAction] as const

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<TransactionResponse>,
    executeApprovals: () => executeApprovals(actions),
  }
}

export function generateFulfillOrdersFulfillments(
  ordersMetadata: FulfillOrdersMetadata,
): {
  offerFulfillments: FulfillmentComponentStruct[][]
  considerationFulfillments: FulfillmentComponentStruct[][]
} {
  const hashAggregateKey = ({
    sourceOrDestination,
    operator = "",
    token,
    identifier,
  }: {
    sourceOrDestination: string
    operator?: string
    token: string
    identifier: string
  }) => `${sourceOrDestination}-${operator}-${token}-${identifier}`

  const offerAggregatedFulfillments: Record<
    string,
    FulfillmentComponentStruct[]
  > = {}

  const considerationAggregatedFulfillments: Record<
    string,
    FulfillmentComponentStruct[]
  > = {}

  ordersMetadata.forEach(
    ({ order, offererOperator, offerCriteria }, orderIndex) => {
      const itemToCriteria = getItemToCriteriaMap(
        order.parameters.offer,
        offerCriteria,
      )

      return order.parameters.offer.forEach((item, itemIndex) => {
        const aggregateKey = `${hashAggregateKey({
          sourceOrDestination: order.parameters.offerer,
          operator: offererOperator,
          token: item.token,
          identifier:
            itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
          // We tack on the index to ensure that erc721s can never be aggregated and instead must be in separate arrays
        })}${isErc721Item(item.itemType) ? `${orderIndex}-${itemIndex}` : ""}`

        offerAggregatedFulfillments[aggregateKey] = [
          ...(offerAggregatedFulfillments[aggregateKey] ?? []),
          { orderIndex, itemIndex },
        ]
      })
    },
  )

  ordersMetadata.forEach(
    ({ order, considerationCriteria, tips }, orderIndex) => {
      const itemToCriteria = getItemToCriteriaMap(
        order.parameters.consideration,
        considerationCriteria,
      )
      return [...order.parameters.consideration, ...tips].forEach(
        (item, itemIndex) => {
          const aggregateKey = `${hashAggregateKey({
            sourceOrDestination: item.recipient,
            token: item.token,
            identifier:
              itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
            // We tack on the index to ensure that erc721s can never be aggregated and instead must be in separate arrays
          })}${isErc721Item(item.itemType) ? `${orderIndex}-${itemIndex}` : ""}`

          considerationAggregatedFulfillments[aggregateKey] = [
            ...(considerationAggregatedFulfillments[aggregateKey] ?? []),
            { orderIndex, itemIndex },
          ]
        },
      )
    },
  )

  return {
    offerFulfillments: Object.values(offerAggregatedFulfillments),
    considerationFulfillments: Object.values(
      considerationAggregatedFulfillments,
    ),
  }
}

/**
 * Rejects criteria-based tips.
 *
 * Tips are appended to the submitted order's consideration array, but criteria
 * resolvers are generated from the order alone, so a criteria-based tip is
 * counted when validating that enough criterias were supplied and then never
 * given a resolver. Seaport rejects the unresolved item with
 * `UnresolvedConsiderationCriteria`, and if the caller happened to list the
 * tip's criteria first, the order's own criteria item resolves against the
 * tip's identifier on the way there. Refuse it here rather than spending gas
 * to find out.
 */
export function assertNoCriteriaTips(tips: ConsiderationItem[]) {
  if (tips.some(({ itemType }) => isCriteriaItem(itemType))) {
    throw new Error(
      "Criteria-based tips are not supported: a tip is appended to the order's " +
        "consideration but gets no criteria resolver, so Seaport cannot resolve it. " +
        "Pass a tip with an explicit identifier instead.",
    )
  }
}

/**
 * Caps a requested fill at what is left of a partially filled order.
 *
 * Seaport does this itself: asking for 8 of 10 units when only 4 remain
 * transfers 4 and closes the order. Deriving amounts from the raw request
 * instead describes a fill that will never happen -- the offer side is sized
 * for units the offerer no longer holds, so the balance check rejects an order
 * the contract would have settled.
 *
 * Only applies once an order is partially filled. A request larger than the
 * order was ever divisible into is a different thing entirely, and
 * getAdvancedOrderNumeratorDenominator still rejects it.
 */
export const clampUnitsToRemaining = (
  unitsToFill: BigNumberish,
  { totalFilled, totalSize }: Pick<OrderStatus, "totalFilled" | "totalSize">,
): BigNumberish => {
  if (totalFilled === 0n) {
    return unitsToFill
  }

  const remaining = totalSize - totalFilled

  return BigInt(unitsToFill) > remaining ? remaining : unitsToFill
}

export const getAdvancedOrderNumeratorDenominator = (
  order: Order,
  unitsToFill?: BigNumberish,
) => {
  // Used for advanced order cases
  const maxUnits = getMaximumSizeForOrder(order)

  // Reduce the numerator/denominator as optimization
  let numerator = 1n
  let denominator = 1n
  if (unitsToFill) {
    const unitsToFillBn = BigInt(unitsToFill)

    // maxUnits is the greatest common divisor of every item amount, i.e. the
    // number of units the order can be split into while keeping every fill
    // exact. When item amounts (e.g. once fees are added) share no common
    // divisor, maxUnits collapses to 1 and the order is effectively
    // non-partially-fillable. Requesting more units than that would produce a
    // numerator/denominator greater than 1 (an over-fill), which reverts
    // on-chain with an opaque error, so surface a clear error here instead.
    if (unitsToFillBn > maxUnits) {
      throw new Error(
        `Cannot fill ${unitsToFillBn} units: this order is only divisible into ${maxUnits} unit(s). ` +
          "This usually means the item amounts (including fees) share no common divisor, " +
          "making the order effectively non-partially-fillable.",
      )
    }

    const unitsGcd = gcd(unitsToFillBn, maxUnits)
    numerator = unitsToFillBn / unitsGcd
    denominator = maxUnits / unitsGcd
  }

  return { numerator, denominator }
}

export const scaleOrderStatusToMaxUnits = (
  order: OrderWithCounter,
  orderStatus: OrderStatus,
) => {
  const maxUnits = getMaximumSizeForOrder(order)
  if (orderStatus.totalSize === 0n) {
    // Seaport returns 0 for totalSize if the order has not been fulfilled before.
    orderStatus.totalSize = maxUnits
  } else {
    // Scale the total filled and total size to the max units,
    // so we can properly calculate the units to fill.
    orderStatus.totalFilled =
      (orderStatus.totalFilled * maxUnits) / orderStatus.totalSize
    orderStatus.totalSize = maxUnits
  }
  return orderStatus
}
