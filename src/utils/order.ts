import { BigNumber, BigNumberish, ethers, providers } from "ethers";
import { ItemType, OrderType } from "../constants";
import {
  Fee,
  InputItem,
  OfferItem,
  OrderParameters,
  ReceivedItem,
} from "../types";
import { balanceOf, isCurrencyItem } from "./item";

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
    startAmount: multiplyBasisPoints(baseAmount),
    endAmount: multiplyBasisPoints(baseEndAmount),
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
      startAmount: item.amount ?? 1,
      endAmount: item.amount ?? 1,
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

export const validateOrderParameters = ({
  offer,
  consideration,
}: OrderParameters) => {
  if (!areAllCurrenciesSame({ offer, consideration })) {
    throw new Error("All currency tokens in the order must be the same");
  }
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

/**
 * When creating an offer, the following requirements should be checked to ensure that the order will be fulfillable:
 * 1. The offerer should have sufficient balance of all offered items.
 * 2. If the order does not indicate proxy utilization, the offerer should have sufficient approvals
 *    set for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 3. If the order does indicate proxy utilization, the offerer should have sufficient approvals
 *    set for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 * @param orderParameters - standard Order parameters
 */
export const validateBalances = async (
  { offer, offerer }: OrderParameters,
  provider: providers.JsonRpcProvider
) => {
  const tokenAndIdentifierAndBalance = await Promise.all(
    offer.map(async (item) => {
      const balance = await balanceOf(offerer, item, provider);

      return [
        item.token,
        BigNumber.from(item.identifierOrCriteria).toString(),
        balance,
      ] as [string, string, BigNumber];
    })
  );

  const tokenAndIdentifierToBalance = tokenAndIdentifierAndBalance.reduce<
    Record<string, Record<string, BigNumber>>
  >(
    (map, [token, identifierOrCriteria, balance]) => ({
      ...map,
      [token]: { [identifierOrCriteria]: balance },
    }),
    {}
  );

  const tokenAndIdentifierToAmountNeeded = offer.reduce<
    Record<string, Record<string, BigNumber>>
  >((map, item) => {
    const identifierOrCriteria = BigNumber.from(
      item.identifierOrCriteria
    ).toString();

    const startAmount = BigNumber.from(item.startAmount);
    const endAmount = BigNumber.from(item.endAmount);
    const maxAmount = startAmount.gt(endAmount) ? startAmount : endAmount;

    return {
      ...map,
      [item.token]: {
        // Being explicit about the undefined type as it's possible for it to be undefined at first iteration
        [identifierOrCriteria]: (
          (map[item.token][identifierOrCriteria] as BigNumber | undefined) ??
          BigNumber.from(0)
        ).add(maxAmount),
      },
    };
  }, {});
};
