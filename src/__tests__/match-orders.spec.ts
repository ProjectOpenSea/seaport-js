import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";

import { ItemType, MAX_INT } from "../constants";
import { CreateOrderInput, CurrencyItem } from "../types";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import {
  constructPrivateListingCounterOrder,
  getPrivateListingFulfillments,
} from "./utils/examples/privateListings";
import { describeWithFixture } from "./utils/setup";
import { getTransactionMethods } from "../utils/usecase";
import { expect } from "chai";

describeWithFixture("As a user I want to match an order", (fixture) => {
  let offerer: SignerWithAddress;
  let zone: SignerWithAddress;
  let privateListingRecipient: SignerWithAddress;
  let privateListingCreateOrderInput: CreateOrderInput;
  let multicallProvider: providers.MulticallProvider;
  const nftId = "1";
  const erc1155Amount = "3";
  const erc1155ListingQuantity = "1";

  beforeEach(async () => {
    [offerer, zone, privateListingRecipient] = await ethers.getSigners();

    multicallProvider = new providers.MulticallProvider(ethers.provider);
  });

  describe("A single ERC721 is to be transferred", async () => {
    describe("[Buy now] I want to buy a single ERC721 private listing", async () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        await testErc721.mint(offerer.address, nftId);

        privateListingCreateOrderInput = {
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
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
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
            multicallProvider,
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
                token: testErc20.address,
              },
              ...privateListingCreateOrderInput.consideration.slice(1),
            ],
          };
          testErc20.mint(
            privateListingRecipient.address,
            BigNumber.from(
              (privateListingCreateOrderInput.consideration[0] as CurrencyItem)
                .amount
            )
          );
        });

        it("ERC721 <=> ERC20", async () => {
          const { seaport, testErc20 } = fixture;

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

          await getTransactionMethods(
            testErc20.connect(privateListingRecipient),
            "approve",
            [seaport.contract.address, MAX_INT]
          ).transact();
          expect(
            await testErc20.allowance(
              privateListingRecipient.address,
              seaport.contract.address
            )
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
            multicallProvider,
            fulfillReceipt: receipt,
          });
        });
      });
    });
  });

  describe("A single ERC1155 is to be transferred", async () => {
    describe("[Buy now] I want to buy a single ERC1155 private listing", async () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        await testErc1155.mint(offerer.address, nftId, erc1155Amount);

        privateListingCreateOrderInput = {
          startTime: "0",
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
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
              token: testErc1155.address,
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
            multicallProvider,
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
                token: testErc20.address,
              },
              ...privateListingCreateOrderInput.consideration.slice(1),
            ],
          };
          testErc20.mint(
            privateListingRecipient.address,
            BigNumber.from(
              (privateListingCreateOrderInput.consideration[0] as CurrencyItem)
                .amount
            )
          );
        });

        it("ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20 } = fixture;

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

          await getTransactionMethods(
            testErc20.connect(privateListingRecipient),
            "approve",
            [seaport.contract.address, MAX_INT]
          ).transact();
          expect(
            await testErc20.allowance(
              privateListingRecipient.address,
              seaport.contract.address
            )
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
            multicallProvider,
            fulfillReceipt: receipt,
          });
        });
      });
    });
  });
});
