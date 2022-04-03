import {
  BigNumber,
  BigNumberish,
  ContractTransaction,
  ethers,
  PopulatedTransaction,
  providers,
} from "ethers";
import { BasicFulfillOrder, ItemType, ProxyStrategy } from "../constants";
import type {
  BasicOrderParametersStruct,
  Consideration,
} from "../typechain/Consideration";
import type {
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
} from "./balancesAndApprovals";
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
  [_key in ItemType]?: { [_key in ItemType]?: BasicFulfillOrder };
} = {
  [ItemType.ERC20]: {
    [ItemType.ERC721]: BasicFulfillOrder.ERC721_FOR_ERC20,
    [ItemType.ERC1155]: BasicFulfillOrder.ERC1155_FOR_ERC20,
  },
  [ItemType.ERC721]: {
    [ItemType.NATIVE]: BasicFulfillOrder.ETH_FOR_ERC721,
    [ItemType.ERC20]: BasicFulfillOrder.ERC20_FOR_ERC721,
  },
  [ItemType.ERC1155]: {
    [ItemType.NATIVE]: BasicFulfillOrder.ETH_FOR_ERC1155,
    [ItemType.ERC20]: BasicFulfillOrder.ERC20_FOR_ERC1155,
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
  }: {
    considerationContract: Consideration;
    offererBalancesAndApprovals: BalancesAndApprovals;
    fulfillerBalancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams: TimeBasedItemParams;
    proxy: string;
    proxyStrategy: ProxyStrategy;
    signer: providers.JsonRpcSigner;
  }
): Promise<OrderUseCase<ExchangeAction>> {
  const { offer, consideration, orderType } = orderParameters;

  const offerItem = offer[0];
  const [forOfferer, ...forAdditionalRecipients] = consideration;

  const basicFulfillOrder =
    offerAndConsiderationFulfillmentMapping[offerItem.itemType]?.[
      forOfferer.itemType
    ];

  if (basicFulfillOrder === undefined) {
    throw new Error(
      "Order parameters did not result in a valid basic fulfillment"
    );
  }

  const additionalRecipients = forAdditionalRecipients.map(
    ({ startAmount, recipient }) => ({ amount: startAmount, recipient })
  );

  const considerationWithoutOfferItemType = consideration.filter(
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

  validateOrderParameters(orderParameters, [], {
    balancesAndApprovals: offererBalancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientApprovals: true,
    considerationContract,
    proxy,
    proxyStrategy,
  });

  const { insufficientOwnerApprovals, insufficientProxyApprovals } =
    validateBasicFulfillBalancesAndApprovals(
      {
        offer,
        orderType,
        consideration,
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

  const basicOrderParameters: Omit<
    BasicOrderParametersStruct,
    "token" | "identifier"
  > = {
    offerer: orderParameters.offerer,
    zone: orderParameters.zone,
    orderType,
    startTime: orderParameters.startTime,
    endTime: orderParameters.endTime,
    salt: orderParameters.salt,
    signature,
    additionalRecipients,
  };

  const payableOverrides = { value: totalNativeAmount };

  const approvalActions = await getApprovalActions(approvalsToUse, {
    signer,
  });

  let sendTransaction: () => Promise<ContractTransaction>;
  let populatedTransaction: Promise<PopulatedTransaction>;

  switch (basicFulfillOrder) {
    case BasicFulfillOrder.ETH_FOR_ERC721:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicEthForERC721Order(
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          },
          payableOverrides
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicEthForERC721Order(
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          },
          payableOverrides
        );
      break;
    case BasicFulfillOrder.ETH_FOR_ERC1155:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicEthForERC1155Order(
          forOfferer.endAmount,
          // The order offer is ERC1155
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          },
          payableOverrides
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicEthForERC1155Order(
          forOfferer.endAmount,
          // The order offer is ERC1155
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          },
          payableOverrides
        );
      break;
    case BasicFulfillOrder.ERC20_FOR_ERC721:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicERC20ForERC721Order(
          // The order consideration is ERC20
          forOfferer.token,
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          }
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicERC20ForERC721Order(
          // The order consideration is ERC20
          forOfferer.token,
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          }
        );
      break;
    case BasicFulfillOrder.ERC20_FOR_ERC1155:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicERC20ForERC1155Order(
          // The order consideration is ERC20
          forOfferer.token,
          forOfferer.endAmount,
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          }
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicERC20ForERC1155Order(
          // The order consideration is ERC20
          forOfferer.token,
          forOfferer.endAmount,
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: offerItem.token,
            identifier: offerItem.identifierOrCriteria,
          }
        );
      break;
    case BasicFulfillOrder.ERC721_FOR_ERC20:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicERC721ForERC20Order(
          // The order offer is ERC20
          offerItem.token,
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: forOfferer.token,
            identifier: forOfferer.identifierOrCriteria,
          },
          useProxyForFulfiller
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicERC721ForERC20Order(
          // The order offer is ERC20
          offerItem.token,
          offerItem.endAmount,
          {
            ...basicOrderParameters,
            token: forOfferer.token,
            identifier: forOfferer.identifierOrCriteria,
          },
          useProxyForFulfiller
        );
      break;
    case BasicFulfillOrder.ERC1155_FOR_ERC20:
      sendTransaction = () =>
        considerationContract.connect(signer).fulfillBasicERC1155ForERC20Order(
          // The order offer is ERC20
          offerItem.token,
          offerItem.endAmount,
          // The order consideration is ERC1155
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: forOfferer.token,
            identifier: forOfferer.identifierOrCriteria,
          },
          useProxyForFulfiller
        );
      populatedTransaction =
        considerationContract.populateTransaction.fulfillBasicERC1155ForERC20Order(
          // The order offer is ERC20
          offerItem.token,
          offerItem.endAmount,
          // The order consideration is ERC1155
          forOfferer.endAmount,
          {
            ...basicOrderParameters,
            token: forOfferer.token,
            identifier: forOfferer.identifierOrCriteria,
          },
          useProxyForFulfiller
        );
  }

  if (sendTransaction === undefined) {
    throw new Error(
      "There was an error finding the correct basic fulfillment method to genActions"
    );
  }

  const exchangeAction = {
    type: "exchange",
    transactionRequest: {
      send: sendTransaction,
      populatedTransaction,
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
  }: {
    unitsToFill?: BigNumberish;
    totalFilled: BigNumber;
    totalSize: BigNumber;
    offerCriteria: InputCriteria[];
    considerationCriteria: InputCriteria[];
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

  const totalNativeAmount = getSummedTokenAndIdentifierAmounts(consideration, {
    criterias: considerationCriteria,
    timeBasedItemParams: {
      ...timeBasedItemParams,
      isConsiderationItem: true,
    },
  })[ethers.constants.AddressZero]?.["0"];

  validateOrderParameters(order.parameters, offerCriteria, {
    balancesAndApprovals: offererBalancesAndApprovals,
    timeBasedItemParams,
    throwOnInsufficientApprovals: true,
    considerationContract,
    proxy,
    proxyStrategy,
  });

  const { insufficientOwnerApprovals, insufficientProxyApprovals } =
    validateStandardFulfillBalancesAndApprovals(
      {
        offer,
        orderType,
        consideration,
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

  const considerationCriteriaItems = consideration.filter(
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

  const exchangeAction = {
    type: "exchange",
    transactionRequest: {
      send: () =>
        useAdvanced
          ? considerationContract.connect(signer).fulfillAdvancedOrder(
              { ...order, numerator, denominator },
              hasCriteriaItems
                ? generateCriteriaResolvers([order], {
                    offerCriterias: [offerCriteria],
                    considerationCriterias: [considerationCriteria],
                  })
                : [],
              useProxyForFulfiller,
              payableOverrides
            )
          : considerationContract
              .connect(signer)
              .fulfillOrder(order, useProxyForFulfiller, payableOverrides),
      populatedTransaction: useAdvanced
        ? considerationContract.populateTransaction.fulfillAdvancedOrder(
            { ...order, numerator, denominator },
            hasCriteriaItems
              ? generateCriteriaResolvers([order], {
                  offerCriterias: [offerCriteria],
                  considerationCriterias: [considerationCriteria],
                })
              : [],
            useProxyForFulfiller,
            payableOverrides
          )
        : considerationContract.populateTransaction.fulfillOrder(
            order,
            useProxyForFulfiller,
            payableOverrides
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
