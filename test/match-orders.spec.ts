import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";

import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import {
  constructPrivateListingCounterOrder,
  getPrivateListingFulfillments,
} from "./utils/examples/privateListings";
import { describeWithFixture } from "./utils/setup";
import { getTransactionMethods } from "../src/utils/usecase";
import { expect } from "chai";

describeWithFixture("As a user I want to match an order", (fixture) => {
  let offerer: Signer;
  let zone: Signer;
  let privateListingRecipient: Signer;
  let privateListingCreateOrderInput: CreateOrderInput;
  const nftId = "1";
  const erc1155Amount = "3";
  const erc1155ListingQuantity = "1";

  beforeEach(async () => {
    [offerer, zone, privateListingRecipient] = await ethers.getSigners();
  });

  describe("A single ERC721 is to be transferred", () => {
    describe("[Buy now] I want to buy a single ERC721 private listing", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        await testErc721.mint(offerer.address, nftId);

        privateListingCreateOrderInput = {
          startTime: "0",
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              recipient: offerer.address,
            },
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
              recipient: privateListingRecipient.address,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      describe("with ETH", () => {
        it("ERC721 <=> ETH", async () => {
          const { seaport } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            privateListingCreateOrderInput,
          );

          const order = await executeAllActions();

          const counterOrder = constructPrivateListingCounterOrder(
            order,
            privateListingRecipient.address,
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              privateListingRecipient.address,
              ethers.provider,
            );

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              overrides: {
                value: counterOrder.parameters.offer[0].startAmount,
              },
              accountAddress: privateListingRecipient.address,
            })
            .send();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: privateListingRecipient.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });
        });
      });

      describe("with ERC20", () => {
        beforeEach(async () => {
          const { testErc20 } = fixture;

          // Use ERC20 instead of eth
          privateListingCreateOrderInput = {
            ...privateListingCreateOrderInput,
            consideration: [
              {
                ...privateListingCreateOrderInput.consideration[0],
                token: await testErc20.getAddress(),
              },
              ...privateListingCreateOrderInput.consideration.slice(1),
            ],
          };
          await testErc20.mint(
            privateListingRecipient.address,
            (privateListingCreateOrderInput.consideration[0] as CurrencyItem)
              .amount,
          );
        });

        it("ERC721 <=> ERC20", async () => {
          const { seaport, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            privateListingCreateOrderInput,
          );

          const order = await executeAllActions();

          const counterOrder = constructPrivateListingCounterOrder(
            order,
            privateListingRecipient.address,
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              privateListingRecipient.address,
              ethers.provider,
            );

          await getTransactionMethods(
            testErc20.connect(privateListingRecipient),
            "approve",
            [await seaport.contract.getAddress(), MAX_INT],
          ).transact();
          expect(
            await testErc20.allowance(
              privateListingRecipient.address,
              await seaport.contract.getAddress(),
            ),
          ).to.equal(MAX_INT);

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              accountAddress: privateListingRecipient.address,
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: privateListingRecipient.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });
        });
      });
    });
  });

  describe("A single ERC1155 is to be transferred", () => {
    describe("[Buy now] I want to buy a single ERC1155 private listing", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        await testErc1155.mint(offerer.address, nftId, erc1155Amount);

        privateListingCreateOrderInput = {
          startTime: "0",
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              identifier: nftId,
              amount: erc1155ListingQuantity,
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              recipient: offerer.address,
            },
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              identifier: nftId,
              recipient: privateListingRecipient.address,
              amount: erc1155ListingQuantity,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      describe("with ETH", () => {
        it("ERC1155 <=> ETH", async () => {
          const { seaport } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            privateListingCreateOrderInput,
          );

          const order = await executeAllActions();

          const counterOrder = constructPrivateListingCounterOrder(
            order,
            privateListingRecipient.address,
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              privateListingRecipient.address,
              ethers.provider,
            );

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              overrides: {
                value: counterOrder.parameters.offer[0].startAmount,
              },
              accountAddress: privateListingRecipient.address,
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: privateListingRecipient.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });
        });
      });

      describe("with ERC20", () => {
        beforeEach(async () => {
          const { testErc20 } = fixture;

          // Use ERC20 instead of eth
          privateListingCreateOrderInput = {
            ...privateListingCreateOrderInput,
            consideration: [
              {
                ...privateListingCreateOrderInput.consideration[0],
                token: await testErc20.getAddress(),
              },
              ...privateListingCreateOrderInput.consideration.slice(1),
            ],
          };
          await testErc20.mint(
            privateListingRecipient.address,
            (privateListingCreateOrderInput.consideration[0] as CurrencyItem)
              .amount,
          );
        });

        it("ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            privateListingCreateOrderInput,
          );

          const order = await executeAllActions();

          const counterOrder = constructPrivateListingCounterOrder(
            order,
            privateListingRecipient.address,
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              privateListingRecipient.address,
              ethers.provider,
            );

          await getTransactionMethods(
            testErc20.connect(privateListingRecipient),
            "approve",
            [await seaport.contract.getAddress(), MAX_INT],
          ).transact();
          expect(
            await testErc20.allowance(
              privateListingRecipient.address,
              await seaport.contract.getAddress(),
            ),
          ).to.equal(MAX_INT);

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              accountAddress: privateListingRecipient.address,
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: privateListingRecipient.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });
        });
      });
    });
  });
});
