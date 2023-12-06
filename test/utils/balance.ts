import { BigNumberish, ethers, toBeHex, TransactionReceipt } from "ethers";
import { parseEther } from "ethers";
import { Item, Order, OrderStatus } from "../../src/types";
import { balanceOf } from "../../src/utils/balance";

import {
  getPresentItemAmount,
  TimeBasedItemParams,
} from "../../src/utils/item";
import { expect } from "chai";
import {
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
} from "../../src/utils/order";

export const setBalance = async (
  address: string,
  provider: ethers.JsonRpcProvider,
  amountEth = toBeHex(parseEther("10000")).replace("0x0", "0x"),
) => {
  await provider.send("hardhat_setBalance", [
    address,
    toBeHex(parseEther(amountEth)).replace("0x0", "0x"),
  ]);
};

export const getBalancesForFulfillOrder = async (
  order: Order,
  fulfillerAddress: string,
  provider: ethers.Provider,
) => {
  const { offer, consideration, offerer } = order.parameters;

  const relevantAddresses = Array.from(
    new Set([
      offerer,
      fulfillerAddress,
      ...consideration.map((item) => item.recipient),
    ]),
  );

  const ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  > = {};

  relevantAddresses.forEach((address) => {
    ownerToTokenToIdentifierBalances[address] = {};
  });

  // Just prepopulate all the keys so we can do an async map
  for (const item of [...offer, ...consideration]) {
    for (const address of relevantAddresses) {
      ownerToTokenToIdentifierBalances[address] = {
        ...ownerToTokenToIdentifierBalances[address],
        [item.token]: {
          [item.identifierOrCriteria]: {
            item,
            balance: 0n,
          },
        },
      };
    }
  }

  await Promise.all(
    [...offer, ...consideration].map((item) =>
      Promise.all([
        ...relevantAddresses.map(async (address) => {
          ownerToTokenToIdentifierBalances[address][item.token][
            item.identifierOrCriteria
          ] = {
            item,
            balance: await balanceOf(address, item, provider),
          };
        }),
      ]),
    ),
  );

  return ownerToTokenToIdentifierBalances;
};

export const verifyBalancesAfterFulfill = async ({
  ownerToTokenToIdentifierBalances,
  order,
  unitsToFill,
  orderStatus,
  fulfillReceipt,
  fulfillerAddress,
  provider,
  timeBasedItemParams,
}: {
  ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: bigint; item: Item }>>
  >;
  order: Order;
  orderStatus?: OrderStatus;
  unitsToFill?: BigNumberish;
  fulfillReceipt: TransactionReceipt;
  fulfillerAddress: string;
  provider: ethers.Provider;
  timeBasedItemParams?: TimeBasedItemParams;
}) => {
  const totalFilled = orderStatus?.totalFilled ?? 0n;
  const totalSize = orderStatus?.totalSize ?? 0n;

  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalSize,
      })
    : mapOrderAmountsFromFilledStatus(order, {
        totalFilled,
        totalSize,
      });

  const { offer, consideration, offerer } = orderWithAdjustedFills.parameters;

  // Offer items are depleted
  offer.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: false }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[offerer][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[offerer][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };
  });

  consideration.forEach((item) => {
    const exchangedAmount = getPresentItemAmount({
      startAmount: item.startAmount,
      endAmount: item.endAmount,
      timeBasedItemParams: timeBasedItemParams
        ? { ...timeBasedItemParams, isConsiderationItem: true }
        : undefined,
    });

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance - exchangedAmount,
    };

    ownerToTokenToIdentifierBalances[item.recipient][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[item.recipient][item.token][
          item.identifierOrCriteria
        ].balance + exchangedAmount,
    };
  });

  // Take into account gas costs
  if (ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress]) {
    ownerToTokenToIdentifierBalances[fulfillerAddress][ethers.ZeroAddress][0] =
      {
        ...ownerToTokenToIdentifierBalances[fulfillerAddress][
          ethers.ZeroAddress
        ][0],
        balance:
          ownerToTokenToIdentifierBalances[fulfillerAddress][
            ethers.ZeroAddress
          ][0].balance -
          fulfillReceipt.gasUsed * fulfillReceipt.gasPrice,
      };
  }

  await Promise.all([
    ...Object.entries(ownerToTokenToIdentifierBalances).map(
      ([owner, tokenToIdentifierBalances]) =>
        Promise.all([
          ...Object.values(tokenToIdentifierBalances).map(
            (identifierToBalance) =>
              Promise.all([
                ...Object.values(identifierToBalance).map(
                  async ({ balance, item }) => {
                    const actualBalance = await balanceOf(
                      owner,
                      item,
                      provider,
                    );

                    expect(balance).equal(actualBalance);
                  },
                ),
              ]),
          ),
        ]),
    ),
  ]);
};
