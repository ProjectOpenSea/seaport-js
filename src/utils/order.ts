import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, BigNumberish, ethers } from "ethers";
import { ItemType, OrderType } from "../constants";
import {
  Fee,
  InputItem,
  OfferItem,
  Order,
  OrderParameters,
  ReceivedItem,
} from "../types";
import { validateOfferBalances } from "./balance";
import { BalancesAndApprovals } from "./balancesAndApprovals";
import { isCurrencyItem } from "./item";

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
}): ReceivedItem => {
  const multiplyBasisPoints = (amount: BigNumberish) =>
    BigNumber.from(amount).mul(BigNumber.from(fee.basisPoints).div(10000));

  return {
    itemType:
      token === ethers.constants.AddressZero ? ItemType.NATIVE : ItemType.ERC20,
    token,
    identifierOrCriteria: 0,
    startAmount: multiplyBasisPoints(baseAmount).toString(),
    endAmount: multiplyBasisPoints(baseEndAmount).toString(),
    recipient: fee.recipient,
  };
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
      item.token === ethers.constants.AddressZero
        ? ItemType.NATIVE
        : ItemType.ERC20,
    token: item.token ?? ethers.constants.AddressZero,
    identifierOrCriteria: 0,
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

export const validateOrderParameters = async (
  orderParameters: OrderParameters,
  balancesAndApprovals: BalancesAndApprovals
) => {
  const { offer, consideration } = orderParameters;
  if (!areAllCurrenciesSame({ offer, consideration })) {
    throw new Error("All currency tokens in the order must be the same");
  }

  validateOfferBalances(offer, { balancesAndApprovals });
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

export const getOrderStatus = (order: Order) => {};
