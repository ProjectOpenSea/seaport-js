import { BigNumber, Contract, providers } from "ethers";
import { ERC721ABI } from "../abi/ERC721";
import { ProxyRegistryInterfaceABI } from "../abi/ProxyRegistryInterface";
import { ItemType, MAX_INT } from "../constants";
import {
  Consideration,
  ERC20,
  ERC721,
  ProxyRegistryInterface,
} from "../typechain";
import { Item, OfferItem, OrderParameters } from "../types";
import { isErc1155Item, isErc721Item } from "./item";
import { useOffererProxy } from "./order";

// get balances first
// get approvals
// get order status
// from multicall

// when fulfilling order
// if validated or order is already filled, it's validated
// then pass in empty signature into fulfillOrder call

export const approvedItemAmount = async (
  owner: string,
  item: Item,
  operator: string,
  provider: providers.JsonRpcProvider
) => {
  if (isErc721Item(item) || isErc1155Item(item)) {
    // isApprovedForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC721;
    const isApprovedForAll = await contract.isApprovedForAll(owner, operator);

    return isApprovedForAll ? MAX_INT : BigNumber.from(0);
  } else if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC20;

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * The offerer should have sufficient checked amounts of all offered items.
 * @param orderParameters - standard Order parameters
 * @param amountToCheck - function that returns the specific amount to check for
 */
export const getInsufficientCheckedAmounts = async (
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

  const tokenAndIdentifierToCheckedAmount =
    tokenAndIdentifierAndCheckedAmount.reduce<
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
          ([identifierOrCriteria, amountNeeded]) =>
            [token, identifierOrCriteria, amountNeeded] as const
        )
    ),
  ].flat();

  const insufficientAmounts = tokenAndIdentifierAndAmountNeeded.filter(
    ([token, identifierOrCriteria, amountNeeded]) =>
      tokenAndIdentifierToCheckedAmount[token][identifierOrCriteria].lt(
        amountNeeded
      )
  );

  return insufficientAmounts.map(([token, identifierOrCriteria, amount]) => ({
    token,
    identifierOrCriteria,
    amountNeeded: amount,
    amountHave: tokenAndIdentifierToCheckedAmount[token][identifierOrCriteria],
  }));
};

/**
 * The following must be checked when creating orders
 * 1. If the order does not indicate proxy utilization, the offerer should have sufficient approvals
 *    set for the Consideration contract for all offered ERC20, ERC721, and ERC1155 items.
 * 2. If the order does indicate proxy utilization, the offerer should have sufficient approvals
 *    set for their respective proxy contract for all offered ERC20, ERC721, and ERC1155 items.
 */
export const setNeededApprovalsForOrderCreation = async (
  { offer, offerer, orderType }: OrderParameters,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: providers.JsonRpcProvider;
  }
) => {
  const operator = await getApprovalOperator(
    { offerer, orderType },
    { considerationContract, legacyProxyRegistryAddress, provider }
  );

  const insufficientApprovals = await getNeededApprovalsForOrderCreation(
    {
      offer,
      offerer,
      orderType,
    },
    {
      considerationContract,
      legacyProxyRegistryAddress,
      provider,
    }
  );

  const signer = provider.getSigner();

  for (const { token } of insufficientApprovals) {
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
};

export const getNeededApprovalsForOrderCreation = async (
  {
    offer,
    offerer,
    orderType,
  }: Pick<OrderParameters, "offer" | "offerer" | "orderType">,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: providers.JsonRpcProvider;
  }
) => {
  const operator = await getApprovalOperator(
    { offerer, orderType },
    { considerationContract, legacyProxyRegistryAddress, provider }
  );

  const insufficientAmounts = await Promise.all(
    await getInsufficientCheckedAmounts(offer, (item) =>
      approvedItemAmount(offerer, item, operator, provider)
    )
  );

  return insufficientAmounts;
};

export const getNeededApprovalsForBasicFulfill = async (
  {
    offer,
    offerer,
    orderType,
  }: Pick<OrderParameters, "offer" | "offerer" | "orderType">,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: providers.JsonRpcProvider;
  }
) => {
  const operator = await getApprovalOperator(
    { offerer, orderType },
    { considerationContract, legacyProxyRegistryAddress, provider }
  );

  const insufficientAmounts = await Promise.all(
    await getInsufficientCheckedAmounts(offer, (item) =>
      approvedItemAmount(offerer, item, operator, provider)
    )
  );

  return insufficientAmounts;
};

export const getApprovalOperator = async (
  { offerer, orderType }: Pick<OrderParameters, "offerer" | "orderType">,
  {
    considerationContract,
    legacyProxyRegistryAddress,
    provider,
  }: {
    considerationContract: Consideration;
    legacyProxyRegistryAddress: string;
    provider: providers.JsonRpcProvider;
  }
) => {
  const useProxy = useOffererProxy(orderType);

  const proxyRegistryInterface = new Contract(
    legacyProxyRegistryAddress,
    ProxyRegistryInterfaceABI,
    provider
  ) as ProxyRegistryInterface;

  const operator = useProxy
    ? await proxyRegistryInterface.proxies(offerer)
    : considerationContract.address;

  return operator;
};
