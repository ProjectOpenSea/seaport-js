import { expect } from "chai";
import { Signer, parseEther, parseUnits, Interface } from "ethers";
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
import { SinonSpy } from "sinon";
import { SeaportABI } from "../src/abi/Seaport";
import { FulfillOrdersMetadata } from "../lib/utils/fulfill";
import { mapInputItemToOfferItem } from "../src/utils/order";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy now or accept an offer partially",
  (fixture) => {
    let offerer: Signer;
    let zone: Signer;
    let fulfiller: Signer;

    let fulfillStandardOrderSpy: SinonSpy;
    let fulfillAvailableOrdersSpy: SinonSpy;
    let standardCreateOrderInput: CreateOrderInput;
    let secondTestErc1155: TestERC1155;

    const nftId = "1";

    beforeEach(async () => {
      [offerer, zone, fulfiller] = await ethers.getSigners();

      fulfillStandardOrderSpy = sinon.spy(fulfill, "fulfillStandardOrder");
      fulfillAvailableOrdersSpy = sinon.spy(fulfill, "fulfillAvailableOrders");

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.waitForDeployment();
    });

    afterEach(() => {
      fulfillStandardOrderSpy.restore();
      fulfillAvailableOrdersSpy.restore();
    });

    describe("An ERC1155 is partially transferred", () => {
      describe("[Buy now] I want to partially buy an ERC1155", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 10 ERC1155s to offerer
          await testErc1155.mint(await offerer.getAddress(), nftId, 10);

          standardCreateOrderInput = {
            allowPartialFills: true,

            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: "10",
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
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
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC1155 <=> ETH adjust tips correctly", async () => {
          // Note: For simplicity in this test, tips are returned to the fulfiller.
          const tips = [
            {
              amount: parseEther("1").toString(),
              recipient: await fulfiller.getAddress(),
            },
          ];
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
            tips,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const { value } = await action.transactionMethods.buildTransaction();

          // This test verifies that the tips are adjusted correctly in the transaction.
          // The expected total is 2 ETH for tokens and 0.2 ETH for tips, totaling 2.2 ETH.
          expect(value?.toString()).to.eq(parseEther("2.2").toString());

          const transaction = await action.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(BigInt(8));
          expect(fulfillerErc1155Balance).eq(BigInt(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),
            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC1155 <=> ETH adjust tips correctly using fulfillOrders", async () => {
          // same test as above, but instead of fulfillOrder we use fulfillOrders
          const tips = [
            {
              amount: parseEther("1").toString(),
              recipient: await fulfiller.getAddress(),
            },
          ];
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: [
              {
                order,
                unitsToFill: 2,
                tips,
              },
            ],
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const { value } = await action.transactionMethods.buildTransaction();

          // This test verifies that the tips are adjusted correctly in the transaction.
          // The expected total is 2 ETH for tokens and 0.2 ETH for tips, totaling 2.2 ETH.
          expect(value?.toString()).to.eq(parseEther("2.2").toString());

          const transaction = await action.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(BigInt(8));
          expect(fulfillerErc1155Balance).eq(BigInt(2));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),
            fulfillReceipt: receipt!,
          });

          const tipConsiderationItems = tips.map((tip) => ({
            ...mapInputItemToOfferItem(tip),
            recipient: tip.recipient,
          }));

          const expectedArgs = {
            ordersMetadata: [
              {
                order,
                unitsToFill: 2,
                tips: tipConsiderationItems,
              },
            ],
          };

          expect(
            fulfillAvailableOrdersSpy.withArgs(
              sinon.match(function ({
                ordersMetadata,
              }: {
                ordersMetadata: FulfillOrdersMetadata;
              }) {
                ordersMetadata.every((metadata, index) => {
                  expect(metadata.order).to.deep.equal(
                    expectedArgs.ordersMetadata[index].order,
                    "order doesn't match expected value",
                  );
                  expect(metadata.unitsToFill).to.deep.equal(
                    expectedArgs.ordersMetadata[index].unitsToFill,
                    "unitsToFill doesn't match expected value",
                  );
                  expect(metadata.tips).to.deep.equal(
                    expectedArgs.ordersMetadata[index].tips,
                    "tips doesn't match expected value",
                  );
                });
                return true;
              }),
            ).calledOnce,
          ).to.be.true;
        });

        it("ERC1155 <=> ETH adjust tips correctly with low denomination", async () => {
          // Note: For simplicity in this test, tips are returned to the fulfiller.
          const totalTips = "2"; // 2 wei
          const totalPrice = "10"; // 10 wei
          const offerAmount = "2"; // 2 tokens (ERC1155)

          const tips = [
            {
              amount: totalTips,
              recipient: await fulfiller.getAddress(),
            },
          ];

          const { seaport, testErc1155 } = fixture;

          standardCreateOrderInput.offer = [
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              amount: offerAmount,
              identifier: nftId,
            },
          ];

          standardCreateOrderInput.consideration = [
            {
              amount: totalPrice,
              recipient: await offerer.getAddress(),
            },
          ];

          // since denominations are very low, we need to remove the fees in this test
          delete standardCreateOrderInput.fees;

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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 1,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
            tips,
          });

          expect(actions.length).to.eq(1);

          const action = actions[0];

          expect(action).to.deep.equal({
            type: "exchange",
            transactionMethods: action.transactionMethods,
          });

          const { value } = await action.transactionMethods.buildTransaction();

          // This test verifies that the tips are adjusted correctly in the transaction when denominations are very low.
          // The expected total is 5 wei for tokens and 1 wei for tips, totaling 6 wei.
          expect(value?.toString()).to.eq("6");

          const transaction = await action.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(BigInt(9));
          expect(fulfillerErc1155Balance).eq(BigInt(1));

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 1,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),
            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
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
              token: await testErc1155.getAddress(),
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
              recipient: await offerer.getAddress(),
            },
          ];
          standardCreateOrderInput.fees = [
            { recipient: await zone.getAddress(), basisPoints },
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
            accountAddress: await fulfiller.getAddress(),
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
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);
        });

        it("ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20, testErc1155 } = fixture;

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

          await testErc20.mint(
            await fulfiller.getAddress(),
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC1155 <=> ERC20 include tips correctly", async () => {
          const { seaport, testErc20, testErc1155 } = fixture;

          // Note: For simplicity in this test, tips are returned to the fulfiller.
          const tips = [
            {
              amount: parseEther("1").toString(),
              recipient: await fulfiller.getAddress(),
              token: await testErc20.getAddress(),
            },
          ];

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

          await testErc20.mint(
            await fulfiller.getAddress(),
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
            tips,
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

          const { data } =
            await fulfillAction.transactionMethods.buildTransaction();

          const iface = new Interface(SeaportABI);
          const decoded = iface.parseTransaction({ data });
          const considerations = decoded?.args[0][0][3];
          expect(considerations.length).to.eq(3);

          const tipConsideration = considerations.find(
            (consideration: {
              recipient: string;
              token: string;
              startAmount: BigInt;
            }) =>
              consideration.recipient === tips[0].recipient &&
              consideration.token === tips[0].token &&
              consideration.startAmount === BigInt(tips[0].amount),
          );
          // This test verifies that the tip consideration exists.
          // Tip considerations will be adjusted correctly by the seaport protocol.
          expect(tipConsideration).to.exist;

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),
            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
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
              token: await testErc1155.getAddress(),
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
              recipient: await offerer.getAddress(),
              token: await testErc20USDC.getAddress(),
            },
          ];
          standardCreateOrderInput.fees = [
            { recipient: await zone.getAddress(), basisPoints },
          ];

          await testErc20USDC.mint(
            await fulfiller.getAddress(),
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          expect(actions.length).to.eq(2);

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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(8n);
          expect(fulfillerErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),
            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("[Buy now] I want to partially buy an ERC1155 twice", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 100 ERC1155s to offerer
          await testErc1155.mint(await offerer.getAddress(), nftId, 100);

          standardCreateOrderInput = {
            allowPartialFills: true,

            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: "100",
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("100").toString(),
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

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 50,
            accountAddress: await fulfiller.getAddress(),
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
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(50n);
          expect(fulfillerErc1155Balance).eq(50n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 50,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);

          // Fulfill the order again for another 7 units
          const { actions: actions2 } = await seaport.fulfillOrder({
            order,
            unitsToFill: 7,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          });

          expect(actions2.length).to.eq(1);

          const action2 = actions2[0];

          expect(action2).to.deep.equal({
            type: "exchange",
            transactionMethods: action2.transactionMethods,
          });

          const transaction2 = await action2.transactionMethods.transact();
          expect(transaction2.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const offererErc1155Balance2 = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance2 = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance2).eq(43n);
          expect(fulfillerErc1155Balance2).eq(57n);

          expect(fulfillStandardOrderSpy.calledTwice);
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", () => {
        beforeEach(async () => {
          const { testErc20, testErc1155 } = fixture;

          // Mint 10 ERC1155s to fulfiller
          await testErc1155.mint(await fulfiller.getAddress(), nftId, 10);

          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("10").toString(),
          );

          standardCreateOrderInput = {
            allowPartialFills: true,

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
                amount: "10",
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

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
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

          // We also need to approve ERC-20 as we send that out as fees..
          const second = actions[1];

          expect(second).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: second.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await second.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
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
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          expect(offererErc1155Balance).eq(2n);
          expect(fulfillerErc1155Balance).eq(8n);

          // Double check nft balances
          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });

    describe("Multiple ERC1155s are partially transferred", () => {
      describe("[Buy now] I want to partially buy two separate ERC1155s", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // Mint 10 and 5 ERC1155s to offerer
          await testErc1155.mint(await offerer.getAddress(), nftId, 10);
          await secondTestErc1155.mint(await offerer.getAddress(), nftId, 5);

          standardCreateOrderInput = {
            allowPartialFills: true,

            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: "10",
                identifier: nftId,
              },
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                amount: "5",
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
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
            await offerer.getAddress(),
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId,
            );

          expect(offererErc1155Balance).eq(6n);
          expect(offererSecondErc1155Balance).eq(3n);
          expect(fulfillerErc1155Balance).eq(4n);
          expect(fulfillerSecondErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });

        it("ERC1155 + ERC1155 <=> ERC20", async () => {
          const { seaport, testErc20, testErc1155 } = fixture;

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

          await testErc20.mint(
            await fulfiller.getAddress(),
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
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId,
            );

          expect(offererErc1155Balance).eq(6n);
          expect(offererSecondErc1155Balance).eq(3n);
          expect(fulfillerErc1155Balance).eq(4n);
          expect(fulfillerSecondErc1155Balance).eq(2n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            unitsToFill: 2,
            orderStatus,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });

      describe("[Accept offer] I want to accept a partial offer for my ERC1155", () => {
        beforeEach(async () => {
          const { testErc20, testErc1155 } = fixture;

          // Mint 10 ERC1155s to fulfiller
          await testErc1155.mint(await fulfiller.getAddress(), nftId, 10);
          await secondTestErc1155.mint(await fulfiller.getAddress(), nftId, 5);

          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("10").toString(),
          );

          standardCreateOrderInput = {
            allowPartialFills: true,

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
                amount: "10",
                recipient: await offerer.getAddress(),
              },
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                identifier: nftId,
                amount: "5",
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155 + ERC1155", async () => {
          const { seaport, testErc1155, testErc20 } = fixture;

          const { executeAllActions } = await seaport.createOrder(
            standardCreateOrderInput,
            await offerer.getAddress(),
          );

          const order = await executeAllActions();

          expect(order.parameters.orderType).eq(OrderType.PARTIAL_OPEN);

          const orderStatus = await seaport.getOrderStatus(
            seaport.getOrderHash(order.parameters),
          );

          const ownerToTokenToIdentifierBalances =
            await getBalancesForFulfillOrder(
              order,
              await fulfiller.getAddress(),
            );

          const { actions } = await seaport.fulfillOrder({
            order,
            unitsToFill: 2,
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
          const second = actions[2];

          expect(second).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: second.transactionMethods,
            operator: await seaport.contract.getAddress(),
          });

          await second.transactionMethods.transact();

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
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const receipt = await transaction.wait();

          const offererErc1155Balance = await testErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const offererSecondErc1155Balance = await secondTestErc1155.balanceOf(
            await offerer.getAddress(),
            nftId,
          );

          const fulfillerErc1155Balance = await testErc1155.balanceOf(
            await fulfiller.getAddress(),
            nftId,
          );

          const fulfillerSecondErc1155Balance =
            await secondTestErc1155.balanceOf(
              await fulfiller.getAddress(),
              nftId,
            );

          expect(offererErc1155Balance).eq(4n);
          expect(offererSecondErc1155Balance).eq(2n);
          expect(fulfillerErc1155Balance).eq(6n);
          expect(fulfillerSecondErc1155Balance).eq(3n);

          await verifyBalancesAfterFulfill({
            ownerToTokenToIdentifierBalances,
            order,
            orderStatus,
            unitsToFill: 2,
            fulfillerAddress: await fulfiller.getAddress(),

            fulfillReceipt: receipt!,
          });

          // Double check nft balances
          expect(fulfillStandardOrderSpy.calledOnce);
        });
      });
    });
  },
);
