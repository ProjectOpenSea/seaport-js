import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, MAX_INT, OrderType } from "../constants";
import { TestERC20 } from "../typechain";
import { CreateOrderInput } from "../types";
import * as fulfill from "../utils/fulfill";
import { generateRandomSalt } from "../utils/order";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer",
  (fixture) => {
    let fulfillBasicOrderSpy: sinon.SinonSpy;

    beforeEach(() => {
      fulfillBasicOrderSpy = sinon.spy(fulfill, "fulfillBasicOrder");
    });

    afterEach(() => {
      fulfillBasicOrderSpy.restore();
    });

    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC721", async () => {
        let offerer: SignerWithAddress;
        let zone: SignerWithAddress;
        let fulfiller: SignerWithAddress;
        let standardCreateOrderInput: CreateOrderInput;
        let multicallProvider: providers.MulticallProvider;

        const nftId = "1";

        beforeEach(async () => {
          [offerer, zone, fulfiller] = await ethers.getSigners();
          const { testErc721, legacyProxyRegistry, considerationContract } =
            fixture;
          multicallProvider = new providers.MulticallProvider(ethers.provider);

          await testErc721.mint(offerer.address, nftId);

          // Register the proxy on the offerer
          await legacyProxyRegistry.connect(offerer).registerProxy();

          const offererProxy = await legacyProxyRegistry.proxies(
            offerer.address
          );

          // Approving both proxy and consideration contract for convenience
          await testErc721
            .connect(offerer)
            .setApprovalForAll(offererProxy, true);

          await testErc721
            .connect(offerer)
            .setApprovalForAll(considerationContract.address, true);

          standardCreateOrderInput = {
            startTime: "0",
            endTime: MAX_INT.toString(),
            salt: generateRandomSalt(),
            offer: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifierOrCriteria: nftId,
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
            const { consideration } = fixture;

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

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(0);
            expect(numActions).to.eq(1);

            const actions = await genActions();
            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
          });

          it("ERC721 <=> ETH (offer via proxy)", async () => {
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

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(0);
            expect(numActions).to.eq(1);

            const actions = await genActions();
            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
          });

          it("ERC721 <=> ETH (already validated order)", async () => {
            const { consideration } = fixture;
            const { executeAllActions } = await consideration.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            // Remove signature
            order.signature = "0x";

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(0);
            expect(numActions).to.eq(1);

            // Should revert because signature is empty
            const revertedActions = await genActions();
            await expect(revertedActions.next()).to.be.revertedWith(
              "BadSignatureLength"
            );

            await consideration.approveOrders([order], offerer.address);

            const ownerToTokenToIdentifierBalances =
              await getBalancesForFulfillOrder(
                order,
                fulfiller.address,
                multicallProvider
              );

            const actions = await genActions();
            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
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
              BigNumber.from(standardCreateOrderInput.consideration[0].amount)
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

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(1);
            expect(numActions).to.eq(2);

            const actions = await genActions();

            const approvalAction = await actions.next();

            isExactlyNotTrue(approvalAction.done);

            expect(approvalAction.value).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.value.transaction,
              operator: consideration.contract.address,
            });

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
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

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(1);
            expect(numActions).to.eq(2);

            const actions = await genActions();

            const approvalAction = await actions.next();

            isExactlyNotTrue(approvalAction.done);

            expect(approvalAction.value).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.value.transaction,
              operator: consideration.contract.address,
            });

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
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

            const revertedUseCase = await consideration.fulfillOrder(
              order,
              undefined,
              fulfiller.address
            );

            expect(revertedUseCase.insufficientApprovals.length).to.eq(1);
            expect(revertedUseCase.numActions).to.eq(2);

            const revertedActions = await revertedUseCase.genActions();

            const approvalAction = await revertedActions.next();

            isExactlyNotTrue(approvalAction.done);

            expect(approvalAction.value).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.value.transaction,
              operator: consideration.contract.address,
            });

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            await expect(revertedActions.next()).to.be.revertedWith(
              "BadSignatureLength"
            );

            await consideration.approveOrders([order], offerer.address);

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            expect(insufficientApprovals.length).to.eq(0);
            expect(numActions).to.eq(1);

            const actions = await genActions();

            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledTwice;
          });

          it("ERC721 <=> ERC20 (cannot be fulfilled via proxy)", async () => {
            const { consideration, legacyProxyRegistry, testErc20 } = fixture;

            // Register the proxy on the fulfiller
            await legacyProxyRegistry.connect(fulfiller).registerProxy();

            const fulfillerProxy = await legacyProxyRegistry.proxies(
              offerer.address
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

            const { insufficientApprovals, genActions, numActions } =
              await consideration.fulfillOrder(
                order,
                undefined,
                fulfiller.address
              );

            // Even though the proxy has approval, we still check approvals on consideration contract
            expect(insufficientApprovals.length).to.eq(1);
            expect(numActions).to.eq(2);

            const actions = await genActions();

            const approvalAction = await actions.next();

            isExactlyNotTrue(approvalAction.done);

            expect(approvalAction.value).to.deep.equal({
              type: "approval",
              token: testErc20.address,
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transaction: approvalAction.value.transaction,
              operator: consideration.contract.address,
            });

            expect(
              await testErc20.allowance(
                fulfiller.address,
                consideration.contract.address
              )
            ).to.equal(MAX_INT);

            const fulfillAction = await actions.next();

            isExactlyTrue(fulfillAction.done);

            expect(fulfillAction.value).to.be.deep.equal({
              type: "exchange",
              transaction: fulfillAction.value.transaction,
            });

            const receipt = await fulfillAction.value.transaction.wait();

            await verifyBalancesAfterFulfill({
              ownerToTokenToIdentifierBalances,
              order,
              fulfillerAddress: fulfiller.address,
              multicallProvider,
              fulfillReceipt: receipt,
            });
            expect(fulfillBasicOrderSpy).calledOnce;
          });
        });
      });

      describe.only("[Accept offer] I want to accept an offer for my single ERC721", async () => {
        let offerer: SignerWithAddress;
        let zone: SignerWithAddress;
        let fulfiller: SignerWithAddress;
        let standardCreateOrderInput: CreateOrderInput;
        let multicallProvider: providers.MulticallProvider;

        const nftId = "1";

        beforeEach(async () => {
          [offerer, zone, fulfiller] = await ethers.getSigners();
          const { testErc721, considerationContract, testErc20 } = fixture;
          multicallProvider = new providers.MulticallProvider(ethers.provider);

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
                identifierOrCriteria: nftId,
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

          const { insufficientApprovals, genActions, numActions } =
            await consideration.fulfillOrder(
              order,
              undefined,
              fulfiller.address
            );

          expect(insufficientApprovals.length).to.eq(1);
          expect(numActions).to.eq(2);

          const actions = await genActions();

          const approvalAction = await actions.next();

          isExactlyNotTrue(approvalAction.done);

          expect(approvalAction.value).to.deep.equal({
            type: "approval",
            token: testErc721.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transaction: approvalAction.value.transaction,
            operator: consideration.contract.address,
          });

          expect(
            await testErc721.isApprovedForAll(
              fulfiller.address,
              consideration.contract.address
            )
          ).to.be.true;

          const fulfillAction = await actions.next();

          isExactlyTrue(fulfillAction.done);

          expect(fulfillAction.value).to.be.deep.equal({
            type: "exchange",
            transaction: fulfillAction.value.transaction,
          });

          const receipt = await fulfillAction.value.transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });
          expect(fulfillBasicOrderSpy).calledOnce;
        });
        it("ERC20 <=> ERC721 (offer via proxy)", async () => {});
        it("ERC20 <=> ERC721 (already validated order)", async () => {});
        it("ERC20 <=> ERC721 (extra ether supplied and returned to caller)", async () => {});
        it("ERC20 <=> ERC721 (fulfilled via proxy)", async () => {});
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC1155", async () => {
        it("ERC1155 <=> ETH", async () => {});
        it("ERC1155 <=> ETH (offer via proxy)", async () => {});
        it("ERC1155 <=> ETH (already validated order)", async () => {});
        it("ERC1155 <=> ETH (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ETH (fulfilled via proxy)", async () => {});
        it("ERC1155 <=> ERC20", async () => {});
        it("ERC1155 <=> ERC20 (offer via proxy)", async () => {});
        it("ERC1155 <=> ERC20 (already validated order)", async () => {});
        it("ERC1155 <=> ERC20 (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ERC20 (fulfilled via proxy)", async () => {});
      });

      describe("[Accept offer] I want to accept an offer for my single ERC1155", async () => {
        it("ERC1155 <=> ETH", async () => {});
        it("ERC1155 <=> ETH (offer via proxy)", async () => {});
        it("ERC1155 <=> ETH (already validated order)", async () => {});
        it("ERC1155 <=> ETH (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ETH (fulfilled via proxy)", async () => {});
        it("ERC1155 <=> ERC20", async () => {});
        it("ERC1155 <=> ERC20 (offer via proxy)", async () => {});
        it("ERC1155 <=> ERC20 (already validated order)", async () => {});
        it("ERC1155 <=> ERC20 (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ERC20 (fulfilled via proxy)", async () => {});
      });
    });

    describe("with proxy strategy", () => {
      it("should use my proxy if my proxy requires zero approvals while I require approvals", async () => {});
      it("should not use my proxy if both my proxy and I require zero approvals", async () => {});
      it("should not use my proxy if proxy strategy is set to NEVER", async () => {});
      it("should use my proxy if proxy strategy is set to ALWAYS, even if I require zero approvals", async () => {});
    });
  }
);
