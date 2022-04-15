import {
  BigNumber,
  BigNumberish,
  ContractTransaction,
  ethers,
  Overrides,
  providers,
} from "ethers";
import { BasicOrderRouteType, ItemType, ProxyStrategy } from "../constants";
import type {
  BasicOrderParametersStruct,
  Consideration,
  OrderStruct,
} from "../typechain/Consideration";
import type {
  ConsiderationItem,
  ExchangeAction,
  InputCriteria,
  Order,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
} from "../types";
import { getApprovalActions } from "./approval";
import {
  BalancesAndApprovals,
  validateBasicFulfillBalancesAndApprovals,
  validateStandardFulfillBalancesAndApprovals,
} from "./balanceAndApprovalCheck";
import { generateCriteriaResolvers } from "./criteria";
import { gcd } from "./gcd";
import {
  getMaximumSizeForOrder,
  getSummedTokenAndIdentifierAmounts,
  isNativeCurrencyItem,
  TimeBasedItemParams,
} from "./item";
import {
  areAllCurrenciesSame,
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
  totalItemsAmount,
  useProxyFromApprovals,
  validateOrderParameters,
} from "./order";
import { executeAllActions } from "./usecase";

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
  totalFilled: OrderStatus["totalFilled"]
) => {
  // 1. The order must not be partially filled
  if (!totalFilled.eq(0)) {
    return false;
  }

  // 2. Must be single offer and at least one consideration
  if (offer.length > 1 || consideration.length === 0) {
    return false;
  }

  const allItems = [...offer, ...consideration];

  const nfts = allItems.filter(({ itemType }) =>
    [ItemType.ERC721, ItemType.ERC1155].includes(itemType)
  );

  const nftsWithCriteria = allItems.filter(({ itemType }) =>
    [ItemType.ERC721_WITH_CRITERIA, ItemType.ERC1155_WITH_CRITERIA].includes(
      itemType
    )
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
    ({ startAmount, endAmount }) => startAmount !== endAmount
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
    totalItemsAmount(restConsideration).endAmount.gt(offer[0].endAmount)
  ) {
    return false;
  }

  const currencies = allItems.filter(({ itemType }) =>
    [ItemType.NATIVE, ItemType.ERC20].includes(itemType)
  );

  //  9. The token on native currency items needs to be set to the null address and the identifier on
  //  currencies needs to be zero, and the amounts on the 721 item need to be 1
  const nativeCurrencyIsZeroAddress = currencies
    .filter(({ itemType }) => itemType === ItemType.NATIVE)
    .every(({ token }) => token === ethers.constants.AddressZero);

  const currencyIdentifiersAreZero = currencies.every(
    ({ identifierOrCriteria }) => BigNumber.from(identifierOrCriteria).eq(0)
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

/**
 * Executes one of the six basic fulfillment methods
 * 1. fulfillBasicEthForERC721Order
 * 2. fulfillBasicEthForERC1155Order
 * 3. fulfillBasicERC1155ForERC20Order
 * 4. fulfillBasicERC20ForERC1155Order
 * 5. fulfillBasicERC20ForERC721Order
 * 6. fulfillBasicERC721ForERC20Order
 * @param order - Standard order object
 * @param contract - Consideration ethers contract
 */
export async function fulfillBasicOrder(
  { parameters: orderParameters, signature }: Order,
  {
    considerationContract,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    proxy,
    proxyStrategy,
    signer,
    tips = [],
  }: {
    considerationContract: Consideration;
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    proxy: string;
    proxyStrategy: ProxyStrategy;
    signer: providers.JsonRpcSigner;
    tips?: ConsiderationItem[];
  }
): Promise<OrderUseCase<ExchangeAction>> {
  const { offer, consideration, orderType } = orderParameters;
  const considerationIncludingTips = [...consideration, ...tips];

  const offerItem = offer[0];
  const [forOfferer, ...forAdditionalRecipients] = considerationIncludingTips;

  const basicOrderRouteType =
    offerAndConsiderationFulfillmentMapping[offerItem.itemType]?.[
      forOfferer.itemType
    ];

  if (basicOrderRouteType === undefined) {
    throw new Error(
      "Order parameters did not result in a valid basic fulfillment"
    );
  }

  const additionalRecipients = forAdditionalRecipients.map(
    ({ startAmount, recipient }) => ({
      amount: startAmount,
      recipient,
    })
  );

  const considerationWithoutOfferItemType = considerationIncludingTips.filter(
    (item) => item.itemType !== offer[0].itemType
  );

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts(
    considerationWithoutOfferItemType,
    {
      criterias: [],
      timeBasedItemParams: {
        ...timeBasedItemParams,
        isConsiderationItem: true,
      },
    }
  )[ethers.constants.AddressZero]?.["0"];

  const { insufficientOwnerApprovals, insufficientProxyApprovals } =
    validateBasicFulfillBalancesAndApprovals(
      {
        offer,
        orderType,
        consideration: considerationIncludingTips,
      },
      {
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        considerationContract,
        proxy,
        proxyStrategy,
      }
    );

  const useFulfillerProxy = useProxyFromApprovals({
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
    proxyStrategy,
  });

  const approvalsToUse = useFulfillerProxy
    ? insufficientProxyApprovals
    : insufficientOwnerApprovals;

  const basicOrderParameters: BasicOrderParametersStruct = {
    offerer: orderParameters.offerer,
    zone: orderParameters.zone,
    //  Note the use of a "basicOrderType" enum;
    //  this represents both the usual order type as well as the "route"
    //  of the basic order (a simple derivation function for the basic order
    //  type is `basicOrderType = orderType + (8 * basicOrderRoute)`.)
    basicOrderType: orderParameters.orderType + 8 * basicOrderRouteType,
    offerToken: offerItem.token,
    offerIdentifier: offerItem.identifierOrCriteria,
    offerAmount: offerItem.endAmount,
    considerationToken: forOfferer.token,
    considerationIdentifier: forOfferer.identifierOrCriteria,
    considerationAmount: forOfferer.endAmount,
    startTime: orderParameters.startTime,
    endTime: orderParameters.endTime,
    salt: orderParameters.salt,
    totalOriginalAdditionalRecipients: orderParameters.consideration.length - 1,
    signature,
    useFulfillerProxy,
    additionalRecipients,
    zoneHash: orderParameters.zoneHash,
  };

  const payableOverrides = { value: totalNativeAmount };

  const approvalActions = await getApprovalActions(approvalsToUse, {
    signer,
  });

  const exchangeAction = {
    type: "exchange",
    transaction: {
      transact: (overrides: Overrides = {}) =>
        considerationContract
          .connect(signer)
          .fulfillBasicOrder(basicOrderParameters, {
            ...overrides,
            ...payableOverrides,
          }),
      buildTransaction: (overrides: Overrides = {}) =>
        considerationContract
          .connect(signer)
          .populateTransaction.fulfillBasicOrder(basicOrderParameters, {
            ...overrides,
            ...payableOverrides,
          }),
    },
  } as ExchangeAction;

  const actions = [...approvalActions, exchangeAction] as const;

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<ContractTransaction>,
  };
}

export async function fulfillStandardOrder(
  order: Order,
  {
    unitsToFill = 0,
    totalFilled,
    totalSize,
    offerCriteria,
    considerationCriteria,
    tips = [],
    extraData,
  }: {
    unitsToFill?: BigNumberish;
    totalFilled: BigNumber;
    totalSize: BigNumber;
    offerCriteria: InputCriteria[];
    considerationCriteria: InputCriteria[];
    tips?: ConsiderationItem[];
    extraData?: string;
  },
  {
    considerationContract,
    offererBalancesAndApprovals,
    fulfillerBalancesAndApprovals,
    timeBasedItemParams,
    proxy,
    proxyStrategy,
    signer,
  }: {
    considerationContract: Consideration;
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    unitsToFill?: BigNumberish;
    proxy: string;
    proxyStrategy: ProxyStrategy;
    signer: providers.JsonRpcSigner;
  }
): Promise<OrderUseCase<ExchangeAction>> {
  // If we are supplying units to fill, we adjust the order by the minimum of the amount to fill and
  // the remaining order left to be fulfilled
  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalFilled,
        totalSize,
      })
    : // Else, we adjust the order by the remaining order left to be fulfilled
      mapOrderAmountsFromFilledStatus(order, {
        totalFilled,
        totalSize,
      });

  const {
    parameters: { offer, consideration, orderType },
  } = orderWithAdjustedFills;

  const considerationIncludingTips = [...consideration, ...tips];

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts(
    considerationIncludingTips,
    {
      criterias: considerationCriteria,
      timeBasedItemParams: {
        ...timeBasedItemParams,
        isConsiderationItem: true,
      },
    }
  )[ethers.constants.AddressZero]?.["0"];

  const { insufficientOwnerApprovals, insufficientProxyApprovals } =
    validateStandardFulfillBalancesAndApprovals(
      {
        offer,
        orderType,
        consideration: considerationIncludingTips,
        offerCriteria,
        considerationCriteria,
      },
      {
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        considerationContract,
        proxy,
        proxyStrategy,
      }
    );

  const useProxyForFulfiller = useProxyFromApprovals({
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
    proxyStrategy,
  });

  const approvalsToUse = useProxyForFulfiller
    ? insufficientProxyApprovals
    : insufficientOwnerApprovals;

  const payableOverrides = { value: totalNativeAmount };

  const approvalActions = await getApprovalActions(approvalsToUse, { signer });

  const offerCriteriaItems = offer.filter(
    ({ itemType }) =>
      itemType === ItemType.ERC1155_WITH_CRITERIA ||
      itemType === ItemType.ERC721_WITH_CRITERIA
  );

  const considerationCriteriaItems = considerationIncludingTips.filter(
    ({ itemType }) =>
      itemType === ItemType.ERC1155_WITH_CRITERIA ||
      itemType === ItemType.ERC721_WITH_CRITERIA
  );

  const hasCriteriaItems =
    offerCriteriaItems.length > 0 || considerationCriteriaItems.length > 0;

  if (
    offerCriteriaItems.length !== offerCriteria.length ||
    considerationCriteriaItems.length !== considerationCriteria.length
  ) {
    throw new Error(
      "You must supply the appropriate criterias for criteria based items"
    );
  }

  const useAdvanced = Boolean(unitsToFill) || hasCriteriaItems;

  // Used for advanced order cases
  const maxUnits = getMaximumSizeForOrder(order);
  const unitsToFillBn = BigNumber.from(unitsToFill);

  // Reduce the numerator/denominator as optimization
  const unitsGcd = gcd(unitsToFillBn, maxUnits);

  const numerator = unitsToFill
    ? unitsToFillBn.div(unitsGcd)
    : BigNumber.from(1);
  const denominator = unitsToFill ? maxUnits.div(unitsGcd) : BigNumber.from(1);

  const orderAccountingForTips: OrderStruct = {
    ...order,
    parameters: {
      ...order.parameters,
      totalOriginalConsiderationItems: consideration.length,
    },
  };

  const exchangeAction = {
    type: "exchange",
    transaction: {
      transact: (overrides: Overrides = {}) =>
        useAdvanced
          ? considerationContract.connect(signer).fulfillAdvancedOrder(
              {
                ...orderAccountingForTips,
                numerator,
                denominator,
                extraData: extraData ?? "0x",
              },
              hasCriteriaItems
                ? generateCriteriaResolvers([order], {
                    offerCriterias: [offerCriteria],
                    considerationCriterias: [considerationCriteria],
                  })
                : [],
              useProxyForFulfiller,
              { ...overrides, ...payableOverrides }
            )
          : considerationContract
              .connect(signer)
              .fulfillOrder(orderAccountingForTips, useProxyForFulfiller, {
                ...overrides,
                ...payableOverrides,
              }),
      buildTransaction: (overrides: Overrides = {}) =>
        useAdvanced
          ? considerationContract.populateTransaction.fulfillAdvancedOrder(
              {
                ...orderAccountingForTips,
                numerator,
                denominator,
                extraData: extraData ?? "0x",
              },
              hasCriteriaItems
                ? generateCriteriaResolvers([order], {
                    offerCriterias: [offerCriteria],
                    considerationCriterias: [considerationCriteria],
                  })
                : [],
              useProxyForFulfiller,
              { ...overrides, ...payableOverrides }
            )
          : considerationContract.populateTransaction.fulfillOrder(
              orderAccountingForTips,
              useProxyForFulfiller,
              { ...overrides, ...payableOverrides }
            ),
    },
  } as const;

  const actions = [...approvalActions, exchangeAction] as const;

  return {
    actions,
    executeAllActions: () =>
      executeAllActions(actions) as Promise<ContractTransaction>,
  };
}
