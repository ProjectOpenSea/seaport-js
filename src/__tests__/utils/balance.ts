import { BigNumber, BigNumberish, ContractReceipt, providers } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { Item, Order, OrderStatus } from "../../types";
import { balanceOf } from "../../utils/balance";

import { getPresentItemAmount, TimeBasedItemParams } from "../../utils/item";
import { providers as multicallProviders } from "@0xsequence/multicall";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  mapOrderAmountsFromFilledStatus,
  mapOrderAmountsFromUnitsToFill,
} from "../../utils/order";

export const setBalance = async (
  address: string,
  provider: providers.JsonRpcProvider,
  amountEth = parseEther("10000").toHexString().replace("0x0", "0x")
) => {
  await provider.send("hardhat_setBalance", [
    address,
    parseEther(amountEth).toHexString().replace("0x0", "0x"),
  ]);
};

export const getBalancesForFulfillOrder = async (
  order: Order,
  fulfillerAddress: string,
  multicallProvider: multicallProviders.MulticallProvider
) => {
  const { offer, consideration, offerer } = order.parameters;

  const relevantAddresses = Array.from(
    new Set([
      offerer,
      fulfillerAddress,
      ...consideration.map((item) => item.recipient),
    ])
  );

  const ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: BigNumber; item: Item }>>
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
            balance: BigNumber.from(0),
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
            balance: await balanceOf(address, item, multicallProvider),
          };
        }),
      ])
    )
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
  multicallProvider,
  timeBasedItemParams,
}: {
  ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: BigNumber; item: Item }>>
  >;
  order: Order;
  orderStatus?: OrderStatus;
  unitsToFill?: BigNumberish;
  fulfillReceipt: ContractReceipt;
  fulfillerAddress: string;
  multicallProvider: multicallProviders.MulticallProvider;
  timeBasedItemParams?: TimeBasedItemParams;
}) => {
  const totalFilled = orderStatus?.totalFilled ?? BigNumber.from(0);
  const totalSize = orderStatus?.totalSize ?? BigNumber.from(0);

  const orderWithAdjustedFills = unitsToFill
    ? mapOrderAmountsFromUnitsToFill(order, {
        unitsToFill,
        totalFilled,
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
        ].balance.sub(exchangedAmount),
    };

    ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[fulfillerAddress][item.token][
          item.identifierOrCriteria
        ].balance.add(exchangedAmount),
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
        ].balance.sub(exchangedAmount),
    };

    ownerToTokenToIdentifierBalances[item.recipient][item.token][
      item.identifierOrCriteria
    ] = {
      item,
      balance:
        ownerToTokenToIdentifierBalances[item.recipient][item.token][
          item.identifierOrCriteria
        ].balance.add(exchangedAmount),
    };
  });

  // Take into account gas costs
  if (
    ownerToTokenToIdentifierBalances[fulfillerAddress][
      ethers.constants.AddressZero
    ]
  ) {
    ownerToTokenToIdentifierBalances[fulfillerAddress][
      ethers.constants.AddressZero
    ][0] = {
      ...ownerToTokenToIdentifierBalances[fulfillerAddress][
        ethers.constants.AddressZero
      ][0],
      balance: ownerToTokenToIdentifierBalances[fulfillerAddress][
        ethers.constants.AddressZero
      ][0].balance.sub(
        fulfillReceipt.gasUsed.mul(fulfillReceipt.effectiveGasPrice)
      ),
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
                      multicallProvider
                    );

                    expect(balance).equal(actualBalance);
                  }
                ),
              ])
          ),
        ])
    ),
  ]);
};
