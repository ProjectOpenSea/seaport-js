import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, MAX_INT, OrderType } from "../constants";
import { CreateOrderInput, CurrencyItem } from "../types";
import * as fulfill from "../utils/fulfill";
import { generateRandomSalt } from "../utils/order";
import { getTagFromDomain } from "../utils/usecase";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

const SECONDS_IN_WEEK = 604800;

describeWithFixture("As a user I want to create a dutch auction", (fixture) => {
  let offerer: SignerWithAddress;
  let zone: SignerWithAddress;
  let fulfiller: SignerWithAddress;
  let multicallProvider: providers.MulticallProvider;

  let fulfillStandardOrderSpy: sinon.SinonSpy;
  let standardCreateOrderInput: CreateOrderInput;
  let startTime: string;
  let endTime: string;

  const nftId = "1";
  const erc1155Amount = "5";

  const GEM_DOMAIN = "gem.xyz";

  beforeEach(async () => {
    [offerer, zone, fulfiller] = await ethers.getSigners();
    multicallProvider = new providers.MulticallProvider(ethers.provider);

    fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");
  });

  afterEach(() => {
    fulfillStandardOrderSpy.restore();
  });

  describe("A single ERC721 is to be transferred", async () => {
    describe("Ascending dutch auction", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint ERC721 to offerer
        await testErc721.mint(offerer.address, nftId);

        startTime = await (
          await ethers.provider.getBlock("latest")
        ).timestamp.toString();

        // Ends one week from the start date
        endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
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
              endAmount: parseEther("20").toString(),
              recipient: offerer.address,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("ERC721 <=> ETH", async () => {
        const { seaport } = fixture;

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
        });

        expect(actions.length).to.eq(1);

        const action = actions[0];

        expect(action).to.deep.equal({
          type: "exchange",
          transactionMethods: action.transactionMethods,
        });

        const transaction = await action.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy).calledOnce;
      });

      it("ERC721 <=> ERC20", async () => {
        const { seaport, testErc20 } = fixture;

        // Use ERC20 instead of eth
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token: testErc20.address,
          })),
        };

        await testErc20.mint(
          fulfiller.address,
          BigNumber.from(
            (standardCreateOrderInput.consideration[0] as CurrencyItem)
              .endAmount
          )
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
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
          await testErc20.allowance(fulfiller.address, seaport.contract.address)
        ).to.equal(MAX_INT);

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });

    describe("Descending dutch auction", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint 10 ERC1155s to offerer
        await testErc721.mint(offerer.address, nftId);

        startTime = await (
          await ethers.provider.getBlock("latest")
        ).timestamp.toString();

        // Ends one week from the start date
        endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
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
              amount: parseEther("20").toString(),
              endAmount: parseEther("10").toString(),
              recipient: offerer.address,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("ERC721 <=> ETH", async () => {
        const { seaport } = fixture;

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
        });

        expect(actions.length).to.eq(1);

        const action = actions[0];

        expect(action).to.deep.equal({
          type: "exchange",
          transactionMethods: action.transactionMethods,
        });

        const transaction = await action.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy).calledOnce;
      });

      it("ERC721 <=> ERC20", async () => {
        const { seaport, testErc20 } = fixture;

        // Use ERC20 instead of eth
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token: testErc20.address,
          })),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
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
          await testErc20.allowance(fulfiller.address, seaport.contract.address)
        ).to.equal(MAX_INT);

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });
  });

  describe("Multiple ERC1155s are to be transferred", async () => {
    describe("Ascending dutch auction", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 5 ERC1155s to offerer
        await testErc1155.mint(offerer.address, nftId, erc1155Amount);

        startTime = await (
          await ethers.provider.getBlock("latest")
        ).timestamp.toString();

        // Ends one week from the start date
        endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              amount: "1",
              endAmount: "5",
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              endAmount: parseEther("20").toString(),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
        });

        expect(actions.length).to.eq(1);

        const action = actions[0];

        expect(action).to.deep.equal({
          type: "exchange",
          transactionMethods: action.transactionMethods,
        });

        const transaction = await action.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        // Double check nft balances
        const [offererErc1155Balance, fulfillerErc1155Balance] =
          await Promise.all([
            testErc1155.balanceOf(offerer.address, nftId),
            testErc1155.balanceOf(fulfiller.address, nftId),
          ]);

        expect(offererErc1155Balance).eq(BigNumber.from(2));
        expect(fulfillerErc1155Balance).eq(BigNumber.from(3));

        expect(fulfillStandardOrderSpy).calledOnce;
      });

      it("ERC1155 <=> ERC20", async () => {
        const { seaport, testErc20, testErc1155 } = fixture;

        // Use ERC20 instead of eth
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token: testErc20.address,
          })),
        };

        await testErc20.mint(
          fulfiller.address,
          BigNumber.from(
            (standardCreateOrderInput.consideration[0] as CurrencyItem)
              .endAmount
          )
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
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
          await testErc20.allowance(fulfiller.address, seaport.contract.address)
        ).to.equal(MAX_INT);

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        // Double check nft balances
        const [offererErc1155Balance, fulfillerErc1155Balance] =
          await Promise.all([
            testErc1155.balanceOf(offerer.address, nftId),
            testErc1155.balanceOf(fulfiller.address, nftId),
          ]);

        expect(offererErc1155Balance).eq(BigNumber.from(2));
        expect(fulfillerErc1155Balance).eq(BigNumber.from(3));

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });

    describe("Descending dutch auction", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 5 ERC1155s to offerer
        await testErc1155.mint(offerer.address, nftId, erc1155Amount);

        startTime = await (
          await ethers.provider.getBlock("latest")
        ).timestamp.toString();

        // Ends one week from the start date
        endTime = BigNumber.from(startTime).add(SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              amount: "5",
              endAmount: "1",
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("20").toString(),
              endAmount: parseEther("10").toString(),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
        });

        expect(actions.length).to.eq(1);

        const action = actions[0];

        expect(action).to.deep.equal({
          type: "exchange",
          transactionMethods: action.transactionMethods,
        });

        const transaction = await action.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        // Double check nft balances
        const [offererErc1155Balance, fulfillerErc1155Balance] =
          await Promise.all([
            testErc1155.balanceOf(offerer.address, nftId),
            testErc1155.balanceOf(fulfiller.address, nftId),
          ]);

        expect(offererErc1155Balance).eq(BigNumber.from(3));
        expect(fulfillerErc1155Balance).eq(BigNumber.from(2));

        expect(fulfillStandardOrderSpy).calledOnce;
      });

      it("ERC1155 <=> ERC20", async () => {
        const { seaport, testErc20, testErc1155 } = fixture;

        // Use ERC20 instead of eth
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token: testErc20.address,
          })),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = BigNumber.from(startTime)
          .add(endTime)
          .div(2)
          .toNumber();

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
          domain: GEM_DOMAIN,
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
          await testErc20.allowance(fulfiller.address, seaport.contract.address)
        ).to.equal(MAX_INT);

        const fulfillAction = actions[1];

        expect(fulfillAction).to.be.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = await (
          await ethers.provider.getBlock(receipt.blockNumber)
        ).timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        // Double check nft balances
        const [offererErc1155Balance, fulfillerErc1155Balance] =
          await Promise.all([
            testErc1155.balanceOf(offerer.address, nftId),
            testErc1155.balanceOf(fulfiller.address, nftId),
          ]);

        expect(offererErc1155Balance).eq(BigNumber.from(3));
        expect(fulfillerErc1155Balance).eq(BigNumber.from(2));

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });
  });
});
