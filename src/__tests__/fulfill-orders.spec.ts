import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { Consideration } from "../consideration";
import { ItemType, MAX_INT, OrderType, ProxyStrategy } from "../constants";
import { TestERC721 } from "../typechain";
import { CreateOrderInput, CurrencyItem } from "../types";
import * as fulfill from "../utils/fulfill";
import { generateRandomSalt } from "../utils/order";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy multiple listings or accept multiple offers",
  (fixture) => {
    let offerer: SignerWithAddress;
    let secondOfferer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let standardCreateOrderInput: CreateOrderInput;
    let multicallProvider: providers.MulticallProvider;
    let fulfillAvailableOrdersSpy: sinon.SinonSpy;
    let secondTestErc721: TestERC721;

    const nftId = "1";
    const nftId2 = "2";
    const erc1155Amount = "3";

    beforeEach(async () => {
      fulfillAvailableOrdersSpy = sinon.spy(fulfill, "fulfillAvailableOrders");

      [offerer, secondOfferer, zone, fulfiller] = await ethers.getSigners();

      multicallProvider = new providers.MulticallProvider(ethers.provider);

      const TestERC721 = await ethers.getContractFactory("TestERC721");
      secondTestErc721 = await TestERC721.deploy();
      await secondTestErc721.deployed();
    });

    afterEach(() => {
      fulfillAvailableOrdersSpy.restore();
    });

    describe("Multiple ERC721s are to be transferred from separate orders", async () => {
      describe("[Buy now] I want to buy three ERC721 listings", async () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          // These will be used in 3 separate orders
          await testErc721.mint(offerer.address, nftId);
          await testErc721.mint(offerer.address, nftId2);
          await secondTestErc721.mint(secondOfferer.address, nftId);
        });

        describe("with ETH", () => {
          it.only("3 ERC721 <=> ETH", async () => {
            const { consideration, testErc721 } = fixture;

            const firstOrderUseCase = await consideration.createOrder({
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
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
            });

            const firstOrder = await firstOrderUseCase.executeAllActions();

            const secondOrderUseCase = await consideration.createOrder({
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: testErc721.address,
                  identifier: nftId2,
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
            });

            const secondOrder = await secondOrderUseCase.executeAllActions();

            const thirdOrderUseCase = await consideration.createOrder(
              {
                startTime: "0",
                endTime: MAX_INT.toString(),
                salt: generateRandomSalt(),
                offer: [
                  {
                    itemType: ItemType.ERC721,
                    token: secondTestErc721.address,
                    identifier: nftId,
                  },
                ],
                consideration: [
                  {
                    amount: parseEther("10").toString(),
                    recipient: secondOfferer.address,
                  },
                ],
                // 2.5% fee
                fees: [{ recipient: zone.address, basisPoints: 250 }],
              },
              secondOfferer.address
            );

            const thirdOrder = await thirdOrderUseCase.executeAllActions();

            const { actions } = await consideration.fulfillOrders(
              [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              fulfiller.address
            );

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            const transaction = await action.transaction.transact();
            const receipt = await transaction.wait();

            const owners = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
              secondTestErc721.ownerOf(nftId),
            ]);

            expect(owners.every((owner) => owner === fulfiller.address)).to.be
              .true;

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC721 <=> ETH (two offer via proxy)", async () => {
            const { testErc721, considerationContract } = fixture;

            await testErc721
              .connect(offerer)
              .setApprovalForAll(considerationContract.address, false);

            const { consideration } = fixture;
            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            expect(order.parameters.orderType).eq(
              OrderType.FULL_OPEN_VIA_PROXY
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            const transaction = await action.transaction.transact();
            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC721 <=> ETH (already validated order)", async () => {
            const { consideration } = fixture;
            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const action = actions[0];

            // Should revert because signature is empty
            await expect(action.transaction.transact()).to.be.revertedWith(
              "InvalidSigner"
            );

            await consideration.approveOrders([order], offerer.address);

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const transaction = await action.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };
            testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );
          });

          it("ERC721 <=> ERC20", async () => {
            const { consideration, testErc20 } = fixture;

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

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC721 <=> ERC20 (offer via proxy)", async () => {
            const { testErc721, consideration, testErc20 } = fixture;

            await testErc721
              .connect(offerer)
              .setApprovalForAll(consideration.contract.address, false);

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            expect(order.parameters.orderType).eq(
              OrderType.FULL_OPEN_VIA_PROXY
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC721 <=> ERC20 (already validated order)", async () => {
            const { consideration, testErc20 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const revertedUseCase = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const actions = revertedUseCase.actions;

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            await expect(
              fulfillAction.transaction.transact()
            ).to.be.revertedWith("InvalidSigner");

            await consideration.approveOrders([order], offerer.address);

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC721 <=> ERC20 (cannot be fulfilled via proxy)", async () => {
            const { consideration, legacyProxyRegistry, testErc20 } = fixture;

            // Register the proxy on the fulfiller
            await legacyProxyRegistry.connect(fulfiller).registerProxy();

            const fulfillerProxy = await legacyProxyRegistry.proxies(
              fulfiller.address
            );

            await testErc20.connect(fulfiller).approve(fulfillerProxy, MAX_INT);

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

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            // Even though the proxy has approval, we still check approvals on consideration contract

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });
      });

      describe("[Accept offer] I want to accept an offer for my single ERC721", async () => {
        beforeEach(async () => {
          const { testErc721, testErc20 } = fixture;

          await testErc721.mint(fulfiller.address, nftId);
          await testErc20.mint(offerer.address, parseEther("10").toString());

          standardCreateOrderInput = {
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
                identifier: nftId,
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC721", async () => {
          const { consideration, testErc721 } = fixture;

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

          const { actions } = await consideration.fulfillOrder({
            order,
            accountAddress: fulfiller.address,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc721.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transaction: approvalAction.transaction,
            operator: consideration.contract.address,
          });

          await approvalAction.transaction.transact();

          expect(
            await testErc721.isApprovedForAll(
              fulfiller.address,
              consideration.contract.address
            )
          ).to.be.true;

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transaction: fulfillAction.transaction,
          });

          const transaction = await fulfillAction.transaction.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
          expect(fulfillAvailableOrdersSpy).calledOnce;
        });

        it("ERC20 <=> ERC721 (fulfilled via proxy)", async () => {
          const { consideration, testErc721, legacyProxyRegistry } = fixture;

          const { executeAllActions } = await consideration.createOrder(
            standardCreateOrderInput,
            offerer.address
          );

          const order = await executeAllActions();

          // Register the proxy on the fulfiller
          await legacyProxyRegistry.connect(fulfiller).registerProxy();

          const fulfillerProxy = await legacyProxyRegistry.proxies(
            fulfiller.address
          );

          await testErc721
            .connect(fulfiller)
            .setApprovalForAll(fulfillerProxy, true);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              multicallProvider
            );

          const { actions } = await consideration.fulfillOrder({
            order,
            accountAddress: fulfiller.address,
          });

          const fulfillAction = actions[0];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transaction: fulfillAction.transaction,
          });

          const transaction = await fulfillAction.transaction.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
          expect(fulfillAvailableOrdersSpy).calledOnce;
        });
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC1155", async () => {
        beforeEach(async () => {
          const { testErc1155, legacyProxyRegistry, considerationContract } =
            fixture;

          await testErc1155.mint(offerer.address, nftId, erc1155Amount);

          // Register the proxy on the offerer
          await legacyProxyRegistry.connect(offerer).registerProxy();

          const offererProxy = await legacyProxyRegistry.proxies(
            offerer.address
          );

          // Approving both proxy and consideration contract for convenience
          await testErc1155
            .connect(offerer)
            .setApprovalForAll(offererProxy, true);

          await testErc1155
            .connect(offerer)
            .setApprovalForAll(considerationContract.address, true);

          standardCreateOrderInput = {
            startTime: "0",
            endTime: MAX_INT.toString(),
            salt: generateRandomSalt(),
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                identifier: nftId,
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

        describe("with ETH", () => {
          it("ERC1155 <=> ETH", async () => {
            const { consideration } = fixture;

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

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const fulfillAction = actions[0];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC1155 <=> ETH (offer via proxy)", async () => {
            const { testErc1155, considerationContract } = fixture;

            await testErc1155
              .connect(offerer)
              .setApprovalForAll(considerationContract.address, false);

            const { consideration } = fixture;
            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            expect(order.parameters.orderType).eq(
              OrderType.FULL_OPEN_VIA_PROXY
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const fulfillAction = actions[0];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC1155 <=> ETH (already validated order)", async () => {
            const { consideration } = fixture;
            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const fulfillAction = actions[0];

            // Should revert because signature is empty
            await expect(
              fulfillAction.transaction.transact()
            ).to.be.revertedWith("InvalidSigner");

            await consideration.approveOrders([order], offerer.address);

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

            // Use ERC20 instead of eth
            standardCreateOrderInput = {
              ...standardCreateOrderInput,
              consideration: standardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address })
              ),
            };
            testErc20.mint(
              fulfiller.address,
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );
          });

          it("ERC1155 <=> ERC20", async () => {
            const { consideration, testErc20 } = fixture;

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

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC1155 <=> ERC20 (offer via proxy)", async () => {
            const { testErc1155, consideration, testErc20 } = fixture;

            await testErc1155
              .connect(offerer)
              .setApprovalForAll(consideration.contract.address, false);

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            expect(order.parameters.orderType).eq(
              OrderType.FULL_OPEN_VIA_PROXY
            );

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC1155 <=> ERC20 (already validated order)", async () => {
            const { consideration, testErc20 } = fixture;

            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            await expect(
              fulfillAction.transaction.transact()
            ).to.be.revertedWith("InvalidSigner");

            await consideration.approveOrders([order], offerer.address);

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });

          it("ERC1155 <=> ERC20 (cannot be fulfilled via proxy)", async () => {
            const { consideration, legacyProxyRegistry, testErc20 } = fixture;

            // Register the proxy on the fulfiller
            await legacyProxyRegistry.connect(fulfiller).registerProxy();

            const fulfillerProxy = await legacyProxyRegistry.proxies(
              fulfiller.address
            );

            await testErc20.connect(fulfiller).approve(fulfillerProxy, MAX_INT);

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

            const { actions } = await consideration.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
            });

            // Even though the proxy has approval, we still check approvals on consideration contract

            const approvalAction = actions[0];

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.transaction,
              operator: consideration.contract.address,
            });

            await approvalAction.transaction.transact();

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.transaction,
            });

            const transaction = await fulfillAction.transaction.transact();

            const receipt = await transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });
      });

      describe("[Accept offer] I want to accept an offer for my single ERC1155", async () => {
        beforeEach(async () => {
          const { testErc1155, considerationContract, testErc20 } = fixture;

          await testErc1155.mint(fulfiller.address, nftId, erc1155Amount);
          await testErc20.mint(offerer.address, parseEther("10").toString());

          // Approving offerer amount for convenience
          await testErc20
            .connect(offerer)
            .approve(considerationContract.address, MAX_INT);

          standardCreateOrderInput = {
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
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                identifier: nftId,
                recipient: offerer.address,
                amount: erc1155Amount,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155", async () => {
          const { consideration, testErc1155 } = fixture;

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

          const { actions } = await consideration.fulfillOrder({
            order,
            accountAddress: fulfiller.address,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc1155.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transaction: approvalAction.transaction,
            operator: consideration.contract.address,
          });

          await approvalAction.transaction.transact();

          expect(
            await testErc1155.isApprovedForAll(
              fulfiller.address,
              consideration.contract.address
            )
          ).to.be.true;

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transaction: fulfillAction.transaction,
          });

          const transaction = await fulfillAction.transaction.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
          expect(fulfillAvailableOrdersSpy).calledOnce;
        });

        it("ERC20 <=> ERC721 (fulfilled via proxy)", async () => {
          const { consideration, testErc1155, legacyProxyRegistry } = fixture;

          const { executeAllActions } = await consideration.createOrder(
            standardCreateOrderInput,
            offerer.address
          );

          const order = await executeAllActions();

          // Register the proxy on the fulfiller
          await legacyProxyRegistry.connect(fulfiller).registerProxy();

          const fulfillerProxy = await legacyProxyRegistry.proxies(
            fulfiller.address
          );

          await testErc1155
            .connect(fulfiller)
            .setApprovalForAll(fulfillerProxy, true);

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              multicallProvider
            );

          const { actions } = await consideration.fulfillOrder({
            order,
            accountAddress: fulfiller.address,
          });
          const fulfillAction = actions[0];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transaction: fulfillAction.transaction,
          });

          const transaction = await fulfillAction.transaction.transact();

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
          expect(fulfillAvailableOrdersSpy).calledOnce;
        });
      });
    });

    describe("with proxy strategy", () => {
      beforeEach(async () => {
        const { testErc721, considerationContract, testErc20 } = fixture;

        await testErc721.mint(fulfiller.address, nftId);
        await testErc20.mint(offerer.address, parseEther("10").toString());

        // Approving offerer amount for convenience
        await testErc20
          .connect(offerer)
          .approve(considerationContract.address, MAX_INT);

        standardCreateOrderInput = {
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
              identifier: nftId,
              recipient: offerer.address,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("should use my proxy if my proxy requires zero approvals while I require approvals", async () => {
        const { consideration, testErc721, legacyProxyRegistry } = fixture;

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

        // Register the proxy on the fulfiller
        await legacyProxyRegistry.connect(fulfiller).registerProxy();

        const fulfillerProxy = await legacyProxyRegistry.proxies(
          fulfiller.address
        );

        await testErc721
          .connect(fulfiller)
          .setApprovalForAll(fulfillerProxy, true);

        const { actions } = await consideration.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        // I should have sufficient approvals because it automatically uses my proxy
        const fulfillAction = actions[0];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transaction: fulfillAction.transaction,
        });

        const transaction = await fulfillAction.transaction.transact();

        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
        });
        expect(fulfillAvailableOrdersSpy).calledOnce;
      });

      it("should not use my proxy if proxy strategy is set to NEVER", async () => {
        const { considerationContract, testErc721, legacyProxyRegistry } =
          fixture;

        const consideration = new Consideration(ethers.provider, {
          overrides: {
            contractAddress: considerationContract.address,
            legacyProxyRegistryAddress: legacyProxyRegistry.address,
          },
          proxyStrategy: ProxyStrategy.NEVER,
        });

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

        // Register the proxy on the fulfiller
        await legacyProxyRegistry.connect(fulfiller).registerProxy();

        const fulfillerProxy = await legacyProxyRegistry.proxies(
          fulfiller.address
        );

        await testErc721
          .connect(fulfiller)
          .setApprovalForAll(fulfillerProxy, true);

        const { actions } = await consideration.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        // I should not have sufficient approvals because it does not use my proxy

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: testErc721.address,
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transaction: approvalAction.transaction,
          operator: consideration.contract.address,
        });

        await approvalAction.transaction.transact();

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transaction: fulfillAction.transaction,
        });

        const transaction = await fulfillAction.transaction.transact();

        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
        });
        expect(fulfillAvailableOrdersSpy).calledOnce;
      });

      it("should use my proxy if proxy strategy is set to ALWAYS, even if I require zero approvals", async () => {
        const { considerationContract, testErc721, legacyProxyRegistry } =
          fixture;

        const consideration = new Consideration(ethers.provider, {
          overrides: {
            contractAddress: considerationContract.address,
            legacyProxyRegistryAddress: legacyProxyRegistry.address,
          },
          proxyStrategy: ProxyStrategy.ALWAYS,
        });

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

        await legacyProxyRegistry.connect(fulfiller).registerProxy();

        const fulfillerProxy = await legacyProxyRegistry.proxies(
          fulfiller.address
        );

        // Approve directly
        await testErc721
          .connect(fulfiller)
          .setApprovalForAll(considerationContract.address, true);

        const { actions } = await consideration.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        // I should not have sufficient approvals because it always uses my proxy
        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: testErc721.address,
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transaction: approvalAction.transaction,
          operator: fulfillerProxy,
        });

        await approvalAction.transaction.transact();

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transaction: fulfillAction.transaction,
        });

        const transaction = await fulfillAction.transaction.transact();

        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
        });
        expect(fulfillAvailableOrdersSpy).calledOnce;
      });
    });
  }
);
