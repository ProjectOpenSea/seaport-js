import { BigNumber, BigNumberish, ethers } from "ethers";
import { concat, keccak256, randomBytes, toUtf8Bytes } from "ethers/lib/utils";
import { ItemType, ONE_HUNDRED_PERCENT_BP } from "../constants";
import type {
  ConsiderationItem,
  CreateInputItem,
  Fee,
  Item,
  OfferItem,
  Order,
  OrderParameters,
} from "../types";
import { getMaximumSizeForOrder, isCurrencyItem } from "./item";
import { MerkleTree } from "./merkletree";

const multiplyBasisPoints = (amount: BigNumberish, basisPoints: BigNumberish) =>
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
  fees?: readonly Fee[],
): T[] => {
  if (!fees) {
    return items;
  }

  const totalBasisPoints = fees.reduce(
    (accBasisPoints, fee) => accBasisPoints + fee.basisPoints,
    0,
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
          .sub(multiplyBasisPoints(item.endAmount, totalBasisPoints))
          .toString()
      : item.endAmount,
  }));
};

export const mapInputItemToOfferItem = (item: CreateInputItem): OfferItem => {
  if ("itemType" in item) {
    // Convert this to a criteria based item
    if ("identifiers" in item || "criteria" in item) {
      const root =
        "criteria" in item
          ? item.criteria
          : new MerkleTree(item.identifiers).getRoot();

      return {
        itemType:
          item.itemType === ItemType.ERC721
            ? ItemType.ERC721_WITH_CRITERIA
            : ItemType.ERC1155_WITH_CRITERIA,
        token: item.token,
        identifierOrCriteria: root,
        startAmount: item.amount ?? "1",
        endAmount: item.endAmount ?? item.amount ?? "1",
      };
    }

    if ("amount" in item || "endAmount" in item) {
      return {
        itemType: item.itemType,
        token: item.token,
        // prevent undefined for fungible items
        identifierOrCriteria: item.identifier ?? "0",
        // @ts-ignore
        startAmount: item.amount,
        // @ts-ignore
        endAmount: item.endAmount ?? item.amount ?? "1",
      };
    }

    return {
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifier,
      startAmount: "1",
      endAmount: "1",
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
      token.toLowerCase() === currencies[0].token.toLowerCase(),
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
        { startAmount, endAmount },
      ) => ({
        startAmount: totalStartAmount.add(startAmount),
        endAmount: totalEndAmount.add(endAmount),
      }),
      {
        startAmount: BigNumber.from(0),
        endAmount: BigNumber.from(0),
      },
    );
};

/**
 * Maps order offer and consideration item amounts based on the order's filled status
 * After applying the fraction, we can view this order as the "canonical" order for which we
 * check approvals and balances
 */
export const mapOrderAmountsFromFilledStatus = (
  order: Order,
  { totalFilled, totalSize }: { totalFilled: BigNumber; totalSize: BigNumber },
): Order => {
  if (totalFilled.eq(0) || totalSize.eq(0)) {
    return order;
  }

  // i.e if totalFilled is 3 and totalSize is 4, there are 1 / 4 order amounts left to fill.
  const basisPoints = totalSize
    .sub(totalFilled)
    .mul(ONE_HUNDRED_PERCENT_BP)
    .div(totalSize);

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map((item) => ({
        ...item,
        startAmount: multiplyBasisPoints(
          item.startAmount,
          basisPoints,
        ).toString(),
        endAmount: multiplyBasisPoints(item.endAmount, basisPoints).toString(),
      })),
      consideration: order.parameters.consideration.map((item) => ({
        ...item,
        startAmount: multiplyBasisPoints(
          item.startAmount,
          basisPoints,
        ).toString(),
        endAmount: multiplyBasisPoints(item.endAmount, basisPoints).toString(),
      })),
    },
    signature: order.signature,
  };
};

const multiplyDivision = (
  amount: BigNumberish,
  numerator: BigNumberish,
  denominator: BigNumberish,
) => BigNumber.from(amount).mul(BigNumber.from(numerator)).div(denominator);

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
    totalSize,
  }: { unitsToFill: BigNumberish; totalSize: BigNumber },
): Order => {
  const unitsToFillBn = BigNumber.from(unitsToFill);

  if (unitsToFillBn.lte(0)) {
    throw new Error("Units to fill must be greater than 1");
  }

  const maxUnits = getMaximumSizeForOrder(order);

  if (totalSize.eq(0)) {
    totalSize = maxUnits;
  }

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map((item) => ({
        ...item,
        startAmount: multiplyDivision(
          item.startAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
        endAmount: multiplyDivision(
          item.endAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
      })),
      consideration: order.parameters.consideration.map((item) => ({
        ...item,
        startAmount: multiplyDivision(
          item.startAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
        endAmount: multiplyDivision(
          item.endAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
      })),
    },
    signature: order.signature,
  };
};

export const generateRandomSalt = (domain?: string) => {
  if (domain) {
    return `0x${Buffer.from(
      concat([
        keccak256(toUtf8Bytes(domain)).slice(0, 10),
        Uint8Array.from(Array(20).fill(0)),
        randomBytes(8),
      ]),
    ).toString("hex")}`;
  }
  return `0x${Buffer.from(randomBytes(8)).toString("hex").padStart(64, "0")}`;
};

export const shouldUseMatchForFulfill = () => true;
