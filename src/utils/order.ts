import { BigNumber, BigNumberish, Contract, ethers, providers } from "ethers";
import { ConsiderationABI } from "../abi/Consideration";
import { Consideration } from "../typechain";
import { ItemType, OrderType } from "../constants";
import {
  Fee,
  InputItem,
  OfferItem,
  Order,
  OrderParameters,
  ConsiderationItem,
} from "../types";
import {
  BalancesAndApprovals,
  InsufficientApprovals,
  validateOfferBalancesAndApprovals,
} from "./balancesAndApprovals";
import { isCurrencyItem } from "./item";
import { providers as multicallProviders } from "@0xsequence/multicall";

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
}): ConsiderationItem => {
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

export const validateOrderParameters = (
  orderParameters: OrderParameters,
  {
    balancesAndApprovals,
    throwOnInsufficientApprovals,
  }: {
    balancesAndApprovals: BalancesAndApprovals;
    throwOnInsufficientApprovals?: boolean;
  }
): InsufficientApprovals => {
  const { offer, consideration, orderType } = orderParameters;
  if (!areAllCurrenciesSame({ offer, consideration })) {
    throw new Error("All currency tokens in the order must be the same");
  }

  return validateOfferBalancesAndApprovals(
    { offer, orderType },
    { balancesAndApprovals, throwOnInsufficientApprovals }
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

export const useFulfillerProxy = ({
  insufficientOwnerApprovals,
  insufficientProxyApprovals,
}: {
  insufficientOwnerApprovals: InsufficientApprovals;
  insufficientProxyApprovals: InsufficientApprovals;
}) => {
  const approvalsToUse =
    insufficientOwnerApprovals.length === 0
      ? insufficientOwnerApprovals
      : insufficientProxyApprovals;

  return approvalsToUse === insufficientProxyApprovals;
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

export const getOrderHash = async (
  order: Order,
  nonce: BigNumber,
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

  return contract.getOrderHash({ ...order.parameters, nonce });
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

  return contract.getNonce(offerer, zone);
};

export const shouldUseMatchForFulfill = () => true;
