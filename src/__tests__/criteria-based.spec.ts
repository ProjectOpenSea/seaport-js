import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, MAX_INT } from "../constants";
import { CreateOrderInput, CurrencyItem } from "../types";
import * as fulfill from "../utils/fulfill";
import { MerkleTree } from "../utils/merkletree";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer for orders with criteria based items",
  (fixture) => {
    let offerer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let multicallProvider: providers.MulticallProvider;

    let fulfillStandardOrderSpy: sinon.SinonSpy;
    let standardCreateOrderInput: CreateOrderInput;

    const nftId = "1";
    const nftId2 = "2";
    const nftId3 = "3";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();
      multicallProvider = new providers.MulticallProvider(ethers.provider);

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("A criteria based ERC721 is to be transferred", async () => {
      describe("Collection based trades", () => {
        describe("[Buy now] I want to buy a collection based listing", () => {
          beforeEach(async () => {
            const { testErc721 } = fixture;

            await testErc721.mint(offerer.address, nftId);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  identifiers: [],
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

          it("ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
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
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(fulfiller.address);

            expect(fulfillStandardOrderSpy).calledOnce;
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };

            await testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const orderStatus = await seaport.getOrderStatus(
              seaport.getOrderHash(order.parameters)
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.equal(MAX_INT);

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
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(fulfiller.address);

            expect(fulfillStandardOrderSpy).calledOnce;
          });
        });

        describe("[Accept offer] I want to accept a collection based offer", () => {
          beforeEach(async () => {
            const { testErc721, testErc20 } = fixture;

            await testErc721.mint(fulfiller.address, nftId);
            await testErc20.mint(offerer.address, parseEther("10").toString());

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: testErc20.address,
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  identifiers: [],
                  recipient: offerer.address,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: zone.address, basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              offerer.address
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc721.address,
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc721.isApprovedForAll(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
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
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId);

            expect(ownerOfErc721).to.eq(offerer.address);

            expect(fulfillStandardOrderSpy).calledOnce;
          });
        });
      });

      describe("Trait-based trades", () => {
        describe("[Buy now] I want to buy a trait based listing", () => {
          beforeEach(async () => {
            const { testErc721 } = fixture;

            await testErc721.mint(offerer.address, nftId);
            await testErc721.mint(offerer.address, nftId2);
            await testErc721.mint(offerer.address, nftId3);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  identifiers: [nftId, nftId3],
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

          it("ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId2]).getProof(nftId2),
                },
              ],
              accountAddress: fulfiller.address,
            });

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            await expect(
              revertedFulfill.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],
              accountAddress: fulfiller.address,
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
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(fulfiller.address);

            expect(fulfillStandardOrderSpy).calledTwice;
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };

            await testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: fulfiller.address,
            });

            expect(revertedActions.length).to.eq(2);

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.equal(MAX_INT);

            const revertedFulfill = revertedActions[1];

            expect(revertedFulfill).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            await expect(
              revertedFulfill.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: fulfiller.address,
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
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(fulfiller.address);

            expect(fulfillStandardOrderSpy).calledTwice;
          });
        });

        describe("[Accept offer] I want to accept a trait based offer", () => {
          beforeEach(async () => {
            const { testErc721, testErc20 } = fixture;

            await testErc721.mint(fulfiller.address, nftId);
            await testErc721.mint(fulfiller.address, nftId2);
            await testErc721.mint(fulfiller.address, nftId3);
            await testErc20.mint(offerer.address, parseEther("10").toString());

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: testErc20.address,
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  identifiers: [nftId, nftId3],
                  recipient: offerer.address,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: zone.address, basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              offerer.address
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions: revertedActions } = await seaport.fulfillOrder({
              order,
              considerationCriteria: [
                {
                  identifier: nftId2,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId2),
                },
              ],
              accountAddress: fulfiller.address,
            });

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc721.address,
              identifierOrCriteria: nftId2,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc721.isApprovedForAll(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = revertedActions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.eq(MAX_INT);

            const revertedFulfillAction = revertedActions[2];

            expect(revertedFulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfillAction.transactionMethods,
            });

            await expect(
              revertedFulfillAction.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: fulfiller.address,
            });

            const fulfillAction = actions[0];

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            const ownerOfErc721 = await testErc721.ownerOf(nftId3);

            expect(ownerOfErc721).to.eq(offerer.address);

            expect(fulfillStandardOrderSpy).calledTwice;
          });
        });
      });
    });

    describe("A criteria based ERC1155 is to be transferred", async () => {
      describe("Collection based trades", () => {
        describe("[Buy now] I want to buy a collection based listing", () => {
          beforeEach(async () => {
            const { testErc1155 } = fixture;

            await testErc1155.mint(offerer.address, nftId, erc1155Amount);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: testErc1155.address,
                  amount: erc1155Amount,
                  identifiers: [],
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

          it("ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              fulfiller.address,
              nftId
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledOnce;
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };

            await testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              offerCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              fulfiller.address,
              nftId
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledOnce;
          });
        });

        describe("[Accept offer] I want to accept a collection based offer", () => {
          beforeEach(async () => {
            const { testErc1155, testErc20 } = fixture;

            await testErc1155.mint(fulfiller.address, nftId, erc1155Amount);
            await testErc20.mint(offerer.address, parseEther("10").toString());

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: testErc20.address,
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC1155,
                  amount: erc1155Amount,
                  token: testErc1155.address,
                  identifiers: [],
                  recipient: offerer.address,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: zone.address, basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC721", async () => {
            const { seaport, testErc1155, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              offerer.address
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [{ identifier: nftId, proof: [] }],
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc1155.address,
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC1155_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc1155.isApprovedForAll(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              offerer.address,
              nftId
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledOnce;
          });
        });
      });

      describe("Trait-based trades", () => {
        describe("[Buy now] I want to buy a trait based listing", () => {
          beforeEach(async () => {
            const { testErc1155 } = fixture;

            await testErc1155.mint(offerer.address, nftId, erc1155Amount);
            await testErc1155.mint(offerer.address, nftId2, erc1155Amount);
            await testErc1155.mint(offerer.address, nftId3, erc1155Amount);

            standardCreateOrderInput = {
              offer: [
                {
                  itemType: ItemType.ERC1155,
                  token: testErc1155.address,
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  identifiers: [nftId, nftId3],
                  amount: erc1155Amount,
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

          it("ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
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
              accountAddress: fulfiller.address,
            });

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            await expect(
              revertedFulfill.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],
              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              fulfiller.address,
              nftId3
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledTwice;
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };

            await testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
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
              accountAddress: fulfiller.address,
            });

            expect(revertedActions.length).to.eq(2);

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.equal(MAX_INT);

            const revertedFulfill = revertedActions[1];

            expect(revertedFulfill).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfill.transactionMethods,
            });

            await expect(
              revertedFulfill.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              offerCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionMethods: action.transactionMethods,
            });

            await action.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              fulfiller.address,
              nftId3
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledTwice;
          });
        });

        describe("[Accept offer] I want to accept a trait based offer", () => {
          beforeEach(async () => {
            const { testErc1155, testErc20 } = fixture;

            await testErc1155.mint(fulfiller.address, nftId, erc1155Amount);
            await testErc1155.mint(fulfiller.address, nftId2, erc1155Amount);
            await testErc1155.mint(fulfiller.address, nftId3, erc1155Amount);
            await testErc20.mint(offerer.address, parseEther("10").toString());

            standardCreateOrderInput = {
              allowPartialFills: true,

              offer: [
                {
                  amount: parseEther("10").toString(),
                  token: testErc20.address,
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC1155,
                  token: testErc1155.address,
                  identifiers: [nftId, nftId3],
                  recipient: offerer.address,
                  amount: erc1155Amount,
                },
              ],
              // 2.5% fee
              fees: [{ recipient: zone.address, basisPoints: 250 }],
            };
          });

          it("ERC20 <=> ERC1155", async () => {
            const { seaport, testErc1155, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              offerer.address
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
              accountAddress: fulfiller.address,
            });

            const approvalAction = revertedActions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc1155.address,
              identifierOrCriteria: nftId2,
              itemType: ItemType.ERC1155_WITH_CRITERIA,
              transactionMethods: approvalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc1155.isApprovedForAll(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = revertedActions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: secondApprovalAction.transactionMethods,
              operator: seaport.contract.address,
            });

            await secondApprovalAction.transactionMethods.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                seaport.contract.address
              )
            ).to.eq(MAX_INT);

            const revertedFulfillAction = revertedActions[2];

            expect(revertedFulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: revertedFulfillAction.transactionMethods,
            });

            await expect(
              revertedFulfillAction.transactionMethods.transact()
            ).to.be.revertedWith("InvalidProof()");

            const { actions } = await seaport.fulfillOrder({
              order,

              considerationCriteria: [
                {
                  identifier: nftId3,
                  proof: new MerkleTree([nftId, nftId3]).getProof(nftId3),
                },
              ],

              accountAddress: fulfiller.address,
            });

            const fulfillAction = actions[0];

            await fulfillAction.transactionMethods.transact();

            const balanceOfErc1155 = await testErc1155.balanceOf(
              offerer.address,
              nftId3
            );

            expect(balanceOfErc1155).to.eq(erc1155Amount);

            expect(fulfillStandardOrderSpy).calledTwice;
          });
        });
      });
    });

    describe("A criteria based ERC721 to criteria based ERC1155 swap", async () => {
      describe("Collection based swaps", () => {
        beforeEach(async () => {
          const { testErc721, testErc1155 } = fixture;

          await testErc721.mint(offerer.address, nftId);
          await testErc1155.mint(fulfiller.address, nftId2, erc1155Amount);

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifiers: [],
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                amount: erc1155Amount,
                identifiers: [],
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC721 <=> ERC1155", async () => {
          const { seaport, testErc721, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          const { actions } = await seaport.fulfillOrder({
            order,
            offerCriteria: [{ identifier: nftId, proof: [] }],
            considerationCriteria: [{ identifier: nftId2, proof: [] }],
            accountAddress: fulfiller.address,
          });

          expect(actions.length).to.eq(2);

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc1155.address,
            identifierOrCriteria: nftId2,
            itemType: ItemType.ERC1155_WITH_CRITERIA,
            transactionMethods: approvalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await approvalAction.transactionMethods.transact();

          const fulfillAction = actions[1];

          expect(fulfillAction).to.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          await fulfillAction.transactionMethods.transact();

          const balanceOfErc1155 = await testErc1155.balanceOf(
            offerer.address,
            nftId2
          );

          expect(balanceOfErc1155).to.eq(erc1155Amount);

          const ownerOfErc721 = await testErc721.ownerOf(nftId);

          expect(ownerOfErc721).to.eq(fulfiller.address);

          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });

      describe("Trait-based swaps", () => {
        beforeEach(async () => {
          const { testErc721, testErc1155 } = fixture;

          await testErc721.mint(fulfiller.address, nftId);
          await testErc721.mint(fulfiller.address, nftId2);
          await testErc721.mint(fulfiller.address, nftId3);
          await testErc1155.mint(offerer.address, nftId, erc1155Amount);
          await testErc1155.mint(offerer.address, nftId2, erc1155Amount);
          await testErc1155.mint(offerer.address, nftId3, erc1155Amount);

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                identifiers: [nftId, nftId3],
                amount: erc1155Amount,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifiers: [nftId2, nftId3],
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC1155 <=> ERC721", async () => {
          const { seaport, testErc721, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
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
            accountAddress: fulfiller.address,
          });

          expect(revertedActions.length).to.eq(2);

          const approvalAction = revertedActions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc721.address,
            identifierOrCriteria: nftId2,
            itemType: ItemType.ERC721_WITH_CRITERIA,
            transactionMethods: approvalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await approvalAction.transactionMethods.transact();

          const revertedFulfill = revertedActions[1];

          expect(revertedFulfill).to.deep.equal({
            type: "exchange",
            transactionMethods: revertedFulfill.transactionMethods,
          });

          // Nft with ID 2 was not in the initial set of valid identifiers in the offer
          await expect(
            revertedFulfill.transactionMethods.transact()
          ).to.be.revertedWith("InvalidProof()");

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
            accountAddress: fulfiller.address,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          await action.transactionMethods.transact();

          const balanceOfErc1155 = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          expect(balanceOfErc1155).to.eq(erc1155Amount);

          const ownerOfErc721 = await testErc721.ownerOf(nftId2);

          expect(ownerOfErc721).to.eq(offerer.address);

          expect(fulfillStandardOrderSpy).calledTwice;
        });
      });
    });
  }
);
