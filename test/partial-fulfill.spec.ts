import { HardhatEthersSigner } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseEther, parseUnits } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, OrderType } from "../src/constants";
import { TestERC1155 } from "../src/typechain-types";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import {
  getBalancesForFulfillOrder,
  verifyBalancesAfterFulfill,
} from "./utils/balance";
import { describeWithFixture } from "./utils/setup";
import { OPENSEA_DOMAIN, OPENSEA_DOMAIN_TAG } from "./utils/constants";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy now or accept an offer partially",
  (fixture) => {
    let offerer: HardhatEthersSigner;
    let zone: HardhatEthersSigner;
    let fulfiller: HardhatEthersSigner;

    let fulfillStandardOrderSpy: sinon.SinonSpy; // eslint-disable-line no-undef
    let standardCreateOrderInput: CreateOrderInput;
    let secondTestErc1155: TestERC1155;

    const nftId = "1";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.deployed();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
    });

    describe("An ERC1155 is partially transferred", () => {
      describe("[Buy now] I want to partially buy an ERC1155", () => {
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
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });

        it("ERC1155 <=> ETH doesn't fail due to rounding error", async () => {
          const { seaport, testErc1155 } = fixture;

          // broke out key params to make testing different values easier:
          const unitsForSale = "3";
          // a unit sale price with a precision up to 12 decimals seems to work in combination with *any* fee (for tokens with 18 decimals).
          // if *no* fees are involved, 18 decimals may work fine. in-between your mileage may vary, depending on the value of `basisPoints`.
          const pricePerUnit = "3.1415926535897";
          const basisPoints = 247;

          // maker creates partially fillable listing with amount of 3
          standardCreateOrderInput.offer = [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              amount: unitsForSale,
              identifier: nftId,
            },
          ];

          // calculate total price (price per unit * units for sale) and fees
          standardCreateOrderInput.consideration = [
            {
              amount: (
                parseEther(pricePerUnit) * BigInt(unitsForSale)
              ).toString(),
              recipient: offerer.address,
            },
          ];
          standardCreateOrderInput.fees = [
            { recipient: zone.address, basisPoints },
          ];

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          // taker tries to buy 2 of the items
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
          await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);
        });

        it("ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20, testErc1155 } = fixture;

          // Use ERC20 instead of eth
          standardCreateOrderInput = {
            ...standardCreateOrderInput,
            consideration: standardCreateOrderInput.consideration.map(
              (item) => ({ ...item, token: testErc20.address }),
            ),
          };

          await testErc20.mint(
            fulfiller.address,
            (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
              seaport.contract.address,
            ),
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });

        it("ERC1155 <=> ERC20 (6 decimals) doesn't fail due to rounding error", async () => {
          const { seaport, testErc20USDC, testErc1155 } = fixture;

          // broke out key params to make testing different values easier:
          const unitsForSale = "3";
          // for tokens with 6 decimals, the unit sale price needs to be restricted to a precision of up to two decimals only (!),
          // to ensure broader compatibility with fees.
          const pricePerUnit = "5.17";
          const basisPoints = 243;

          // maker creates partially fillable listing with amount of 3
          standardCreateOrderInput.offer = [
            {
              itemType: ItemType.ERC1155,
              token: testErc1155.address,
              amount: unitsForSale,
              identifier: nftId,
            },
          ];

          // calculate total price (price per unit * units for sale) and fees
          standardCreateOrderInput.consideration = [
            {
              // USDC (ERC20 w/ 6 decimals)
              amount: (
                parseUnits(pricePerUnit, 6) * BigInt(unitsForSale)
              ).toString(),
              recipient: offerer.address,
              token: testErc20USDC.address,
            },
          ];
          standardCreateOrderInput.fees = [
            { recipient: zone.address, basisPoints },
          ];

          await testErc20USDC.mint(
            fulfiller.address,
            BigInt(
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            ) * 2n,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
            token: testErc20USDC.address,
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: approvalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await approvalAction.transactionMethods.transact();

          expect(
            await testErc20USDC.allowance(
              fulfiller.address,
              seaport.contract.address,
            ),
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", () => {
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
            offerer.address,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
              seaport.contract.address,
            ),
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
              seaport.contract.address,
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[2];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            orderStatus,
            unitsToFill: 2,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          expect(offererErc1155Balance).eq(2n);
          expect(fulfillerErc1155Balance).eq(8n);

          // Double check nft balances
          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });
    });

    describe("Multiple ERC1155s are partially transferred", () => {
      describe("[Buy now] I want to partially buy two separate ERC1155s", () => {
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
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(6n);
          expect(offererSecondErc1155Balance).eq(3n);
          expect(fulfillerErc1155Balance).eq(4n);
          expect(fulfillerSecondErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
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
              (item) => ({ ...item, token: testErc20.address }),
            ),
          };

          await testErc20.mint(
            fulfiller.address,
            (standardCreateOrderInput.consideration[0] as CurrencyItem).amount,
          );

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
              seaport.contract.address,
            ),
          ).to.equal(MAX_INT);

          const fulfillAction = actions[1];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(6n);
          expect(offererSecondErc1155Balance).eq(3n);
          expect(fulfillerErc1155Balance).eq(4n);
          expect(fulfillerSecondErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", () => {
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
            offerer.address,
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              fulfiller.address,
              ethers.provider,
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
              seaport.contract.address,
            ),
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
              seaport.contract.address,
            ),
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
              seaport.contract.address,
            ),
          ).to.eq(MAX_INT);

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            offerer.address,
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            fulfiller.address,
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(fulfiller.address, nftId);

          expect(offererErc1155Balance).eq(4n);
          expect(offererSecondErc1155Balance).eq(2n);
          expect(fulfillerErc1155Balance).eq(6n);
          expect(fulfillerSecondErc1155Balance).eq(3n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            orderStatus,
            unitsToFill: 2,
            fulfillerAddress: fulfiller.address,
            provider: ethers.provider,
            fulfillReceipt: receipt,
          });

          // Double check nft balances
          expect(fulfillStandardOrderSpy).calledOnce;
        });
      });
    });
  },
);
