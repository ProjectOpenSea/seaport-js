import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

import { ItemType } from "../constants";
import { CreateOrderInput, Fulfillment, Order, OrderWithNonce } from "../types";
import { isCurrencyItem } from "../utils/item";
import { generateRandomSalt } from "../utils/order";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

const constructPrivateListingCounterOrder = (
  order: OrderWithNonce,
  privateSaleRecipient: string
): Order => {
  // Counter order offers up all the items in the private listing consideration
  // besides the items that are going to the private listing recipient
  const paymentItems = order.parameters.consideration.filter(
    (item) =>
      item.recipient.toLowerCase() !== privateSaleRecipient.toLowerCase()
  );

  if (!paymentItems.every((item) => isCurrencyItem(item))) {
    throw new Error(
      "The consideration for the private listing did not contain only currency items."
    );
  }
  if (
    !paymentItems.every((item) => item.itemType === paymentItems[0].itemType)
  ) {
    throw new Error("Not all currency items were the same for private order.");
  }

  const { aggregatedStartAmount, aggregatedEndAmount } = paymentItems.reduce(
    ({ aggregatedStartAmount, aggregatedEndAmount }, item) => ({
      aggregatedStartAmount: aggregatedStartAmount.add(item.startAmount),
      aggregatedEndAmount: aggregatedEndAmount.add(item.endAmount),
    }),
    {
      aggregatedStartAmount: BigNumber.from(0),
      aggregatedEndAmount: BigNumber.from(0),
    }
  );

  const counterOrder: Order = {
    parameters: {
      ...order.parameters,
      offerer: privateSaleRecipient,
      offer: [
        {
          itemType: paymentItems[0].itemType,
          token: paymentItems[0].token,
          identifierOrCriteria: paymentItems[0].identifierOrCriteria,
          startAmount: aggregatedStartAmount.toString(),
          endAmount: aggregatedEndAmount.toString(),
        },
      ],
      // The consideration here is empty as the original private listing order supplies
      // the taker address to receive the desired items.
      consideration: [],
      salt: generateRandomSalt(),
      totalOriginalConsiderationItems: 0,
    },
    signature: "0x",
  };

  return counterOrder;
};

const getPrivateListingFulfillments = (
  privateListingOrder: OrderWithNonce
): Fulfillment[] => {
  const nftRelatedFulfillments: Fulfillment[] = [];

  // For the original order, we need to match everything offered with every consideration item
  // on the original order that's set to go to the private listing recipient
  privateListingOrder.parameters.offer.forEach((offerItem, offerIndex) => {
    const considerationIndex =
      privateListingOrder.parameters.consideration.findIndex(
        (considerationItem) =>
          considerationItem.itemType === offerItem.itemType &&
          considerationItem.token === offerItem.token &&
          considerationItem.identifierOrCriteria ===
            offerItem.identifierOrCriteria
      );
    if (considerationIndex === -1) {
      throw new Error(
        "Could not find matching offer item in the consideration for private listing"
      );
    }
    nftRelatedFulfillments.push({
      offerComponents: [
        {
          orderIndex: 0,
          itemIndex: offerIndex,
        } as any,
      ],
      considerationComponents: [
        {
          orderIndex: 0,
          itemIndex: considerationIndex,
        } as any,
      ],
    });
  });

  const currencyRelatedFulfillments: Fulfillment[] = [];

  // For the original order, we need to match everything offered with every consideration item
  // on the original order that's set to go to the private listing recipient
  privateListingOrder.parameters.consideration.forEach(
    (considerationItem, considerationIndex) => {
      if (!isCurrencyItem(considerationItem)) {
        return;
      }
      // We always match the offer item (index 0) of the counter order (index 1)
      // with all of the payment items on the private listing
      currencyRelatedFulfillments.push({
        offerComponents: [
          {
            orderIndex: 1,
            itemIndex: 0,
          } as any,
        ],
        considerationComponents: [
          {
            orderIndex: 0,
            itemIndex: considerationIndex,
          } as any,
        ],
      });
    }
  );

  return [...nftRelatedFulfillments, ...currencyRelatedFulfillments];
};

describeWithFixture("As a user I want to match an order", (fixture) => {
  let offerer: SignerWithAddress;
  let zone: SignerWithAddress;
  let privateListingRecipient: SignerWithAddress;
  let standardCreateOrderInput: CreateOrderInput;
  let multicallProvider: providers.MulticallProvider;
  const nftId = "1";
  // const erc1155Amount = "3";

  beforeEach(async () => {
    [offerer, zone, privateListingRecipient] = await ethers.getSigners();

    multicallProvider = new providers.MulticallProvider(ethers.provider);
  });

  describe("A single ERC721 is to be transferred", async () => {
    describe("[Buy now] I want to buy a single ERC721 private listing", async () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        await testErc721.mint(offerer.address, nftId);

        standardCreateOrderInput = {
          startTime: "0",
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              recipient: offerer.address,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      describe("with ETH", () => {
        it("ERC721 <=> ETH", async () => {
          const { seaport } = fixture;

          const privateListingCreateOrderInput: CreateOrderInput = {
            ...standardCreateOrderInput,
            consideration: [
              ...standardCreateOrderInput.consideration,
              {
                ...standardCreateOrderInput.offer[0],
                recipient: privateListingRecipient.address,
              },
            ],
          };

          const { executeAllActions } = await seaport.createOrder(
            privateListingCreateOrderInput
          );

          const order = await executeAllActions();

          const counterOrder = constructPrivateListingCounterOrder(
            order,
            privateListingRecipient.address
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              privateListingRecipient.address,
              multicallProvider
            );

          const transaction = await seaport
            .matchOrders(
              {
                orders: [order, counterOrder],
                fulfillments,
                overrides: {
                  value: counterOrder.parameters.offer[0].startAmount,
                },
              },
              privateListingRecipient.address
            )
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: privateListingRecipient.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
        });
      });
    });
  });
});
