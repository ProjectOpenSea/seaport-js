import { BigNumber, BigNumberish, Contract, ethers, providers } from "ethers";
import { ERC721ABI } from "../abi/ERC721";
import {
  Consideration,
  ERC20,
  ERC721,
  ProxyRegistryInterface,
} from "../typechain";
import { ItemType, MAX_INT, OrderType } from "../constants";
import { ProxyRegistryInterfaceABI } from "../abi/ProxyRegistryInterface";

import {
  Fee,
  InputItem,
  OfferItem,
  OrderParameters,
  ReceivedItem,
} from "../types";
import {
  approvedItemAmount,
  balanceOf,
  isCurrencyItem,
  isErc721Item,
  isErc1155Item,
} from "./item";

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
  provider: ethers.providers.JsonRpcProvider
) => {
  const { offer, consideration } = orderParameters;
  if (!areAllCurrenciesSame({ offer, consideration })) {
    throw new Error("All currency tokens in the order must be the same");
  }

  await validateOfferBalances(orderParameters, provider);
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
 * The offerer should have sufficient balance of all offered items.
 * @param orderParameters - standard Order parameters
 */
export const validateOfferBalances = async (
  { offer, offerer }: OrderParameters,
  provider: providers.JsonRpcProvider
) => {
  const insufficientBalances = await Promise.all(
    await getInsufficientCheckedAmounts(offer, async (item) =>
      balanceOf(offerer, item, provider)
    )
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      `The offerer does not have the amounts needed to create the order.`
    );
  }
};

/**
 * The offerer should have sufficient balance of all offered items.
 * @param orderParameters - standard Order parameters
 */
const getInsufficientCheckedAmounts = async (
  offer: OrderParameters["offer"],
  amountToCheck: (item: OfferItem) => Promise<BigNumber>
) => {
  const tokenAndIdentifierAndCheckedAmount = await Promise.all(
    offer.map(async (item) => {
      const checkedAmount = await amountToCheck(item);

      return [
        item.token,
        BigNumber.from(item.identifierOrCriteria).toString(),
        checkedAmount,
      ] as [string, string, BigNumber];
    })
  );

  const tokenAndIdentifierToBalance = tokenAndIdentifierAndCheckedAmount.reduce<
    Record<string, Record<string, BigNumber>>
  >(
    (map, [token, identifierOrCriteria, checkedAmount]) => ({
      ...map,
      [token]: { [identifierOrCriteria]: checkedAmount },
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

  const tokenAndIdentifierAndAmountNeeded = [
    ...Object.entries(tokenAndIdentifierToAmountNeeded).map(
      ([token, identifierToAmount]) =>
        Object.entries(identifierToAmount).map(
          ([identifierOrCriteria, amount]) =>
            [token, identifierOrCriteria, amount] as const
        )
    ),
  ].flat();

  const insufficientAmounts = tokenAndIdentifierAndAmountNeeded.filter(
    ([token, identifierOrCriteria, amount]) =>
      tokenAndIdentifierToBalance[token][identifierOrCriteria].lt(amount)
  );

  return insufficientAmounts;
};

/**
 * The following must be checked when creating offers
 * 1. If the order does not indicate proxy utilization, the offerer should have sufficient approvals
 *    set for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 2. If the order does indicate proxy utilization, the offerer should have sufficient approvals
 *    set for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const checkApprovals = async (
  { offer, offerer, orderType }: OrderParameters,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: ethers.providers.JsonRpcProvider;
  }
) => {
  const useProxy = [
    OrderType.FULL_OPEN_VIA_PROXY,
    OrderType.PARTIAL_OPEN_VIA_PROXY,
    OrderType.FULL_RESTRICTED_VIA_PROXY,
    OrderType.PARTIAL_RESTRICTED_VIA_PROXY,
  ].includes(orderType);

  const signer = provider.getSigner();

  const proxyRegistryInterface = new Contract(
    legacyProxyRegistryAddress,
    ProxyRegistryInterfaceABI,
    provider
  ) as ProxyRegistryInterface;

  const operator = useProxy
    ? await proxyRegistryInterface.proxies(offerer)
    : considerationContract.address;

  if (useProxy) {
    const insufficientAmounts = await Promise.all(
      await getInsufficientCheckedAmounts(offer, (item) =>
        approvedItemAmount(offerer, item, operator, provider)
      )
    );

    for (const [token] of insufficientAmounts) {
      // This is guaranteed to exist
      const item = offer.find((item) => item.token === token) as OfferItem;

      if (isErc721Item(item) || isErc1155Item(item)) {
        // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
        const contract = new Contract(token, ERC721ABI, signer) as ERC721;
        await contract.setApprovalForAll(operator, true);
      } else if (item.itemType === ItemType.ERC20) {
        const contract = new Contract(token, ERC721ABI, signer) as ERC20;
        await contract.approve(operator, MAX_INT);
      }
    }
  }
};
