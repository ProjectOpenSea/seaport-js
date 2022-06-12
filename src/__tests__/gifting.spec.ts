import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../constants";
import { CreateOrderInput, CurrencyItem } from "../types";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now and gift it to another address",
  (fixture) => {
    let offerer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let recipient: SignerWithAddress;
    let standardCreateOrderInput: CreateOrderInput;
    const nftId = "1";
    const erc1155Amount = "3";

    beforeEach(async () => {
      [offerer, zone, fulfiller, recipient] = await ethers.getSigners();
    });

    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC721 for someone else", async () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          await testErc721.mint(offerer.address, nftId);

          standardCreateOrderInput = {
            startTime: "0",
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
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        describe("with ETH", () => {
          it("ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
              recipientAddress: recipient.address,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            await action.transactionMethods.transact();

            const owner = await testErc721.ownerOf(nftId);

            expect(owner).to.equal(recipient.address);
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
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );
          });

          it("ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
              recipientAddress: recipient.address,
            });

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

            await fulfillAction.transactionMethods.transact();

            const owner = await testErc721.ownerOf(nftId);

            expect(owner).to.equal(recipient.address);
          });
        });
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC1155 for someone else", async () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          await testErc1155.mint(offerer.address, nftId, erc1155Amount);

          standardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                identifier: nftId,
                amount: erc1155Amount,
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
          it("ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput,
              offerer.address
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
              recipientAddress: recipient.address,
            });

            const fulfillAction = actions[0];

            expect(fulfillAction).to.be.deep.equal({
              type: "exchange",
              transactionMethods: fulfillAction.transactionMethods,
            });

            await fulfillAction.transactionMethods.transact();

            const balance = await testErc1155.balanceOf(
              recipient.address,
              nftId
            );

            expect(balance).to.equal(erc1155Amount);
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
              BigNumber.from(
                (standardCreateOrderInput.consideration[0] as CurrencyItem)
                  .amount
              )
            );
          });

          it("ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            const { executeAllActions } = await seaport.createOrder(
              standardCreateOrderInput
            );

            const order = await executeAllActions();

            const { actions } = await seaport.fulfillOrder({
              order,
              accountAddress: fulfiller.address,
              recipientAddress: recipient.address,
            });

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

            await fulfillAction.transactionMethods.transact();

            const balance = await testErc1155.balanceOf(
              recipient.address,
              nftId
            );

            expect(balance).to.equal(erc1155Amount);
          });
        });
      });
    });
  }
);
