import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { TestERC1155, TestERC721 } from "../src/typechain-types";
import {
  ApprovalAction,
  CreateOrderAction,
  CreateOrderInput,
} from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";
import { SinonSpy } from "sinon";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to swap any numbers of items",
  (fixture) => {
    let offerer: Signer;
    let zone: Signer;
    let fulfiller: Signer;

    let fulfillStandardOrderSpy: SinonSpy;
    let secondTestErc721: TestERC721;
    let secondTestErc1155: TestERC1155;
    let standardCreateOrderInput: CreateOrderInput;

    const nftId = "1";
    const nftId2 = "2";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      const TestERC721 = await ethers.getContractFactory("TestERC721");
      secondTestErc721 = await TestERC721.deploy();
      await secondTestErc721.waitForDeployment();

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.waitForDeployment();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("Swapping ERC721s for ERC721s", () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint 2 NFTs to offerer
        await testErc721.mint(await offerer.getAddress(), nftId);
        await testErc721.mint(await offerer.getAddress(), nftId2);
        // Mint 1 NFT to fulfiller
        await secondTestErc721.mint(await fulfiller.getAddress(), nftId);

        standardCreateOrderInput = {
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId2,
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: await secondTestErc721.getAddress(),
              identifier: nftId,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        };
      });

      it("2 ERC721s <=> ERC721", async () => {
        const { seaport, testErc721 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        expect(createActions.length).to.eq(2);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: await testErc721.getAddress(),
          identifierOrCriteria: nftId2,
          itemType: ItemType.ERC721,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await createApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[1] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            await fulfiller.getAddress(),
            ethers.provider,
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
        });

        expect(actions.length).to.eq(2);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: await secondTestErc721.getAddress(),
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transactionMethods: approvalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await approvalAction.transactionMethods.transact();

        expect(
          await secondTestErc721.isApprovedForAll(
            await fulfiller.getAddress(),
            await seaport.contract.getAddress(),
          ),
        ).to.be.true;

        const fulfillAction = actions[1];

        expect(fulfillAction).to.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();
        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),
          provider: ethers.provider,
          fulfillReceipt: receipt!,
        });

        // Double check nft balances
        const [fulfillerOwned, fulfillerOwned2, offererOwned] =
          await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ]);

        expect(
          [fulfillerOwned, fulfillerOwned2].every(
            async (owner) => owner === (await fulfiller.getAddress()),
          ),
        ).to.be.true;
        expect(offererOwned).to.eq(await offerer.getAddress());

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });
    describe("Swapping ERC1155s for ERC1155s", () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 2 NFTs to offerer
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
        // Mint 1 NFT to fulfiller
        await secondTestErc1155.mint(
          await fulfiller.getAddress(),
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
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              identifier: nftId2,
              amount: erc1155Amount,
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC1155,
              token: await secondTestErc1155.getAddress(),
              identifier: nftId,
              amount: erc1155Amount,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        };
      });

      it("2 ERC1155s <=> ERC1155", async () => {
        const { seaport, testErc1155 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        expect(createActions.length).to.eq(2);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: await testErc1155.getAddress(),
          identifierOrCriteria: nftId2,
          itemType: ItemType.ERC1155,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await createApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[1] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            await fulfiller.getAddress(),
            ethers.provider,
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
        });

        expect(actions.length).to.eq(2);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: await secondTestErc1155.getAddress(),
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC1155,
          transactionMethods: approvalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await approvalAction.transactionMethods.transact();

        expect(
          await secondTestErc1155.isApprovedForAll(
            await fulfiller.getAddress(),
            await seaport.contract.getAddress(),
          ),
        ).to.be.true;

        const fulfillAction = actions[1];

        expect(fulfillAction).to.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();
        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),
          provider: ethers.provider,
          fulfillReceipt: receipt!,
        });

        // Double check nft balances
        const [
          fulfillerOwnedAmount,
          fulfillerOwnedAmount2,
          offererOwnedAmount,
        ] = await Promise.all([
          testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          testErc1155.balanceOf(await fulfiller.getAddress(), nftId2),
          secondTestErc1155.balanceOf(await offerer.getAddress(), nftId),
        ]);

        expect(
          [fulfillerOwnedAmount, fulfillerOwnedAmount2].every(
            (balance) => balance === BigInt(erc1155Amount),
          ),
        ).to.be.true;
        expect(offererOwnedAmount).to.eq(erc1155Amount);

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });
    describe("Swapping ERC721 + WETH for ERC721 + WETH", () => {
      beforeEach(async () => {
        const { testErc721, testErc20 } = fixture;

        // Mint 1 NFTs to offerer
        await testErc721.mint(await offerer.getAddress(), nftId);
        await testErc20.mint(
          await offerer.getAddress(),
          parseEther("10").toString(),
        );

        // Mint 1 NFT to fulfiller
        await testErc721.mint(await fulfiller.getAddress(), nftId2);
        await testErc20.mint(
          await fulfiller.getAddress(),
          parseEther("5").toString(),
        );

        standardCreateOrderInput = {
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
            {
              token: await testErc20.getAddress(),
              amount: parseEther("10").toString(),
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId2,
            },
            {
              token: await testErc20.getAddress(),
              amount: parseEther("5").toString(),
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        };
      });

      it("ERC721 + WETH <=> ERC721 + WETH", async () => {
        const { seaport, testErc20, testErc721 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput,
        );

        expect(createActions.length).to.eq(3);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: await testErc721.getAddress(),
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await createApprovalAction.transactionMethods.transact();

        const createErc20ApprovalAction = createActions[1] as ApprovalAction;

        expect(createErc20ApprovalAction).to.deep.equal({
          type: "approval",
          token: await testErc20.getAddress(),
          identifierOrCriteria: "0",
          itemType: ItemType.ERC20,
          transactionMethods: createErc20ApprovalAction.transactionMethods,
          operator: await seaport.contract.getAddress(),
        });

        await createErc20ApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[2] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            await fulfiller.getAddress(),
            ethers.provider,
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
        });

        expect(actions.length).to.eq(3);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: await testErc721.getAddress(),
          identifierOrCriteria: nftId2,
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

        expect(fulfillAction).to.deep.equal({
          type: "exchange",
          transactionMethods: fulfillAction.transactionMethods,
        });

        const transaction = await fulfillAction.transactionMethods.transact();
        const receipt = await transaction.wait();

        await verifyBalancesAfterFulfill({
          ownerToTokenToIdentifierBalances,
          order,
          fulfillerAddress: await fulfiller.getAddress(),
          provider: ethers.provider,
          fulfillReceipt: receipt!,
        });

        // Double check nft balances
        const [
          fulfillerOwned,
          fulfillerOwnedErc20Amount,
          offererOwned,
          offererOwnedErc20Amount,
          zoneOwnedErc20Amount,
        ] = await Promise.all([
          testErc721.ownerOf(nftId),
          testErc20.balanceOf(await fulfiller.getAddress()),
          testErc721.ownerOf(nftId2),
          testErc20.balanceOf(await offerer.getAddress()),
          testErc20.balanceOf(await zone.getAddress()),
        ]);

        expect(fulfillerOwned).to.eq(await fulfiller.getAddress());
        // 2.5% fees were subtracted
        expect(fulfillerOwnedErc20Amount).to.eq(parseEther("9.75"));

        expect(offererOwned).to.eq(await offerer.getAddress());

        expect(offererOwnedErc20Amount).to.eq(parseEther("4.875"));

        expect(zoneOwnedErc20Amount).to.eq(parseEther(".375"));

        expect(fulfillStandardOrderSpy.calledOnce);
      });
    });
  },
);
