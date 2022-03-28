import { BigNumber, BigNumberish, Contract, ethers, providers } from "ethers";
import { ConsiderationABI } from "../abi/Consideration";
import type { Consideration } from "../typechain";
import {
  ItemType,
  ONE_HUNDRED_PERCENT_BP,
  OrderType,
  ProxyStrategy,
} from "../constants";
import type {
  Fee,
  InputItem,
  OfferItem,
  Order,
  OrderParameters,
  ConsiderationItem,
  OrderComponents,
  AdvancedOrder,
  Item,
} from "../types";
import {
  BalancesAndApprovals,
  InsufficientApprovals,
  validateOfferBalancesAndApprovals,
} from "./balancesAndApprovals";
import { getMaximumSizeForOrder, isCurrencyItem } from "./item";
import { providers as multicallProviders } from "@0xsequence/multicall";
import { gcd } from "./gcd";

export const ORDER_OPTIONS_TO_ORDER_TYPE = {
  FULL: {
    OPEN: {
      WITHOUT_PROXY: OrderType.FULL_OPEN,
      VIA_PROXY: OrderType.FULL_OPEN_VIA_PROXY,
    },
    RESTRICTED: {
      WITHOUT_PROXY: OrderType.FULL_RESTRICTED,
      VIA_PROXY: OrderType.FULL_RESTRICTED_VIA_PROXY,
    },
  },
  PARTIAL: {
    OPEN: {
      WITHOUT_PROXY: OrderType.PARTIAL_OPEN,
      VIA_PROXY: OrderType.PARTIAL_OPEN_VIA_PROXY,
    },
    RESTRICTED: {
      WITHOUT_PROXY: OrderType.PARTIAL_RESTRICTED,
      VIA_PROXY: OrderType.PARTIAL_RESTRICTED_VIA_PROXY,
    },
  },
} as const;
const multiplyBasisPoints = (amount: BigNumberish, basisPoints: number) =>
  BigNumber.from(amount)
    .mul(BigNumber.from(basisPoints))
    .div(ONE_HUNDRED_PERCENT_BP);

export const feeToConsiderationItem = ({
  fee,
  token,
  baseAmount,
  baseEndAmount = baseAmount,
}: {
  fee: Fee;
  token: string;
  baseAmount: BigNumberish;
  baseEndAmount?: BigNumberish;
}): ConsiderationItem => {
  return {
    itemType:
      token === ethers.constants.AddressZero ? ItemType.NATIVE : ItemType.ERC20,
    token,
    identifierOrCriteria: "0",
    startAmount: multiplyBasisPoints(baseAmount, fee.basisPoints).toString(),
    endAmount: multiplyBasisPoints(baseEndAmount, fee.basisPoints).toString(),
    recipient: fee.recipient,
  };
};

export const deductFees = <T extends Item>(
  items: T[],
  fees?: readonly Fee[]
): T[] => {
  if (!fees) {
    return items;
  }

  const totalBasisPoints = fees.reduce(
    (accBasisPoints, fee) => accBasisPoints + fee.basisPoints,
    0
  );

  return items.map((item) => ({
    ...item,
    startAmount: isCurrencyItem(item)
      ? BigNumber.from(item.startAmount)
          .sub(multiplyBasisPoints(item.startAmount, totalBasisPoints))
          .toString()
      : item.startAmount,
    endAmount: isCurrencyItem(item)
      ? BigNumber.from(item.endAmount)
          .sub(multiplyBasisPoints(item.startAmount, totalBasisPoints))
          .toString()
      : item.endAmount,
  }));
};

export const mapInputItemToOfferItem = (item: InputItem): OfferItem => {
  // Item is an NFT
  if ("itemType" in item) {
    return {
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifierOrCriteria,
      startAmount: item.amount ?? "1",
      endAmount: item.amount ?? "1",
    };
  }
  // Item is a currency
  return {
    itemType:
      item.token && item.token !== ethers.constants.AddressZero
        ? ItemType.ERC20
        : ItemType.NATIVE,
    token: item.token ?? ethers.constants.AddressZero,
    identifierOrCriteria: "0",
    startAmount: item.amount,
    endAmount: item.endAmount ?? item.amount,
  };
};

export const areAllCurrenciesSame = ({
  offer,
  consideration,
}: Pick<OrderParameters, "offer" | "consideration">) => {
  const allItems = [...offer, ...consideration];
  const currencies = allItems.filter(isCurrencyItem);

  return currencies.every(
    ({ itemType, token }) =>
      itemType === currencies[0].itemType &&
      token.toLowerCase() === currencies[0].token.toLowerCase()
  );
};

export const validateOrderParameters = (
  orderParameters: OrderParameters,
  {
    balancesAndApprovals,
    throwOnInsufficientBalances,
    throwOnInsufficientApprovals,
    considerationContract,
    proxy,
    proxyStrategy,
  }: {
    balancesAndApprovals: BalancesAndApprovals;
    throwOnInsufficientBalances?: boolean;
    throwOnInsufficientApprovals?: boolean;
    considerationContract: Consideration;
    proxy: string;
    proxyStrategy: ProxyStrategy;
  }
): InsufficientApprovals => {
  const { offer, consideration, orderType } = orderParameters;
  if (!areAllCurrenciesSame({ offer, consideration })) {
    throw new Error("All currency tokens in the order must be the same token");
  }

  return validateOfferBalancesAndApprovals(
    { offer, orderType },
    {
      balancesAndApprovals,
      throwOnInsufficientBalances,
      throwOnInsufficientApprovals,
      considerationContract,
      proxy,
      proxyStrategy,
    }
  );
};

export const totalItemsAmount = <T extends OfferItem>(items: T[]) => {
  const initialValues = {
    startAmount: BigNumber.from(0),
    endAmount: BigNumber.from(0),
  };

  return items
    .map(({ startAmount, endAmount }) => ({
      startAmount,
      endAmount,
    }))
    .reduce<typeof initialValues>(
      (
        { startAmount: totalStartAmount, endAmount: totalEndAmount },
        { startAmount, endAmount }
      ) => ({
        startAmount: totalStartAmount.add(startAmount),
        endAmount: totalEndAmount.add(endAmount),
      }),
      {
        startAmount: BigNumber.from(0),
        endAmount: BigNumber.from(0),
      }
    );
};

export const useOffererProxy = (orderType: OrderType) =>
  [
    OrderType.FULL_OPEN_VIA_PROXY,
    OrderType.PARTIAL_OPEN_VIA_PROXY,
    OrderType.FULL_RESTRICTED_VIA_PROXY,
    OrderType.PARTIAL_RESTRICTED_VIA_PROXY,
  ].includes(orderType);

export const useProxyFromApprovals = ({
  insufficientOwnerApprovals,
  insufficientProxyApprovals,
  proxyStrategy,
}: {
  insufficientOwnerApprovals: InsufficientApprovals;
  insufficientProxyApprovals: InsufficientApprovals;
  proxyStrategy: ProxyStrategy;
}) => {
  return proxyStrategy === ProxyStrategy.IF_ZERO_APPROVALS_NEEDED
    ? insufficientProxyApprovals.length < insufficientOwnerApprovals.length &&
        insufficientOwnerApprovals.length !== 0
    : proxyStrategy === ProxyStrategy.ALWAYS;
};

export const getOrderStatus = async (
  orderHash: string,
  {
    considerationContract,
    provider,
  }: {
    considerationContract: Consideration;
    provider: providers.JsonRpcProvider;
  }
) => {
  const contract = new Contract(
    considerationContract.address,
    ConsiderationABI,
    provider
  ) as Consideration;

  return contract.getOrderStatus(orderHash);
};

/**
 * Calculates the order hash of order components so we can forgo executing a request to the contract
 * This saves us RPC calls and latency.
 */
export const getOrderHash = (orderComponents: OrderComponents) => {
  const offerItemTypeString =
    "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";
  const considerationItemTypeString =
    "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)";
  const orderComponentsPartialTypeString =
    "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,uint256 salt,uint256 nonce)";
  const orderTypeString = `${orderComponentsPartialTypeString}${considerationItemTypeString}${offerItemTypeString}`;

  const offerItemTypeHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(offerItemTypeString)
  );
  const considerationItemTypeHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(considerationItemTypeString)
  );
  const orderTypeHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(orderTypeString)
  );

  const offerHash = ethers.utils.keccak256(
    "0x" +
      orderComponents.offer
        .map((offerItem) => {
          return ethers.utils
            .keccak256(
              "0x" +
                [
                  offerItemTypeHash.slice(2),
                  offerItem.itemType.toString().padStart(64, "0"),
                  offerItem.token.slice(2).padStart(64, "0"),
                  ethers.BigNumber.from(offerItem.identifierOrCriteria)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                  ethers.BigNumber.from(offerItem.startAmount)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                  ethers.BigNumber.from(offerItem.endAmount)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                ].join("")
            )
            .slice(2);
        })
        .join("")
  );

  const considerationHash = ethers.utils.keccak256(
    "0x" +
      orderComponents.consideration
        .map((considerationItem) => {
          return ethers.utils
            .keccak256(
              "0x" +
                [
                  considerationItemTypeHash.slice(2),
                  considerationItem.itemType.toString().padStart(64, "0"),
                  considerationItem.token.slice(2).padStart(64, "0"),
                  ethers.BigNumber.from(considerationItem.identifierOrCriteria)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                  ethers.BigNumber.from(considerationItem.startAmount)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                  ethers.BigNumber.from(considerationItem.endAmount)
                    .toHexString()
                    .slice(2)
                    .padStart(64, "0"),
                  considerationItem.recipient.slice(2).padStart(64, "0"),
                ].join("")
            )
            .slice(2);
        })
        .join("")
  );

  const derivedOrderHash = ethers.utils.keccak256(
    "0x" +
      [
        orderTypeHash.slice(2),
        orderComponents.offerer.slice(2).padStart(64, "0"),
        orderComponents.zone.slice(2).padStart(64, "0"),
        offerHash.slice(2),
        considerationHash.slice(2),
        orderComponents.orderType.toString().padStart(64, "0"),
        ethers.BigNumber.from(orderComponents.startTime)
          .toHexString()
          .slice(2)
          .padStart(64, "0"),
        ethers.BigNumber.from(orderComponents.endTime)
          .toHexString()
          .slice(2)
          .padStart(64, "0"),
        orderComponents.salt.slice(2).padStart(64, "0"),
        ethers.BigNumber.from(orderComponents.nonce)
          .toHexString()
          .slice(2)
          .padStart(64, "0"),
      ].join("")
  );

  return derivedOrderHash;
};

export const getNonce = (
  { offerer, zone }: { offerer: string; zone: string },
  {
    considerationContract,
    multicallProvider,
  }: {
    considerationContract: Consideration;
    multicallProvider: multicallProviders.MulticallProvider;
  }
) => {
  const contract = new Contract(
    considerationContract.address,
    ConsiderationABI,
    multicallProvider
  ) as Consideration;

  return contract.getNonce(offerer, zone).then((nonce) => nonce.toNumber());
};

/**
 * Maps order offer and consideration item amounts based on the order's filled status
 * After applying the fraction, we can view this order as the "canonical" order for which we
 * check approvals and balances
 */
export const mapOrderAmountsFromFilledStatus = (
  order: Order,
  { totalFilled, totalSize }: { totalFilled: BigNumber; totalSize: BigNumber }
): Order => {
  if (totalFilled.eq(0) || totalSize.eq(0)) {
    return order;
  }

  // i.e if totalFilled is 3 and totalSize is 4, there are 1 / 4 order amounts left to fill.
  const basisPoints = totalSize
    .sub(totalFilled)
    .mul(ONE_HUNDRED_PERCENT_BP)
    .div(totalSize);

  const mapAmountToPartialAmount = (amount: string) =>
    BigNumber.from(amount)
      .mul(basisPoints)
      .div(ONE_HUNDRED_PERCENT_BP)
      .toString();

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map((item) => ({
        ...item,
        startAmount: mapAmountToPartialAmount(item.startAmount),
        endAmount: mapAmountToPartialAmount(item.endAmount),
      })),
      consideration: order.parameters.consideration.map((item) => ({
        ...item,
        startAmount: mapAmountToPartialAmount(item.startAmount),
        endAmount: mapAmountToPartialAmount(item.endAmount),
      })),
    },
    signature: order.signature,
  };
};

/**
 * Maps order offer and consideration item amounts based on the units needed to fulfill
 * After applying the fraction, we can view this order as the "canonical" order for which we
 * check approvals and balances
 * Returns the numerator and denominator as well, converting this to an AdvancedOrder
 */
export const mapOrderAmountsFromUnitsToFill = (
  order: Order,
  {
    unitsToFill,
    totalFilled,
    totalSize,
  }: { unitsToFill: BigNumberish; totalFilled: BigNumber; totalSize: BigNumber }
): AdvancedOrder => {
  const unitsToFillBn = BigNumber.from(unitsToFill);

  if (unitsToFillBn.lte(0)) {
    throw new Error("Units to fill must be greater than 1");
  }

  const maxUnits = getMaximumSizeForOrder(order);

  // This is the percentage of the order that is left to be fulfilled, and therefore we can't fill more than that.
  const remainingOrderPercentageToBeFilled = totalSize
    .sub(totalFilled)
    .mul(ONE_HUNDRED_PERCENT_BP)
    .div(totalSize);

  // i.e if totalSize is 8 and unitsToFill is 3, then we multiply every amount by 3 / 8
  const unitsToFillBasisPoints = unitsToFillBn
    .mul(ONE_HUNDRED_PERCENT_BP)
    .div(maxUnits);

  // We basically choose the lesser between the units requested to be filled and the actual remaining order amount left
  // This is so that if a user tries to fulfill an order that is 1/2 filled, and supplies a fraction such as 3/4, the maximum
  // amount to fulfill is 1/2 instead of 3/4
  const basisPoints = remainingOrderPercentageToBeFilled.gt(
    unitsToFillBasisPoints
  )
    ? unitsToFillBasisPoints
    : remainingOrderPercentageToBeFilled;

  const mapAmountToPartialAmount = (amount: string) =>
    BigNumber.from(amount)
      .mul(basisPoints)
      .div(ONE_HUNDRED_PERCENT_BP)
      .toString();

  // Reduce the numerator/denominator as optimization
  const unitsGcd = gcd(unitsToFillBn, maxUnits);

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map((item) => ({
        ...item,
        startAmount: mapAmountToPartialAmount(item.startAmount),
        endAmount: mapAmountToPartialAmount(item.endAmount),
      })),
      consideration: order.parameters.consideration.map((item) => ({
        ...item,
        startAmount: mapAmountToPartialAmount(item.startAmount),
        endAmount: mapAmountToPartialAmount(item.endAmount),
      })),
    },
    signature: order.signature,
    numerator: unitsToFillBn.div(unitsGcd),
    denominator: maxUnits.div(unitsGcd),
  };
};

export const generateRandomSalt = () => {
  return `0x${Buffer.from(ethers.utils.randomBytes(16)).toString("hex")}`;
};

export const shouldUseMatchForFulfill = () => true;
