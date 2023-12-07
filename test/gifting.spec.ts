import { expect } from "chai";
import { Signer, parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now and gift it to another address",
  (fixture) => {
    let offerer: Signer;
    let zone: Signer;
    let fulfiller: Signer;
    let recipient: Signer;
    let standardCreateOrderInput: CreateOrderInput;
    const nftId = "1";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller, recipient] = await ethers.getSigners();
    });

    describe("A single ERC721 is to be transferred", () => {
      describe("[Buy now] I want to buy a single ERC721 for someone else", () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          await testErc721.mint(await offerer.getAddress(), nftId);

          standardCreateOrderInput = {
            startTime: "0",
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
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          };
        });

        describe("with ETH", () => {
          it("ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              recipientAddress: await recipient.getAddress(),
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            await action.transactionMethods.transact();

            const owner = await testErc721.ownerOf(nftId);

            expect(owner).to.equal(await recipient.getAddress());
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

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
            testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              recipientAddress: await recipient.getAddress(),
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
            ).to.eq(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const owner = await testErc721.ownerOf(nftId);

            expect(owner).to.equal(await recipient.getAddress());
          });
        });
      });
    });

    describe("A single ERC1155 is to be transferred", () => {
      describe("[Buy now] I want to buy a single ERC1155 for someone else", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          await testErc1155.mint(
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

        describe("with ETH", () => {
          it("ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              await offerer.getAddress(),
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              recipientAddress: await recipient.getAddress(),
            });

            const fulfillAction = actions[0];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balance = await testErc1155.balanceOf(
              await recipient.getAddress(),
              nftId,
            );

            expect(balance).to.equal(erc1155Amount);
          });
        });

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture;

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
            testErc20.mint(
              await fulfiller.getAddress(),
              (standardCreateOrderInput.consideration[0] as CurrencyItem)
                .amount,
            );
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: await fulfiller.getAddress(),
              recipientAddress: await recipient.getAddress(),
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
            ).to.eq(MAX_INT);

            const fulfillAction = actions[1];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balance = await testErc1155.balanceOf(
              await recipient.getAddress(),
              nftId,
            );

            expect(balance).to.equal(erc1155Amount);
          });
        });
      });
    });
  },
);
