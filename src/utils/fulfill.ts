import {
  BigNumberish,
  ContractTransaction,
  ethers,
  Overrides,
  Signer,
} from "ethers";
import type {
  BasicOrderParametersStruct,
  FulfillmentComponentStruct,
  OrderStruct,
} from "../typechain-types/seaport/contracts/Seaport";
import { BasicOrderRouteType, ItemType, NO_CONDUIT } from "../constants";
import type {
  SeaportContract,
  AdvancedOrder,
  ConsiderationItem,
  ExchangeAction,
  InputCriteria,
  Order,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
  OrderWithCounter,
} from "../types";
import { getApprovalActions } from "./approval";
import {
  BalancesAndApprovals,
  InsufficientApprovals,
  validateBasicFulfillBalancesAndApprovals,
  validateStandardFulfillBalancesAndApprovals,
} from "./balanceAndApprovalCheck";
import { generateCriteriaResolvers, getItemToCriteriaMap } from "./criteria";
import { gcd } from "./gcd";
import {
  getMaximumSizeForOrder,
  getSummedTokenAndIdentifierAmounts,
  isCriteriaItem,
  isCurrencyItem,
  isErc721Item,
  isNativeCurrencyItem,
  TimeBasedItemParams,
} from "./item";
import {
  areAllCurrenciesSame,
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
  mapTipAmountsFromFilledStatus,
  mapTipAmountsFromUnitsToFill,
  totalItemsAmount,
} from "./order";
import {
  ContractMethodReturnType,
  executeAllActions,
  getTransactionMethods,
} from "./usecase";

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
) => {
  // 1. The order must not be partially filled
  if (totalFilled !== 0n) {
    return false;
  }

  // 2. Must be single offer and at least one consideration
  if (offer.length > 1 || consideration.length === 0) {
    return false;
  }

  const allItems = [...offer, ...consideration];

  const nfts = allItems.filter(({ itemType }) =>
    [ItemType.ERC721, ItemType.ERC1155].includes(itemType),
  );

  const nftsWithCriteria = allItems.filter(({ itemType }) =>
    isCriteriaItem(itemType),
  );

  const offersNativeCurrency = isNativeCurrencyItem(offer[0]);

  // 3. The order does not offer an item with Ether (or other native tokens) as its item type.
  if (offersNativeCurrency) {
    return false;
  }

  // 4. The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
  if (nfts.length !== 1 || nftsWithCriteria.length !== 0) {
    return false;
  }

  // 5. All currencies need to have the same address and item type (Native, ERC20)
  if (!areAllCurrenciesSame({ offer, consideration })) {
    return false;
  }

  // 6. All individual items need to have the same startAmount and endAmount
  const differentStartAndEndAmount = allItems.some(
    ({ startAmount, endAmount }) => startAmount !== endAmount,
  );

  if (differentStartAndEndAmount) {
    return false;
  }

  const [firstConsideration, ...restConsideration] = consideration;

  // 7. First consideration item must contain the offerer as the recipient
  const firstConsiderationRecipientIsNotOfferer =
    firstConsideration.recipient.toLowerCase() !== offerer.toLowerCase();

  if (firstConsiderationRecipientIsNotOfferer) {
    return false;
  }

  // 8. If the order has multiple consideration items and all consideration items other than the
  // first consideration item have the same item type as the offered item, the offered item
  // amount is not less than the sum of all consideration item amounts excluding the
  // first consideration item amount
  if (
    consideration.length > 1 &&
    restConsideration.every((item) => item.itemType === offer[0].itemType) &&
    totalItemsAmount(restConsideration).endAmount > BigInt(offer[0].endAmount)
  ) {
    return false;
  }

  const currencies = allItems.filter(isCurrencyItem);

  //  9. The token on native currency items needs to be set to the null address and the identifier on
  //  currencies needs to be zero, and the amounts on the 721 item need to be 1
  const nativeCurrencyIsZeroAddress = currencies
    .filter(({ itemType }) => itemType === ItemType.NATIVE)
    .every(({ token }) => token === ethers.ZeroAddress);

  const currencyIdentifiersAreZero = currencies.every(
    ({ identifierOrCriteria }) => BigInt(identifierOrCriteria) === 0n,
  );

  const erc721sAreSingleAmount = nfts
    .filter(({ itemType }) => itemType === ItemType.ERC721)
    .every(({ endAmount }) => endAmount === "1");

  return (
    nativeCurrencyIsZeroAddress &&
    currencyIdentifiersAreZero &&
    erc721sAreSingleAmount
  );
};

const offerAndConsiderationFulfillmentMapping: {
  [_key in ItemType]?: { [_key in ItemType]?: BasicOrderRouteType };
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
} as const;

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
    order: Order;
    seaportContract: SeaportContract;
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    offererOperator: string;
    fulfillerOperator: string;
    signer: Signer;
    tips?: ConsiderationItem[];
    conduitKey: string;
    domain?: string;
    overrides?: Overrides;
  },
  exactApproval: boolean,
): OrderUseCase<
  ExchangeAction<ContractMethodReturnType<SeaportContract, "fulfillBasicOrder">>
> {
  const { offer, consideration } = order.parameters;
  const considerationIncludingTips = [...consideration, ...tips];

  const offerItem = offer[0];
  const [forOfferer, ...forAdditionalRecipients] = considerationIncludingTips;

  const basicOrderRouteType =
    offerAndConsiderationFulfillmentMapping[offerItem.itemType]?.[
      forOfferer.itemType
    ];

  if (basicOrderRouteType === undefined) {
    throw new Error(
      "Order parameters did not result in a valid basic fulfillment",
    );
  }

  const additionalRecipients = forAdditionalRecipients.map(
    ({ startAmount, recipient }) => ({
      amount: startAmount,
      recipient,
    }),
  );

  const considerationWithoutOfferItemType = considerationIncludingTips.filter(
    (item) => item.itemType !== offer[0].itemType,
  );

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts({
    items: considerationWithoutOfferItemType,
    criterias: [],
    timeBasedItemParams: {
      ...timeBasedItemParams,
      isConsiderationItem: true,
    },
  })[ethers.ZeroAddress]?.["0"];

  const insufficientApprovals = validateBasicFulfillBalancesAndApprovals({
    offer,
    consideration: considerationIncludingTips,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    offererOperator,
    fulfillerOperator,
  });

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
  };

  overrides = { ...overrides, value: totalNativeAmount };

  const approvalActions = getApprovalActions(
    insufficientApprovals,
    exactApproval,
    signer,
  );

  const exchangeAction = {
    type: "exchange",
    transactionMethods: getTransactionMethods(
      signer,
      seaportContract,
      "fulfillBasicOrder",
      [basicOrderParameters, overrides],
      domain,
    ),
  } as const;

  const actions = [...approvalActions, exchangeAction] as const;

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<ContractTransaction>,
  };
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
    signer,
    domain,
    overrides,
  }: {
    order: Order;
    unitsToFill?: BigNumberish;
    totalFilled: bigint;
    totalSize: bigint;
    offerCriteria: InputCriteria[];
    considerationCriteria: InputCriteria[];
    tips?: ConsiderationItem[];
    extraData?: string;
    seaportContract: SeaportContract;
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    offererOperator: string;
    fulfillerOperator: string;
    conduitKey: string;
    recipientAddress: string;
    timeBasedItemParams: TimeBasedItemParams;
    signer: Signer;
    domain?: string;
    overrides?: Overrides;
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
      });

  let adjustedTips: ConsiderationItem[] = [];

  if (tips.length > 0) {
    adjustedTips = mapTipAmountsFromUnitsToFill(tips, unitsToFill, totalSize);
  }

  const {
    parameters: { offer, consideration },
  } = orderWithAdjustedFills;

  const considerationIncludingTips = [...consideration, ...adjustedTips];

  const offerCriteriaItems = offer.filter(({ itemType }) =>
    isCriteriaItem(itemType),
  );

  const considerationCriteriaItems = considerationIncludingTips.filter(
    ({ itemType }) => isCriteriaItem(itemType),
  );

  const hasCriteriaItems =
    offerCriteriaItems.length > 0 || considerationCriteriaItems.length > 0;

  if (
    offerCriteriaItems.length !== offerCriteria.length ||
    considerationCriteriaItems.length !== considerationCriteria.length
  ) {
    throw new Error(
      "You must supply the appropriate criterias for criteria based items",
    );
  }

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts({
    items: considerationIncludingTips,
    criterias: considerationCriteria,
    timeBasedItemParams: {
      ...timeBasedItemParams,
      isConsiderationItem: true,
    },
  })[ethers.ZeroAddress]?.["0"];

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
  });

  overrides = { ...overrides, value: totalNativeAmount };

  const approvalActions = getApprovalActions(
    insufficientApprovals,
    exactApproval,
    signer,
  );

  const isGift = recipientAddress !== ethers.ZeroAddress;

  const useAdvanced = Boolean(unitsToFill) || hasCriteriaItems || isGift;

  const orderAccountingForTips: OrderStruct = {
    ...order,
    parameters: {
      ...order.parameters,
      consideration: [...order.parameters.consideration, ...tips],
      totalOriginalConsiderationItems: consideration.length,
    },
  };

  const { numerator, denominator } = getAdvancedOrderNumeratorDenominator(
    order,
    unitsToFill,
  );

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
  } as const;

  const actions = [...approvalActions, exchangeAction] as const;

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<ContractTransaction>,
  };
}

export function validateAndSanitizeFromOrderStatus(
  order: Order,
  orderStatus: OrderStatus,
): Order {
  const { isValidated, isCancelled, totalFilled, totalSize } = orderStatus;

  if (totalSize > 0n && totalFilled / totalSize === 1n) {
    throw new Error("The order you are trying to fulfill is already filled");
  }

  if (isCancelled) {
    throw new Error("The order you are trying to fulfill is cancelled");
  }

  if (isValidated) {
    // If the order is already validated, manually wipe the signature off of the order to save gas
    return { parameters: { ...order.parameters }, signature: "0x" };
  }

  return order;
}

export type FulfillOrdersMetadata = {
  order: Order;
  unitsToFill?: BigNumberish;
  orderStatus: OrderStatus;
  offerCriteria: InputCriteria[];
  considerationCriteria: InputCriteria[];
  tips: ConsiderationItem[];
  extraData: string;
  offererBalancesAndApprovals: BalancesAndApprovals;
  offererOperator: string;
}[];

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
  exactApproval,
  domain,
}: {
  ordersMetadata: FulfillOrdersMetadata;
  seaportContract: SeaportContract;
  fulfillerBalancesAndApprovals: BalancesAndApprovals;
  fulfillerOperator: string;
  currentBlockTimestamp: number;
  ascendingAmountTimestampBuffer: number;
  conduitKey: string;
  signer: Signer;
  recipientAddress: string;
  exactApproval: boolean;
  domain?: string;
}): OrderUseCase<
  ExchangeAction<
    ContractMethodReturnType<SeaportContract, "fulfillAvailableAdvancedOrders">
  >
> {
  const sanitizedOrdersMetadata = ordersMetadata.map((orderMetadata) => ({
    ...orderMetadata,
    order: validateAndSanitizeFromOrderStatus(
      orderMetadata.order,
      orderMetadata.orderStatus,
    ),
  }));

  const adjustTips = (orderMetadata: {
    order: Order;
    unitsToFill?: BigNumberish;
    orderStatus: OrderStatus;
    offerCriteria: InputCriteria[];
    considerationCriteria: InputCriteria[];
    tips: ConsiderationItem[];
    extraData: string;
    offererBalancesAndApprovals: BalancesAndApprovals;
    offererOperator: string;
  }): ConsiderationItem[] => {
    if (!orderMetadata.tips || !orderMetadata.tips.length) {
      return [];
    }

    return orderMetadata.unitsToFill
      ? mapTipAmountsFromUnitsToFill(
          orderMetadata.tips,
          orderMetadata.unitsToFill,
          orderMetadata.orderStatus.totalSize,
        )
      : mapTipAmountsFromFilledStatus(
          orderMetadata.tips,
          orderMetadata.orderStatus.totalFilled,
          orderMetadata.orderStatus.totalSize,
        );
  };

  const ordersMetadataWithAdjustedFills = sanitizedOrdersMetadata.map(
    (orderMetadata) => ({
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
  );

  let totalNativeAmount = 0n;
  const totalInsufficientApprovals: InsufficientApprovals = [];
  const criteriaOffersAndConsiderations = sanitizedOrdersMetadata
    .flatMap((orderMetadata) => [
      orderMetadata.order.parameters.offer,
      orderMetadata.order.parameters.consideration,
    ])
    .flat()
    .filter(({ itemType }) => isCriteriaItem(itemType));

  const hasCriteriaItems = criteriaOffersAndConsiderations.length > 0;

  const addApprovalIfNeeded = (
    orderInsufficientApprovals: InsufficientApprovals,
  ) => {
    orderInsufficientApprovals.forEach((insufficientApproval) => {
      if (
        !totalInsufficientApprovals.find(
          (approval) => approval.token === insufficientApproval.token,
        )
      ) {
        totalInsufficientApprovals.push(insufficientApproval);
      }
    });
  };

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
      ];

      const timeBasedItemParams = {
        startTime: order.parameters.startTime,
        endTime: order.parameters.endTime,
        currentBlockTimestamp,
        ascendingAmountTimestampBuffer,
        isConsiderationItem: true,
      };

      totalNativeAmount =
        totalNativeAmount +
        (getSummedTokenAndIdentifierAmounts({
          items: considerationIncludingTips,
          criterias: considerationCriteria,
          timeBasedItemParams,
        })[ethers.ZeroAddress]?.["0"] ?? 0n);

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
        },
      );

      const offerCriteriaItems = order.parameters.offer.filter(({ itemType }) =>
        isCriteriaItem(itemType),
      );

      const considerationCriteriaItems = considerationIncludingTips.filter(
        ({ itemType }) => isCriteriaItem(itemType),
      );

      if (
        offerCriteriaItems.length !== offerCriteria.length ||
        considerationCriteriaItems.length !== considerationCriteria.length
      ) {
        throw new Error(
          "You must supply the appropriate criterias for criteria based items",
        );
      }

      addApprovalIfNeeded(insufficientApprovals);
    },
  );

  const overrides = { value: totalNativeAmount };

  const approvalActions = getApprovalActions(
    totalInsufficientApprovals,
    exactApproval,
    signer,
  );

  const advancedOrdersWithTips: AdvancedOrder[] = sanitizedOrdersMetadata.map(
    ({ order, unitsToFill = 0, tips, extraData }) => {
      const { numerator, denominator } = getAdvancedOrderNumeratorDenominator(
        order,
        unitsToFill,
      );

      const considerationIncludingTips = [
        ...order.parameters.consideration,
        ...tips,
      ];

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
      };
    },
  );

  const { offerFulfillments, considerationFulfillments } =
    generateFulfillOrdersFulfillments(ordersMetadata);

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
              orders: ordersMetadata.map(({ order }) => order),
              offerCriterias: ordersMetadata.map(
                ({ offerCriteria }) => offerCriteria,
              ),
              considerationCriterias: ordersMetadata.map(
                ({ considerationCriteria }) => considerationCriteria,
              ),
            })
          : [],
        offerFulfillments as any,
        considerationFulfillments as any,
        conduitKey,
        recipientAddress,
        advancedOrdersWithTips.length,
        overrides,
      ],
      domain,
    ),
  } as const;

  const actions = [...approvalActions, exchangeAction] as const;

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<ContractTransaction>,
  };
}

export function generateFulfillOrdersFulfillments(
  ordersMetadata: FulfillOrdersMetadata,
): {
  offerFulfillments: FulfillmentComponentStruct[];
  considerationFulfillments: FulfillmentComponentStruct[];
} {
  const hashAggregateKey = ({
    sourceOrDestination,
    operator = "",
    token,
    identifier,
  }: {
    sourceOrDestination: string;
    operator?: string;
    token: string;
    identifier: string;
  }) => `${sourceOrDestination}-${operator}-${token}-${identifier}`;

  const offerAggregatedFulfillments: Record<
    string,
    FulfillmentComponentStruct
  > = {};

  const considerationAggregatedFulfillments: Record<
    string,
    FulfillmentComponentStruct
  > = {};

  ordersMetadata.forEach(
    ({ order, offererOperator, offerCriteria }, orderIndex) => {
      const itemToCriteria = getItemToCriteriaMap(
        order.parameters.offer,
        offerCriteria,
      );

      return order.parameters.offer.forEach((item, itemIndex) => {
        const aggregateKey = `${hashAggregateKey({
          sourceOrDestination: order.parameters.offerer,
          operator: offererOperator,
          token: item.token,
          identifier:
            itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
          // We tack on the index to ensure that erc721s can never be aggregated and instead must be in separate arrays
        })}${isErc721Item(item.itemType) ? itemIndex : ""}`;

        offerAggregatedFulfillments[aggregateKey] = [
          ...((offerAggregatedFulfillments[aggregateKey] ?? []) as any),
          { orderIndex, itemIndex },
        ] as any;
      });
    },
  );

  ordersMetadata.forEach(
    ({ order, considerationCriteria, tips }, orderIndex) => {
      const itemToCriteria = getItemToCriteriaMap(
        order.parameters.consideration,
        considerationCriteria,
      );
      return [...order.parameters.consideration, ...tips].forEach(
        (item, itemIndex) => {
          const aggregateKey = `${hashAggregateKey({
            sourceOrDestination: item.recipient,
            token: item.token,
            identifier:
              itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria,
            // We tack on the index to ensure that erc721s can never be aggregated and instead must be in separate arrays
          })}${isErc721Item(item.itemType) ? itemIndex : ""}`;

          considerationAggregatedFulfillments[aggregateKey] = [
            ...((considerationAggregatedFulfillments[aggregateKey] ??
              []) as any),
            { orderIndex, itemIndex },
          ] as any;
        },
      );
    },
  );

  return {
    offerFulfillments: Object.values(offerAggregatedFulfillments),
    considerationFulfillments: Object.values(
      considerationAggregatedFulfillments,
    ),
  };
}

export const getAdvancedOrderNumeratorDenominator = (
  order: Order,
  unitsToFill?: BigNumberish,
) => {
  // Used for advanced order cases
  const maxUnits = getMaximumSizeForOrder(order);

  // Reduce the numerator/denominator as optimization
  let numerator = 1n;
  let denominator = 1n;
  if (unitsToFill) {
    const unitsGcd = gcd(BigInt(unitsToFill), maxUnits);
    numerator = BigInt(unitsToFill) / unitsGcd;
    denominator = maxUnits / unitsGcd;
  }

  return { numerator, denominator };
};

export const scaleOrderStatusToMaxUnits = (
  order: OrderWithCounter,
  orderStatus: OrderStatus,
) => {
  const maxUnits = getMaximumSizeForOrder(order);
  if (orderStatus.totalSize === 0n) {
    // Seaport returns 0 for totalSize if the order has not been fulfilled before.
    orderStatus.totalSize = maxUnits;
  } else {
    // Scale the total filled and total size to the max units,
    // so we can properly calculate the units to fill.
    orderStatus.totalFilled =
      (orderStatus.totalFilled * maxUnits) / orderStatus.totalSize;
    orderStatus.totalSize = maxUnits;
  }
  return orderStatus;
};
