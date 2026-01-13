import { parseEther, Signer } from "ethers";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

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
  let offerer: HardhatEthersSigner;
  let zone: HardhatEthersSigner;
  let privateListingRecipient: HardhatEthersSigner;
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

        await testErc721.mint(await offerer.getAddress(), nftId);

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
              recipient: await offerer.getAddress(),
            },
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
              recipient: await privateListingRecipient.getAddress(),
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
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
            await privateListingRecipient.getAddress(),
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await privateListingRecipient.getAddress(),
            );

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              overrides: {
                value: counterOrder.parameters.offer[0].startAmount,
              },
              accountAddress: await privateListingRecipient.getAddress(),
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await privateListingRecipient.getAddress(),

            fulfillReceipt: receipt!,
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
            await privateListingRecipient.getAddress(),
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
            await privateListingRecipient.getAddress(),
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await privateListingRecipient.getAddress(),
            );

          await getTransactionMethods(
            privateListingRecipient as unknown as Signer,
            testErc20,
            "approve",
            [await seaport.contract.getAddress(), MAX_INT],
          ).transact();
          expect(
            await testErc20.allowance(
              await privateListingRecipient.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              accountAddress: await privateListingRecipient.getAddress(),
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await privateListingRecipient.getAddress(),

            fulfillReceipt: receipt!,
          });
        });
      });
    });
  });

  describe("A single ERC1155 is to be transferred", () => {
    describe("[Buy now] I want to buy a single ERC1155 private listing", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        await testErc1155.mint(
          await offerer.getAddress(),
          nftId,
          erc1155Amount,
        );

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
              recipient: await offerer.getAddress(),
            },
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              identifier: nftId,
              recipient: await privateListingRecipient.getAddress(),
              amount: erc1155ListingQuantity,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
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
            await privateListingRecipient.getAddress(),
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await privateListingRecipient.getAddress(),
            );

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              overrides: {
                value: counterOrder.parameters.offer[0].startAmount,
              },
              accountAddress: await privateListingRecipient.getAddress(),
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await privateListingRecipient.getAddress(),

            fulfillReceipt: receipt!,
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
            await privateListingRecipient.getAddress(),
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
            await privateListingRecipient.getAddress(),
          );
          const fulfillments = getPrivateListingFulfillments(order);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await privateListingRecipient.getAddress(),
            );

          await getTransactionMethods(
            privateListingRecipient as unknown as Signer,
            testErc20,
            "approve",
            [await seaport.contract.getAddress(), MAX_INT],
          ).transact();
          expect(
            await testErc20.allowance(
              await privateListingRecipient.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const transaction = await seaport
            .matchOrders({
              orders: [order, counterOrder],
              fulfillments,
              accountAddress: await privateListingRecipient.getAddress(),
            })
            .transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await privateListingRecipient.getAddress(),

            fulfillReceipt: receipt!,
          });
        });
      });
    });
  });
});
