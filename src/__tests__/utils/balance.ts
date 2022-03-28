import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { JsonRpcProvider } from "ethers/node_modules/@ethersproject/providers";
import { Item, Order } from "../../types";
import { balanceOf } from "../../utils/balance";

import { getPresentItemAmount, TimeBasedItemParams } from "../../utils/item";
import { providers as multicallProviders } from "@0xsequence/multicall";
import { expect } from "chai";

export const setBalance = async (
  address: string,
  provider: JsonRpcProvider,
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

  for (const item of [...offer, ...consideration]) {
    for (const address of relevantAddresses) {
      ownerToTokenToIdentifierBalances[address] = {
        ...ownerToTokenToIdentifierBalances[address],
        [item.token]: {
          [item.identifierOrCriteria]: {
            item,
            balance: await balanceOf(address, item, multicallProvider),
          },
        },
      };
    }
  }

  return ownerToTokenToIdentifierBalances;
};

export const verifyBalancesAfterFulfill = async (
  ownerToTokenToIdentifierBalances: Record<
    string,
    Record<string, Record<string, { balance: BigNumber; item: Item }>>
  >,
  order: Order,
  fulfillerAddress: string,
  multicallProvider: multicallProviders.MulticallProvider,
  timeBasedItemParams?: TimeBasedItemParams
) => {
  const { offer, consideration, offerer } = order.parameters;

  // Offer items are depleted
  offer.forEach((item) => {
    const exchangedAmount = getPresentItemAmount(
      {
        startAmount: item.startAmount,
        endAmount: item.endAmount,
      },
      timeBasedItemParams
    );

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
    const exchangedAmount = getPresentItemAmount(
      {
        startAmount: item.startAmount,
        endAmount: item.endAmount,
      },
      timeBasedItemParams
    );

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

  for (const [owner, tokenToIdentifierBalances] of Object.entries(
    ownerToTokenToIdentifierBalances
  )) {
    for (const identifierToBalance of Object.values(
      tokenToIdentifierBalances
    )) {
      for (const { balance, item } of Object.values(identifierToBalance)) {
        const actualBalance = await balanceOf(owner, item, multicallProvider);

        expect(balance).equal(actualBalance);
      }
    }
  }
};
