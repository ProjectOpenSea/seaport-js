import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { TestERC1155, TestERC721 } from "../src/typechain-types";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { getTagFromDomain } from "../src/utils/usecase";
import { describeWithFixture } from "./utils/setup";
import { SinonSpy } from "sinon";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy now or accept an offer for a bundle of items",
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

    const ENS_VISION_DOMAIN = "ens.vision";

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

    describe("A bundle of ERC721s is to be transferred", () => {
      describe("[Buy now] I want to buy a bundle of ERC721s", () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          // Mint 3 NFTs to offerer
          await testErc721.mint(await offerer.getAddress(), nftId);
          await testErc721.mint(await offerer.getAddress(), nftId2);
          await secondTestErc721.mint(await offerer.getAddress(), nftId);

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
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
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

        it("ERC721 <=> ETH", async () => {
          const { seaport, testErc721 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const transaction = await action.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ]);

          expect(
            owners.every(
              async (owner) => owner === (await fulfiller.getAddress()),
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC721 <=> ERC20", async () => {
          const { seaport, testErc20, testErc721 } = fixture;

          // Use ERC20 instead of eth
          standardCreateOrderInput = {
            ...standardCreateOrderInput,
            consideration: standardCreateOrderInput.consideration.map(
              async (item) => ({
                ...item,
                token: await testErc20.getAddress(),
              }),
            ),
          };

          await testErc20.mint(
            await fulfiller.getAddress(),
            (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
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
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ]);

          expect(
            owners.every(
              async (owner) => owner === (await fulfiller.getAddress()),
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("[Accept offer] I want to accept an offer for my bundle of ERC721s", () => {
        beforeEach(async () => {
          const { testErc20, testErc721 } = fixture;

          // Mint 3 NFTs to fulfiller
          await testErc721.mint(await fulfiller.getAddress(), nftId);
          await testErc721.mint(await fulfiller.getAddress(), nftId2);
          await secondTestErc721.mint(await fulfiller.getAddress(), nftId);

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
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifier: nftId2,
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC721", async () => {
          const { seaport, testErc721, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
            await offerer.getAddress(),
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
          });

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
            token: await secondTestErc721.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await secondApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc721.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true;

          // We also need to approve ERC-20 as we send that out as fees..
          const thirdApprovalAction = actions[2];

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await thirdApprovalAction.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ]);

          expect(
            owners.every(
              async (owner) => owner === (await offerer.getAddress()),
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });

    describe("A bundle of ERC721s and ERC1155s is to be transferred", () => {
      describe("[Buy now] I want to buy a bundle of ERC721s and ERC1155s", () => {
        beforeEach(async () => {
          const { testErc721, testErc1155 } = fixture;

          // Mint 3 NFTs to offerer
          await testErc721.mint(await offerer.getAddress(), nftId);
          await secondTestErc721.mint(await offerer.getAddress(), nftId);
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId,
            erc1155Amount,
          );

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifier: nftId,
              },
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
                identifier: nftId,
              },
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

        it("ERC721 + ERC1155 <=> ETH", async () => {
          const { seaport, testErc721, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action.type).eq("exchange");

          const transaction = await action.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            secondTestErc721.ownerOf(nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

          expect(
            owners.every(
              async (ownerOrBalance) =>
                ownerOrBalance === (await fulfiller.getAddress()) ||
                BigInt(erc1155Amount) === ownerOrBalance,
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC721 + ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20, testErc721, testErc1155 } = fixture;

          // Use ERC20 instead of eth
          standardCreateOrderInput = {
            ...standardCreateOrderInput,
            consideration: standardCreateOrderInput.consideration.map(
              async (item) => ({
                ...item,
                token: await testErc20.getAddress(),
              }),
            ),
          };

          await testErc20.mint(
            await fulfiller.getAddress(),
            (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
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
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            secondTestErc721.ownerOf(nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

          expect(
            owners.every(
              async (ownerOrBalance) =>
                ownerOrBalance === (await fulfiller.getAddress()) ||
                BigInt(erc1155Amount) === ownerOrBalance,
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("[Accept offer] I want to accept an offer for my bundle of ERC721s and ERC1155s", () => {
        beforeEach(async () => {
          const { testErc20, testErc721, testErc1155 } = fixture;

          // Mint 3 NFTs to fulfiller
          await testErc721.mint(await fulfiller.getAddress(), nftId);
          await secondTestErc721.mint(await fulfiller.getAddress(), nftId);
          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
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
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifier: nftId,
                amount: erc1155Amount,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC721 + ERC1155", async () => {
          const { seaport, testErc721, testErc1155, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
            await offerer.getAddress(),
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
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

          const secondApprovalAction = actions[1];

          expect(secondApprovalAction).to.deep.equal({
            type: "approval",
            token: await secondTestErc721.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await secondApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc721.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true;

          const thirdApprovalAction = actions[2];

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc1155.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await thirdApprovalAction.transactionMethods.transact();

          expect(
            await testErc1155.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true;

          // We also need to approve ERC-20 as we send that out as fees..
          const fourthApprovalAction = actions[3];

          expect(fourthApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: fourthApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await fourthApprovalAction.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[4];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            secondTestErc721.ownerOf(nftId),
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
          ]);

          expect(
            owners.every(
              async (ownerOrBalance) =>
                ownerOrBalance === (await offerer.getAddress()) ||
                BigInt(erc1155Amount) === ownerOrBalance,
            ),
          ).to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });

    describe("A bundle of ERC1155s is to be transferred", () => {
      describe("[Buy now] I want to buy a bundle of ERC1155s", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 3 NFTs to offerer
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
          await secondTestErc1155.mint(
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
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifier: nftId2,
                amount: erc1155Amount,
              },
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
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

        it("ERC1155 <=> ETH", async () => {
          const { seaport, testErc1155 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action.type).eq("exchange");

          const transaction = await action.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId2),
            secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

          expect(owners.every((balance) => BigInt(erc1155Amount) === balance))
            .to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20, testErc1155 } = fixture;

          // Use ERC20 instead of eth
          standardCreateOrderInput = {
            ...standardCreateOrderInput,
            consideration: standardCreateOrderInput.consideration.map(
              async (item) => ({
                ...item,
                token: await testErc20.getAddress(),
              }),
            ),
          };

          await testErc20.mint(
            await fulfiller.getAddress(),
            (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
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
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            testErc1155.balanceOf(await fulfiller.getAddress(), nftId2),
            secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
          ]);

          expect(owners.every((balance) => BigInt(erc1155Amount) === balance))
            .to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("[Accept offer] I want to accept an offer for my bundle of ERC1155s", () => {
        beforeEach(async () => {
          const { testErc20, testErc1155 } = fixture;

          // Mint 3 NFTs to fulfiller
          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
          );
          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId2,
            erc1155Amount,
          );
          await secondTestErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
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
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifier: nftId,
                amount: erc1155Amount,
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifier: nftId2,
                amount: erc1155Amount,
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                identifier: nftId,
                amount: erc1155Amount,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155", async () => {
          const { seaport, testErc1155, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
            await offerer.getAddress(),
          );

          const order = await executeAllActions();

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
              ethers.provider,
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            accountAddress: await fulfiller.getAddress(),
            domain: ENS_VISION_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc1155.getAddress(),
            identifierOrCriteria: nftId2,
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

          const secondApprovalAction = actions[1];

          expect(secondApprovalAction).to.deep.equal({
            type: "approval",
            token: await secondTestErc1155.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await secondApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc1155.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true;

          // We also need to approve ERC-20 as we send that out as fees..
          const thirdApprovalAction = actions[2];

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await thirdApprovalAction.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.eq(
            getTagFromDomain(ENS_VISION_DOMAIN),
          );

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            fulfillerAddress: await fulfiller.getAddress(),
            provider: ethers.provider,
            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          const owners = await Promise.all([
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            testErc1155.balanceOf(await offerer.getAddress(), nftId2),
            secondTestErc1155.balanceOf(await offerer.getAddress(), nftId),
          ]);

          expect(owners.every((balance) => BigInt(erc1155Amount) === balance))
            .to.be.true;

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });
  },
);
