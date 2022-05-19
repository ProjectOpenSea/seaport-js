import { providers } from "@0xsequence/multicall";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import sinon from "sinon";
import { ItemType, MAX_INT } from "../constants";
import { TestERC1155, TestERC721 } from "../typechain";
import { ApprovalAction, CreateOrderAction, CreateOrderInput } from "../types";
import * as fulfill from "../utils/fulfill";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to swap any numbers of items",
  (fixture) => {
    let offerer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let multicallProvider: providers.MulticallProvider;

    let fulfillStandardOrderSpy: sinon.SinonSpy;
    let secondTestErc721: TestERC721;
    let secondTestErc1155: TestERC1155;
    let standardCreateOrderInput: CreateOrderInput;

    const nftId = "1";
    const nftId2 = "2";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();
      multicallProvider = new providers.MulticallProvider(ethers.provider);

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      const TestERC721 = await ethers.getContractFactory("TestERC721");
      secondTestErc721 = await TestERC721.deploy();
      await secondTestErc721.deployed();

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.deployed();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("Swapping ERC721s for ERC721s", async () => {
      beforeEach(async () => {
        const { testErc721 } = fixture;

        // Mint 2 NFTs to offerer
        await testErc721.mint(offerer.address, nftId);
        await testErc721.mint(offerer.address, nftId2);
        // Mint 1 NFT to fulfiller
        await secondTestErc721.mint(fulfiller.address, nftId);

        standardCreateOrderInput = {
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId,
            },
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId2,
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: secondTestErc721.address,
              identifier: nftId,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("2 ERC721s <=> ERC721", async () => {
        const { seaport, testErc721 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        expect(createActions.length).to.eq(2);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: testErc721.address,
          identifierOrCriteria: nftId2,
          itemType: ItemType.ERC721,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await createApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[1] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        expect(actions.length).to.eq(2);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: secondTestErc721.address,
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transactionMethods: approvalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await approvalAction.transactionMethods.transact();

        expect(
          await secondTestErc721.isApprovedForAll(
            fulfiller.address,
            seaport.contract.address
          )
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
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
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
            (owner) => owner === fulfiller.address
          )
        ).to.be.true;
        expect(offererOwned).to.eq(offerer.address);

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });
    describe("Swapping ERC1155s for ERC1155s", async () => {
      beforeEach(async () => {
        const { testErc1155 } = fixture;

        // Mint 2 NFTs to offerer
        await testErc1155.mint(offerer.address, nftId, erc1155Amount);
        await testErc1155.mint(offerer.address, nftId2, erc1155Amount);
        // Mint 1 NFT to fulfiller
        await secondTestErc1155.mint(fulfiller.address, nftId, erc1155Amount);

        standardCreateOrderInput = {
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              identifier: nftId,
              amount: erc1155Amount,
            },
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              identifier: nftId2,
              amount: erc1155Amount,
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC1155,
              token: secondTestErc1155.address,
              identifier: nftId,
              amount: erc1155Amount,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("2 ERC1155s <=> ERC1155", async () => {
        const { seaport, testErc1155 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        expect(createActions.length).to.eq(2);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: testErc1155.address,
          identifierOrCriteria: nftId2,
          itemType: ItemType.ERC1155,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await createApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[1] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        expect(actions.length).to.eq(2);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: secondTestErc1155.address,
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC1155,
          transactionMethods: approvalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await approvalAction.transactionMethods.transact();

        expect(
          await secondTestErc1155.isApprovedForAll(
            fulfiller.address,
            seaport.contract.address
          )
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
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
        });

        // Double check nft balances
        const [
          fulfillerOwnedAmount,
          fulfillerOwnedAmount2,
          offererOwnedAmount,
        ] = await Promise.all([
          testErc1155.balanceOf(fulfiller.address, nftId),
          testErc1155.balanceOf(fulfiller.address, nftId2),
          secondTestErc1155.balanceOf(offerer.address, nftId),
        ]);

        expect(
          [fulfillerOwnedAmount, fulfillerOwnedAmount2].every((balance) =>
            balance.eq(erc1155Amount)
          )
        ).to.be.true;
        expect(offererOwnedAmount).to.eq(erc1155Amount);

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });
    describe("Swapping ERC721 + WETH for ERC721 + WETH", async () => {
      beforeEach(async () => {
        const { testErc721, testErc20 } = fixture;

        // Mint 1 NFTs to offerer
        await testErc721.mint(offerer.address, nftId);
        await testErc20.mint(offerer.address, parseEther("10").toString());

        // Mint 1 NFT to fulfiller
        await testErc721.mint(fulfiller.address, nftId2);
        await testErc20.mint(fulfiller.address, parseEther("5").toString());

        standardCreateOrderInput = {
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId,
            },
            {
              token: testErc20.address,
              amount: parseEther("10").toString(),
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId2,
            },
            {
              token: testErc20.address,
              amount: parseEther("5").toString(),
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        };
      });

      it("ERC721 + WETH <=> ERC721 + WETH", async () => {
        const { seaport, testErc20, testErc721 } = fixture;

        const { actions: createActions } = await seaport.createOrder(
          standardCreateOrderInput
        );

        expect(createActions.length).to.eq(3);

        const createApprovalAction = createActions[0] as ApprovalAction;

        expect(createApprovalAction).to.deep.equal({
          type: "approval",
          token: testErc721.address,
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          transactionMethods: createApprovalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await createApprovalAction.transactionMethods.transact();

        const createErc20ApprovalAction = createActions[1] as ApprovalAction;

        expect(createErc20ApprovalAction).to.deep.equal({
          type: "approval",
          token: testErc20.address,
          identifierOrCriteria: "0",
          itemType: ItemType.ERC20,
          transactionMethods: createErc20ApprovalAction.transactionMethods,
          operator: seaport.contract.address,
        });

        await createErc20ApprovalAction.transactionMethods.transact();

        const createOrderAction = createActions[2] as CreateOrderAction;

        const order = await createOrderAction.createOrder();

        const ownerToTokenToIdentifierBalances =
          await getBalancesForFulfillOrder(
            order,
            fulfiller.address,
            multicallProvider
          );

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: fulfiller.address,
        });

        expect(actions.length).to.eq(3);

        const approvalAction = actions[0];

        expect(approvalAction).to.deep.equal({
          type: "approval",
          token: testErc721.address,
          identifierOrCriteria: nftId2,
          itemType: ItemType.ERC721,
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
          await testErc20.allowance(fulfiller.address, seaport.contract.address)
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
          fulfillerAddress: fulfiller.address,
          multicallProvider,
          fulfillReceipt: receipt,
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
          testErc20.balanceOf(fulfiller.address),
          testErc721.ownerOf(nftId2),
          testErc20.balanceOf(offerer.address),
          testErc20.balanceOf(zone.address),
        ]);

        expect(fulfillerOwned).to.eq(fulfiller.address);
        // 2.5% fees were subtracted
        expect(fulfillerOwnedErc20Amount).to.eq(parseEther("9.75"));

        expect(offererOwned).to.eq(offerer.address);

        expect(offererOwnedErc20Amount).to.eq(parseEther("4.875"));

        expect(zoneOwnedErc20Amount).to.eq(parseEther(".375"));

        expect(fulfillStandardOrderSpy).calledOnce;
      });
    });
  }
);
