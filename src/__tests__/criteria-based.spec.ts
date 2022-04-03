import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, MAX_INT, OrderType } from "../constants";
import { TestERC1155 } from "../typechain";
import { CreateOrderInput, CurrencyItem } from "../types";
import * as fulfill from "../utils/fulfill";
import { generateRandomSalt } from "../utils/order";
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
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
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
            const { consideration, testErc721 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder(
              order,
              { offerCriteria: [{ identifier: nftId }] },
              fulfiller.address
            );

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionRequest: action.transactionRequest,
            });

            const transaction = await action.transactionRequest.send();

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
            const { consideration, testErc20, testErc721 } = fixture;

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

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const orderStatus = await consideration.getOrderStatus(
              consideration.getOrderHash({
                ...order.parameters,
                nonce: order.nonce,
              })
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder(
              order,
              { offerCriteria: [{ identifier: nftId }] },
              fulfiller.address
            );

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionRequest: approvalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await approvalAction.transactionRequest.send();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionRequest: fulfillAction.transactionRequest,
            });

            const transaction = await fulfillAction.transactionRequest.send();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              unitsToFill: 2,
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
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
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
            const { consideration, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
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

            const { actions } = await consideration.fulfillOrder(
              order,
              { considerationCriteria: [{ identifier: nftId }] },
              fulfiller.address
            );

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc721.address,
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionRequest: approvalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await approvalAction.transactionRequest.send();

            expect(
              await testErc721.isApprovedForAll(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionRequest: secondApprovalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await secondApprovalAction.transactionRequest.send();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionRequest: fulfillAction.transactionRequest,
            });

            const transaction = await fulfillAction.transactionRequest.send();

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
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  // The offerer is willing to sell either token ID 1 or 3, but not 2
                  identifiers: [nftId, nftId2, nftId3],
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

          it.only("ERC721 <=> ETH", async () => {
            const { consideration, testErc721 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions: revertedActions } =
              await consideration.fulfillOrder(
                order,
                {
                  offerCriteria: [
                    { identifier: nftId2, validIdentifiers: [nftId2] },
                  ],
                },
                fulfiller.address
              );

            expect(revertedActions.length).to.eq(1);

            const revertedFulfill = revertedActions[0];

            expect(revertedFulfill).to.deep.equal({
              type: "exchange",
              transactionRequest: revertedFulfill.transactionRequest,
            });

            // Nft with ID 2 was not in the initial set of valid identifiers
            // await expect(
            //   revertedFulfill.transactionRequest.send()
            // ).to.be.revertedWith("InvalidProof()");

            const { actions } = await consideration.fulfillOrder(
              order,
              {
                offerCriteria: [
                  {
                    identifier: nftId3,
                    validIdentifiers: [nftId, nftId2, nftId3],
                  },
                ],
              },
              fulfiller.address
            );

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action).to.deep.equal({
              type: "exchange",
              transactionRequest: action.transactionRequest,
            });

            const transaction = await action.transactionRequest.send();

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

            expect(fulfillStandardOrderSpy).calledOnce;
          });

          it("ERC721 <=> ERC20", async () => {
            const { consideration, testErc20, testErc721 } = fixture;

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

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const orderStatus = await consideration.getOrderStatus(
              consideration.getOrderHash({
                ...order.parameters,
                nonce: order.nonce,
              })
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder(
              order,
              { offerCriteria: [{ identifier: nftId }] },
              fulfiller.address
            );

            expect(actions.length).to.eq(2);

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionRequest: approvalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await approvalAction.transactionRequest.send();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionRequest: fulfillAction.transactionRequest,
            });

            const transaction = await fulfillAction.transactionRequest.send();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              unitsToFill: 2,
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

        describe("[Accept offer] I want to accept a trait based offer", () => {
          beforeEach(async () => {
            const { testErc721, testErc20 } = fixture;

            await testErc721.mint(fulfiller.address, nftId);
            await testErc20.mint(offerer.address, parseEther("10").toString());

            standardCreateOrderInput = {
              allowPartialFills: true,
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
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
            const { consideration, testErc721, testErc20 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
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

            const { actions } = await consideration.fulfillOrder(
              order,
              { considerationCriteria: [{ identifier: nftId }] },
              fulfiller.address
            );

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc721.address,
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721_WITH_CRITERIA,
              transactionRequest: approvalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await approvalAction.transactionRequest.send();

            expect(
              await testErc721.isApprovedForAll(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.be.true;

            // We also need to approve ERC-20 as we send that out as fees..
            const secondApprovalAction = actions[1];

            expect(secondApprovalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionRequest: secondApprovalAction.transactionRequest,
              operator: consideration.contract.address,
            });

            await secondApprovalAction.transactionRequest.send();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.eq(MAX_INT);

            const fulfillAction = actions[2];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionRequest: fulfillAction.transactionRequest,
            });

            const transaction = await fulfillAction.transactionRequest.send();

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
    });
  }
);
