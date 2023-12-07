import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderInput, CurrencyItem, OrderWithCounter } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import { MerkleTree } from "../src/utils/merkletree";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";
import { SinonSpy } from "sinon";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy now or accept an offer for orders with criteria based items",
  (fixture) => {
    let offerer: Signer;
    let zone: Signer;
    let fulfiller: Signer;

    let fulfillStandardOrderSpy: SinonSpy;
    let fulfillAvailableOrdersSpy: SinonSpy;
    let standardCreateOrderInput: CreateOrderInput;

    const nftId = "1";
    const nftId2 = "2";
    const nftId3 = "3";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");
      fulfillAvailableOrdersSpy = sinon.spy(fulfill, "fulfillAvailableOrders");
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
      fulfillAvailableOrdersSpy.restore();
    });

    describe("A criteria based ERC721 is to be transferred", () => {
      describe("Collection based trades", () => {
        describe("[Buy now] I want to buy a collection based listing", () => {
          beforeEach(async () => {
            const { testErc721 } = fixture;

            await testErc721.mint(await offerer.getAddress(), nftId);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  identifiers: [],
                },
              ],
              consideration: [
                {
                  amount: parseEther("10").toString(),
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

            expect(fulfillStandardOrderSpy.calledOnce);
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
            };

            await testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const orderStatus = await seaport.getOrderStatus(
              seaport.getOrderHash(order.parameters),
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              orderStatus,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

            expect(fulfillStandardOrderSpy.calledOnce);
          });
        });

        describe("[Accept offer] I want to accept a collection based offer", () => {
          beforeEach(async () => {
            const { testErc721, testErc20 } = fixture;

            await testErc721.mint(await fulfiller.getAddress(), nftId);
            await testErc721.mint(await fulfiller.getAddress(), nftId2);
            await testErc20.mint(
              await offerer.getAddress(),
              parseEther("10").toString(),
            );

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: await testErc20.getAddress(),
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  identifiers: [],
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              await offerer.getAddress(),
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc721.getAddress(),
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc721.isApprovedForAll(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(await offerer.getAddress());

            expect(fulfillStandardOrderSpy.calledOnce);
          });

          it("ERC20 <=> ERC721 (multiple orders)", async () => {
            const { seaport, testErc721, testErc20 } = fixture;

            // Give offerer enough ERC20 to fulfill both orders
            await testErc20.mint(
              await offerer.getAddress(),
              parseEther("10").toString(),
            );

            // Create two collection based offers
            const orders: OrderWithCounter[] = [];
            for (let i = 0; i < 2; i++) {
              const { executeAllActions } = await seaport.createOrder(
                standardCreateOrderInput,
                await offerer.getAddress(),
              );

              const order = await executeAllActions();
              orders.push(order);
            }

            const [initialFulfillerErc20Balance, initialZoneErc20Balance] =
              await Promise.all([
                testErc20.balanceOf(await fulfiller.getAddress()),
                testErc20.balanceOf(await zone.getAddress()),
              ]);

            const fulfillmentNftIds = [nftId, nftId2];
            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: orders.map((order, i) => ({
                order,
                considerationCriteria: [
                  { identifier: fulfillmentNftIds[i], proof: [] },
                ],
              })),
              accountAddress: await fulfiller.getAddress(),
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc721.getAddress(),
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc721.isApprovedForAll(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            expect(receipt!.status).to.eq(1);

            const [finalFulfillerErc20Balance, finalZoneErc20Balance] =
              await Promise.all([
                testErc20.balanceOf(await fulfiller.getAddress()),
                testErc20.balanceOf(await zone.getAddress()),
              ]);
            expect(finalFulfillerErc20Balance).to.eq(
              initialFulfillerErc20Balance +
                parseEther("20") -
                parseEther("0.5"), // 0.5 in fees
            );
            expect(finalZoneErc20Balance).to.eq(
              initialZoneErc20Balance + parseEther("0.5"),
            );

            const [ownerOfNftId1, ownerOfNftId2] = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
            ]);

            expect(ownerOfNftId1).to.eq(await offerer.getAddress());
            expect(ownerOfNftId2).to.eq(await offerer.getAddress());

            expect(fulfillAvailableOrdersSpy.calledOnce);
          });
        });
      });

      describe("Trait-based trades", () => {
        describe("[Buy now] I want to buy a trait based listing", () => {
          beforeEach(async () => {
            const { testErc721 } = fixture;

            await testErc721.mint(await offerer.getAddress(), nftId);
            await testErc721.mint(await offerer.getAddress(), nftId2);
            await testErc721.mint(await offerer.getAddress(), nftId3);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  identifiers: [nftId, nftId3],
                },
              ],
              consideration: [
                {
                  amount: parseEther("10").toString(),
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC721 <=> ETH", async () => {
            const { seaport, seaportContract, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId2]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

            expect(fulfillStandardOrderSpy.calledTwice);
          });

          it("ERC721 <=> ETH (custom merkle root)", async () => {
            const { seaport, seaportContract, testErc721 } = fixture;

            standardCreateOrderInput.offer = [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                // The offerer is willing to sell either token ID 1 or 3, but not 2
                criteria: new MerkleTree([nftId, nftId3]).getRoot(),
              },
            ];

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId2]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

            expect(fulfillStandardOrderSpy.calledTwice);
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, seaportContract, testErc20, testErc721 } = fixture;

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
            };

            await testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(2);

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const revertedFulfill = revertedActions[1];

            expect(revertedFulfill).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

            expect(fulfillStandardOrderSpy.calledTwice);
          });
        });

        describe("[Accept offer] I want to accept a trait based offer", () => {
          beforeEach(async () => {
            const { testErc721, testErc20 } = fixture;

            await testErc721.mint(await fulfiller.getAddress(), nftId);
            await testErc721.mint(await fulfiller.getAddress(), nftId2);
            await testErc721.mint(await fulfiller.getAddress(), nftId3);
            await testErc20.mint(
              await offerer.getAddress(),
              parseEther("10").toString(),
            );

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: await testErc20.getAddress(),
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  identifiers: [nftId, nftId3],
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, seaportContract, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              await offerer.getAddress(),
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              considerationCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc721.getAddress(),
              identifierOrCriteria: nftId2,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc721.isApprovedForAll(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = revertedActions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const revertedFulfillAction = revertedActions[2];

            expect(revertedFulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfillAction.transactionMethods,
            });

            await expect(
              revertedFulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: await fulfiller.getAddress(),
            });

            const fulfillAction = actions[0];

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(await offerer.getAddress());

            expect(fulfillStandardOrderSpy.calledTwice);
          });
        });
      });
    });

    describe("A criteria based ERC1155 is to be transferred", () => {
      describe("Collection based trades", () => {
        describe("[Buy now] I want to buy a collection based listing", () => {
          beforeEach(async () => {
            const { testErc1155 } = fixture;

            await testErc1155.mint(
              await offerer.getAddress(),
              nftId,
              erc1155Amount,
            );

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: await testErc1155.getAddress(),
                  amount: erc1155Amount,
                  identifiers: [],
                },
              ],
              consideration: [
                {
                  amount: parseEther("10").toString(),
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledOnce);
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
            };

            await testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledOnce);
          });
        });

        describe("[Accept offer] I want to accept a collection based offer", () => {
          beforeEach(async () => {
            const { testErc1155, testErc20 } = fixture;

            await testErc1155.mint(
              await fulfiller.getAddress(),
              nftId,
              erc1155Amount,
            );
            await testErc20.mint(
              await offerer.getAddress(),
              parseEther("10").toString(),
            );

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: await testErc20.getAddress(),
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC1155,
                  amount: erc1155Amount,
                  token: await testErc1155.getAddress(),
                  identifiers: [],
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, testErc1155, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              await offerer.getAddress(),
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: await fulfiller.getAddress(),
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc1155.getAddress(),
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC1155_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc1155.isApprovedForAll(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await offerer.getAddress(),
              nftId,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledOnce);
          });
        });
      });

      describe("Trait-based trades", () => {
        describe("[Buy now] I want to buy a trait based listing", () => {
          beforeEach(async () => {
            const { testErc1155 } = fixture;

            await testErc1155.mint(
              await offerer.getAddress(),
              nftId,
              erc1155Amount,
            );
            await testErc1155.mint(
              await offerer.getAddress(),
              nftId2,
              erc1155Amount,
            );
            await testErc1155.mint(
              await offerer.getAddress(),
              nftId3,
              erc1155Amount,
            );

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: await testErc1155.getAddress(),
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  identifiers: [nftId, nftId3],
                  amount: erc1155Amount,
                },
              ],
              consideration: [
                {
                  amount: parseEther("10").toString(),
                  recipient: await offerer.getAddress(),
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC1155 <=> ETH", async () => {
            const { seaport, seaportContract, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId2]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId3,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledTwice);
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, seaportContract, testErc20, testErc1155 } =
              fixture;

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
            };

            await testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(2);

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const revertedFulfill = revertedActions[1];

            expect(revertedFulfill).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId3,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledTwice);
          });

          it("ERC1155 <=> ERC20 (custom merkle root)", async () => {
            const { seaport, seaportContract, testErc20, testErc1155 } =
              fixture;

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: await testErc1155.getAddress(),
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  criteria: new MerkleTree([nftId, nftId3]).getRoot(),
                  amount: erc1155Amount,
                },
              ],
            };

            await testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            expect(revertedActions.length).to.eq(2);

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const revertedFulfill = revertedActions[1];

            expect(revertedFulfill).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            await expect(
              revertedFulfill.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: await fulfiller.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId3,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledTwice);
          });
        });

        describe("[Accept offer] I want to accept a trait based offer", () => {
          beforeEach(async () => {
            const { testErc1155, testErc20 } = fixture;

            await testErc1155.mint(
              await fulfiller.getAddress(),
              nftId,
              erc1155Amount,
            );
            await testErc1155.mint(
              await fulfiller.getAddress(),
              nftId2,
              erc1155Amount,
            );
            await testErc1155.mint(
              await fulfiller.getAddress(),
              nftId3,
              erc1155Amount,
            );
            await testErc20.mint(
              await offerer.getAddress(),
              parseEther("10").toString(),
            );

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: await testErc20.getAddress(),
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC1155,
                  token: await testErc1155.getAddress(),
                  identifiers: [nftId, nftId3],
                  recipient: await offerer.getAddress(),
                  amount: erc1155Amount,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC1155", async () => {
            const { seaport, seaportContract, testErc1155, testErc20 } =
              fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              await offerer.getAddress(),
            );

            const order = await executeAllActions();

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              considerationCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: await fulfiller.getAddress(),
            });

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc1155.getAddress(),
              identifierOrCriteria: nftId2,
              itemType: ItemType.ERC1155_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc1155.isApprovedForAll(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = revertedActions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const revertedFulfillAction = revertedActions[2];

            expect(revertedFulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfillAction.transactionMethods,
            });

            await expect(
              revertedFulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: await fulfiller.getAddress(),
            });

            const fulfillAction = actions[0];

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              await offerer.getAddress(),
              nftId3,
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy.calledTwice);
          });
        });
      });
    });

    describe("A criteria based ERC721 to criteria based ERC1155 swap", () => {
      describe("Collection based swaps", () => {
        beforeEach(async () => {
          const { testErc721, testErc1155 } = fixture;

          await testErc721.mint(await offerer.getAddress(), nftId);
          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId2,
            erc1155Amount,
          );

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifiers: [],
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: erc1155Amount,
                identifiers: [],
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC721 <=> ERC1155", async () => {
          const { seaport, testErc721, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const { actions } = await seaport.fulfillOrder({
            order,
            offerCriteria: [{ identifier: nftId, proof: [] }],
            considerationCriteria: [{ identifier: nftId2, proof: [] }],
            accountAddress: await fulfiller.getAddress(),
          });

          expect(actions.length).to.eq(2);

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc1155.getAddress(),
            identifierOrCriteria: nftId2,
            itemType: ItemType.ERC1155_WITH_CRITERIA,
            transactionMethods: approvalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await approvalAction.transactionMethods.transact();

          const fulfillAction = actions[1];

          expect(fulfillAction).to.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          await fulfillAction.transactionMethods.transact();

          const balanceOfErc1155 = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId2,
          );

          expect(balanceOfErc1155).to.eq(erc1155Amount);

          const ownerOfErc721 = await testErc721.ownerOf(nftId);

          expect(ownerOfErc721).to.eq(await fulfiller.getAddress());

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("Trait-based swaps", () => {
        beforeEach(async () => {
          const { testErc721, testErc1155 } = fixture;

          await testErc721.mint(await fulfiller.getAddress(), nftId);
          await testErc721.mint(await fulfiller.getAddress(), nftId2);
          await testErc721.mint(await fulfiller.getAddress(), nftId3);
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId,
            erc1155Amount,
          );
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId2,
            erc1155Amount,
          );
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId3,
            erc1155Amount,
          );

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifiers: [nftId, nftId3],
                amount: erc1155Amount,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifiers: [nftId2, nftId3],
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC1155 <=> ERC721", async () => {
          const { seaport, seaportContract, testErc721, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const { actions: revertedActions } = await seaport.fulfillOrder({
            order,
            offerCriteria: [
              {
                identifier: nftId2,
                proof: new MerkleTree([nftId2]).getProof(nftId2),
              },
            ],
            considerationCriteria: [
              {
                identifier: nftId2,
                proof: new MerkleTree([nftId2, nftId3]).getProof(nftId2),
              },
            ],
            accountAddress: await fulfiller.getAddress(),
          });

          expect(revertedActions.length).to.eq(2);

          const approvalAction = revertedActions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc721.getAddress(),
            identifierOrCriteria: nftId2,
            itemType: ItemType.ERC721_WITH_CRITERIA,
            transactionMethods: approvalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await approvalAction.transactionMethods.transact();

          const revertedFulfill = revertedActions[1];

          expect(revertedFulfill).to.deep.equal({
            type: "exchange",
            transactionMethods: revertedFulfill.transactionMethods,
          });

          // Nft with ID 2 was not in the initial set of valid identifiers in the offer
          await expect(
            revertedFulfill.transactionMethods.transact(),
          ).to.be.revertedWithCustomError(seaportContract, "InvalidProof");

          const { actions } = await seaport.fulfillOrder({
            order,
            offerCriteria: [
              {
                identifier: nftId,
                proof: new MerkleTree([nftId, nftId3]).getProof(nftId),
              },
            ],
            considerationCriteria: [
              {
                identifier: nftId2,
                proof: new MerkleTree([nftId2, nftId3]).getProof(nftId2),
              },
            ],
            accountAddress: await fulfiller.getAddress(),
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          await action.transactionMethods.transact();

          const balanceOfErc1155 = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(balanceOfErc1155).to.eq(erc1155Amount);

          const ownerOfErc721 = await testErc721.ownerOf(nftId2);

          expect(ownerOfErc721).to.eq(await offerer.getAddress());

          expect(fulfillStandardOrderSpy.calledTwice);
        });
      });
    });
  },
);
