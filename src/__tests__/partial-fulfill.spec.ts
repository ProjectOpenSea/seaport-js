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
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer partially",
  (fixture) => {
    let offerer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let multicallProvider: providers.MulticallProvider;

    let fulfillStandardOrderSpy: sinon.SinonSpy;
    let standardCreateOrderInput: CreateOrderInput;
    let secondTestErc1155: TestERC1155;

    const nftId = "1";

    const OPENSEA_DOMAIN = "opensea.io";
    const OPENSEA_TAG = "360c6ebe";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();
      multicallProvider = new providers.MulticallProvider(ethers.provider);

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.deployed();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("An ERC1155 is partially transferred", async () => {
      describe("[Buy now] I want to partially buy an ERC1155", async () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 10 ERC1155s to offerer
          await testErc1155.mint(offerer.address, nftId, 10);

          standardCreateOrderInput = {
            allowPartialFills: true,

            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                amount: "10",
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

        it("ERC1155 <=> ETH", async () => {
          const { seaport, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const transaction = await action.transactionMethods.transact();

          const receipt = await transaction.wait();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          expect(offererErc1155Balance).eq(BigNumber.from(8));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

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
              (standardCreateOrderInput.consideration[0] as CurrencyItem).amount
            )
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
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

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          expect(offererErc1155Balance).eq(BigNumber.from(8));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", async () => {
        beforeEach(async () => {
          const { testErc20, testErc1155 } = fixture;

          // Mint 10 ERC1155s to fulfiller
          await testErc1155.mint(fulfiller.address, nftId, 10);

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
                identifier: nftId,
                amount: "10",
                recipient: offerer.address,
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

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc1155.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
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
          const second = actions[1];

          expect(second).to.deep.equal({
            type: "approval",
            token: testErc20.address,
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: second.transactionMethods,
            operator: seaport.contract.address,
          });

          await second.transactionMethods.transact();

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

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            orderStatus,
            unitsToFill: 2,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          expect(offererErc1155Balance).eq(BigNumber.from(2));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(8));

          // Double check nft balances
          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });
    });

    describe("Multiple ERC1155s are partially transferred", async () => {
      describe("[Buy now] I want to partially buy two separate ERC1155s", async () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 10 and 5 ERC1155s to offerer
          await testErc1155.mint(offerer.address, nftId, 10);
          await secondTestErc1155.mint(offerer.address, nftId, 5);

          standardCreateOrderInput = {
            allowPartialFills: true,

            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                amount: "10",
                identifier: nftId,
              },
              {
                itemType: ItemType.ERC1155,
                token: secondTestErc1155.address,
                amount: "5",
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

        it("ERC1155 + ERC1155 <=> ETH", async () => {
          const { seaport, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const transaction = await action.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(BigNumber.from(6));
          expect(offererSecondErc1155Balance).eq(BigNumber.from(3));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(4));
          expect(fulfillerSecondErc1155Balance).eq(BigNumber.from(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });

        it("ERC1155 + ERC1155 <=> ERC20", async () => {
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
              (standardCreateOrderInput.consideration[0] as CurrencyItem).amount
            )
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
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

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(BigNumber.from(6));
          expect(offererSecondErc1155Balance).eq(BigNumber.from(3));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(4));
          expect(fulfillerSecondErc1155Balance).eq(BigNumber.from(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", async () => {
        beforeEach(async () => {
          const { testErc20, testErc1155 } = fixture;

          // Mint 10 ERC1155s to fulfiller
          await testErc1155.mint(fulfiller.address, nftId, 10);
          await secondTestErc1155.mint(fulfiller.address, nftId, 5);

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
                identifier: nftId,
                amount: "10",
                recipient: offerer.address,
              },
              {
                itemType: ItemType.ERC1155,
                token: secondTestErc1155.address,
                identifier: nftId,
                amount: "5",
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155 + ERC1155", async () => {
          const { seaport, testErc1155, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
            offerer.address
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

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
            unitsToFill: 2,
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc1155.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
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

          const secondApprovalAction = actions[1];

          expect(secondApprovalAction).to.deep.equal({
            type: "approval",
            token: secondTestErc1155.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await secondApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc1155.isApprovedForAll(
              fulfiller.address,
              seaport.contract.address
            )
          ).to.be.true;

          // We also need to approve ERC-20 as we send that out as fees..
          const second = actions[2];

          expect(second).to.deep.equal({
            type: "approval",
            token: testErc20.address,
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: second.transactionMethods,
            operator: seaport.contract.address,
          });

          await second.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              fulfiller.address,
              seaport.contract.address
            )
          ).to.eq(MAX_INT);

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(BigNumber.from(4));
          expect(offererSecondErc1155Balance).eq(BigNumber.from(2));
          expect(fulfillerErc1155Balance).eq(BigNumber.from(6));
          expect(fulfillerSecondErc1155Balance).eq(BigNumber.from(3));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            orderStatus,
            unitsToFill: 2,
            fulfillerAddress: fulfiller.address,
            multicallProvider,
            fulfillReceipt: receipt,
          });

          // Double check nft balances
          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });
    });
  }
);
