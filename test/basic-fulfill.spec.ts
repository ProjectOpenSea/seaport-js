import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";
import { OPENSEA_DOMAIN, OVERRIDE_GAS_LIMIT } from "./utils/constants";
import { SinonSpy } from "sinon";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy now or accept an offer",
  (fixture) => {
    let offerer: Signer;
    let zone: Signer;
    let fulfiller: Signer;
    let standardCreateOrderInput: CreateOrderInput;
    let fulfillBasicOrderSpy: SinonSpy;
    let fulfillStandardOrderSpy: SinonSpy;
    const nftId = "1";
    const erc1155Amount = "3";

    beforeEach(async () => {
      fulfillBasicOrderSpy = sinon.spy(fulfill, "fulfillBasicOrder");
      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      [offerer, zone, fulfiller] = await ethers.getSigners();
    });

    afterEach(() => {
      fulfillBasicOrderSpy.restore();
      fulfillStandardOrderSpy.restore();
    });

    describe("A single ERC721 is to be transferred", () => {
      describe("[Buy now] I want to buy a single ERC721", () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          await testErc721.mint(await offerer.getAddress(), nftId);

          standardCreateOrderInput = {
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
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        describe("with ETH", () => {
          it("ERC721 <=> ETH", async () => {
            const { seaport } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            await expect(
              seaport.fulfillOrder({
                order: { ...order, signature: "" },
              }),
            ).to.be.rejectedWith("Order is missing signature");

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            const transaction = await action.transactionMethods.transact();
            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillBasicOrderSpy.calledOnce);
          });

          it("ERC721 <=> ETH (already validated order)", async () => {
            const { seaport, seaportContract } = fixture;
            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const action = actions[0];

            // Should revert because signature is empty
            await expect(
              action.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillBasicOrderSpy.calledOnce);
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

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
            testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20 } = fixture;

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
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
              overrides: { gasLimit: OVERRIDE_GAS_LIMIT },
            });

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
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillBasicOrderSpy.calledOnce);
            expect(transaction.gasLimit).equal(OVERRIDE_GAS_LIMIT);
          });

          it("ERC721 <=> ERC20 (already validated order)", async () => {
            const { seaport, seaportContract, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const revertedUseCase = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const actions = revertedUseCase.actions;

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

            await expect(
              fulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillBasicOrderSpy.calledOnce);
          });
        });
      });

      describe("[Accept offer] I want to accept an offer for my single ERC721", () => {
        beforeEach(async () => {
          const { testErc721, testErc20 } = fixture;

          await testErc721.mint(await fulfiller.getAddress(), nftId);
          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("10").toString(),
          );

          standardCreateOrderInput = {
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
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC721", async () => {
          const { seaport, testErc721 } = fixture;

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
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc721.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
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

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });
          expect(fulfillBasicOrderSpy.calledOnce);
        });
      });
    });

    describe("A single ERC1155 is to be transferred", () => {
      describe("[Buy now] I want to buy a single ERC1155", () => {
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
                identifier: nftId,
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

        describe("with ETH", () => {
          it("ERC1155 <=> ETH", async () => {
            const { seaport } = fixture;

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
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const fulfillAction = actions[0];

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
            expect(fulfillBasicOrderSpy.calledOnce);
          });

          it("ERC1155 <=> ETH (already validated order)", async () => {
            const { seaport, seaportContract } = fixture;
            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const fulfillAction = actions[0];

            // Should revert because signature is empty
            await expect(
              fulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

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
            expect(fulfillBasicOrderSpy.calledOnce);
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

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
            testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20 } = fixture;

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
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

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
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillBasicOrderSpy.calledOnce);
          });

          it("ERC1155 <=> ERC20 (already validated order)", async () => {
            const { seaport, seaportContract, testErc20 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

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

            await expect(
              fulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

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
            expect(fulfillBasicOrderSpy.calledOnce);
          });
        });
      });

      describe("[Accept offer] I want to accept an offer for my single ERC1155", () => {
        beforeEach(async () => {
          const { testErc1155, seaportContract, testErc20 } = fixture;

          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
          );
          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("10").toString(),
          );

          // Approving offerer amount for convenience
          await testErc20
            .connect(offerer)
            .approve(await seaportContract.getAddress(), MAX_INT);

          standardCreateOrderInput = {
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
                identifier: nftId,
                recipient: await offerer.getAddress(),
                amount: erc1155Amount,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155", async () => {
          const { seaport, testErc1155 } = fixture;

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
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc1155.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
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

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });
          expect(fulfillBasicOrderSpy.calledOnce);
        });
      });
    });

    describe("ERC20 is to be transferred", () => {
      describe("[Buy now] I want to buy ERC20", () => {
        beforeEach(async () => {
          const { testErc20 } = fixture;

          await testErc20.mint(await offerer.getAddress(), "10000");

          standardCreateOrderInput = {
            startTime: "0",
            offer: [
              {
                token: await testErc20.getAddress(),
                amount: "10000",
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: await offerer.getAddress(),
              },
            ],
          };
        });

        describe("with ETH", () => {
          it("ERC20 <=> ETH", async () => {
            const { seaport } = fixture;

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
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            expect(actions.length).to.eq(1);

            const fulfillAction = actions[0];

            expect(fulfillAction.type).eq("exchange");

            const transaction =
              await fulfillAction.transactionMethods.transact();
            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillStandardOrderSpy.calledOnce);
          });

          it("ERC20 <=> ETH (already validated order)", async () => {
            const { seaport, seaportContract } = fixture;
            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const action = actions[0];

            // Should revert because signature is empty
            await expect(
              action.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const transaction = await action.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillStandardOrderSpy.calledOnce);
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20USDC } = fixture;

            // Use ERC20 instead of eth
            const token = await testErc20USDC.getAddress();
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({
                  ...item,
                  token,
                }),
              ),
            };
            testErc20USDC.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );
            standardCreateOrderInput;
          });

          it("ERC20 <=> ERC20", async () => {
            const { seaport, testErc20USDC } = fixture;

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
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20USDC.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20USDC.allowance(
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
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillStandardOrderSpy.calledOnce);
          });

          it("ERC20 <=> ERC20 (already validated order)", async () => {
            const { seaport, seaportContract, testErc20USDC } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                await fulfiller.getAddress(),
              );

            const revertedUseCase = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            });

            const actions = revertedUseCase.actions;

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20USDC.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            });

            await approvalAction.transactionMethods.transact();

            expect(
              await testErc20USDC.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await expect(
              fulfillAction.transactionMethods.transact(),
            ).to.be.revertedWithCustomError(
              seaportContract,
              "InvalidSignature",
            );

            await seaport
              .validate([order], await offerer.getAddress())
              .transact();

            const transaction =
              await fulfillAction.transactionMethods.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: await fulfiller.getAddress(),
              fulfillReceipt: receipt!,
            });
            expect(fulfillStandardOrderSpy.calledOnce);
          });
        });
      });

      describe("[Accept offer] I want to accept an offer for my ERC20", () => {
        beforeEach(async () => {
          const { testErc20USDC, testErc20 } = fixture;

          await testErc20USDC.mint(
            await fulfiller.getAddress(),
            parseEther("50").toString(),
          );
          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("10").toString(),
          );

          standardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: await testErc20.getAddress(),
              },
            ],
            consideration: [
              {
                token: await testErc20USDC.getAddress(),
                amount: parseEther("50").toString(),
              },
            ],
          };
        });

        it("ERC20 <=> ERC20", async () => {
          const { seaport, testErc20USDC } = fixture;

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
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc20USDC.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: approvalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await approvalAction.transactionMethods.transact();

          expect(
            await testErc20USDC.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });
          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });
  },
);
