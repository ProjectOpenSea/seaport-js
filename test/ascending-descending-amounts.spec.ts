import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, OrderType } from "../src/constants";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import { generateRandomSalt } from "../src/utils/order";
import { getTagFromDomain } from "../src/utils/usecase";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";
import { SinonSpy } from "sinon";

const sinon = require("sinon");

const SECONDS_IN_WEEK = 604800;

describeWithFixture("As a user I want to create a dutch auction", (fixture) => {
  let offerer: Signer;
  let zone: Signer;
  let fulfiller: Signer;

  let fulfillStandardOrderSpy: SinonSpy;
  let standardCreateOrderInput: CreateOrderInput;
  let startTime: string;
  let endTime: string;

  const nftId = "1";
  const erc1155Amount = "5";

  const GEM_DOMAIN = "gem.xyz";

  beforeEach(async () => {
    [offerer, zone, fulfiller] = await ethers.getSigners();

    fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");
  });

  afterEach(() => {
    fulfillStandardOrderSpy.restore();
  });

  describe("A single ERC721 is to be transferred", () => {
    describe("Ascending dutch auction", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint ERC721 to offerer
        await testErc721.mint(await offerer.getAddress(), nftId);

        startTime = (await ethers.provider.getBlock(
          "latest",
        ))!.timestamp.toString();

        // Ends one week from the start date
        endTime = (BigInt(startTime) + BigInt(SECONDS_IN_WEEK)).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
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
              endAmount: parseEther("20").toString(),
              recipient: await offerer.getAddress(),
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        };
      });

      it("ERC721 <=> ETH", async () => {
        const { seaport } = fixture;

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
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

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy.calledOnce);
      });

      it("ERC721 <=> ERC20", async () => {
        const { seaport, testErc20 } = fixture;

        // Use ERC20 instead of eth
        const token = await testErc20.getAddress();
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token,
          })),
        };

        await testErc20.mint(
          await fulfiller.getAddress(),
          (standardCreateOrderInput.consideration[0] as CurrencyItem)
            .endAmount as string,
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
          domain: GEM_DOMAIN,
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

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });

    describe("Descending dutch auction", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint 10 ERC1155s to offerer
        await testErc721.mint(await offerer.getAddress(), nftId);

        startTime = (await ethers.provider.getBlock(
          "latest",
        ))!.timestamp.toString();

        // Ends one week from the start date
        endTime = (Number(startTime) + SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("20").toString(),
              endAmount: parseEther("10").toString(),
              recipient: await offerer.getAddress(),
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        };
      });

      it("ERC721 <=> ETH", async () => {
        const { seaport } = fixture;

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
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

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy.calledOnce);
      });

      it("ERC721 <=> ERC20", async () => {
        const { seaport, testErc20 } = fixture;

        // Use ERC20 instead of eth
        const token = await testErc20.getAddress();
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token,
          })),
        };

        await testErc20.mint(
          await fulfiller.getAddress(),
          (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
          domain: GEM_DOMAIN,
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

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
          timeBasedItemParams: {
            startTime,
            endTime,
            currentBlockTimestamp,
            ascendingAmountTimestampBuffer: 0,
          },
        });

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });
  });

  describe("Multiple ERC1155s are to be transferred", () => {
    describe("Ascending dutch auction", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 5 ERC1155s to offerer
        await testErc1155.mint(
          await offerer.getAddress(),
          nftId,
          erc1155Amount,
        );

        startTime = (await ethers.provider.getBlock(
          "latest",
        ))!.timestamp.toString();

        // Ends one week from the start date
        endTime = (Number(startTime) + SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              amount: "1",
              endAmount: "5",
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              endAmount: parseEther("20").toString(),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
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

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
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
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

        expect(offererErc1155Balance).eq(2n);
        expect(fulfillerErc1155Balance).eq(3n);

        expect(fulfillStandardOrderSpy.calledOnce);
      });

      it("ERC1155 <=> ERC20", async () => {
        const { seaport, testErc20, testErc1155 } = fixture;

        // Use ERC20 instead of eth
        const token = await testErc20.getAddress();
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token,
          })),
        };

        await testErc20.mint(
          await fulfiller.getAddress(),
          (standardCreateOrderInput.consideration[0] as CurrencyItem)
            .endAmount as string,
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
          domain: GEM_DOMAIN,
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

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
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
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

        expect(offererErc1155Balance).eq(2n);
        expect(fulfillerErc1155Balance).eq(3n);

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });

    describe("Descending dutch auction", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 5 ERC1155s to offerer
        await testErc1155.mint(
          await offerer.getAddress(),
          nftId,
          erc1155Amount,
        );

        startTime = (await ethers.provider.getBlock(
          "latest",
        ))!.timestamp.toString();

        // Ends one week from the start date
        endTime = (Number(startTime) + SECONDS_IN_WEEK).toString();

        standardCreateOrderInput = {
          startTime,
          endTime,
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              amount: "5",
              endAmount: "1",
              identifier: nftId,
            },
          ],
          consideration: [
            {
              amount: parseEther("20").toString(),
              endAmount: parseEther("10").toString(),
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

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
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

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
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
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

        expect(offererErc1155Balance).eq(3n);
        expect(fulfillerErc1155Balance).eq(2n);

        expect(fulfillStandardOrderSpy.calledOnce);
      });

      it("ERC1155 <=> ERC20", async () => {
        const { seaport, testErc20, testErc1155 } = fixture;

        // Use ERC20 instead of eth
        const token = await testErc20.getAddress();
        standardCreateOrderInput = {
          ...standardCreateOrderInput,
          consideration: standardCreateOrderInput.consideration.map((item) => ({
            ...item,
            token,
          })),
        };

        await testErc20.mint(
          await fulfiller.getAddress(),
          (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
        );

        const { executeAllActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        const order = await executeAllActions();

        expect(order.parameters.orderType).eq(OrderType.FULL_OPEN);

        const nextBlockTimestamp = (Number(startTime) + Number(endTime)) / 2;

        // Set the next block to be the halfway point between startTime and endTime
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          nextBlockTimestamp,
        ]);
        await ethers.provider.send("evm_mine", []);

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(order, await fulfiller.getAddress());

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
          domain: GEM_DOMAIN,
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

        const transaction = await fulfillAction.transactionMethods.transact();

        expect(transaction.data.slice(-8)).to.eq(getTagFromDomain(GEM_DOMAIN));

        const receipt = await transaction.wait();

        const currentBlockTimestamp = (await ethers.provider.getBlock(
          receipt!.blockNumber,
        ))!.timestamp;

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),

          fulfillReceipt: receipt!,
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
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

        expect(offererErc1155Balance).eq(3n);
        expect(fulfillerErc1155Balance).eq(2n);

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });
  });
});
