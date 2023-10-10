import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { TestERC1155, TestERC721 } from "../src/typechain-types";
import { CreateOrderInput, CurrencyItem } from "../src/types";
import * as fulfill from "../src/utils/fulfill";
import { getTagFromDomain } from "../src/utils/usecase";
import { describeWithFixture } from "./utils/setup";
import { OPENSEA_DOMAIN, OPENSEA_DOMAIN_TAG } from "./utils/constants";

const sinon = require("sinon");

describeWithFixture(
  "As a user I want to buy multiple listings or accept multiple offers",
  (fixture) => {
    let offerer: SignerWithAddress;
    let secondOfferer: SignerWithAddress;
    let zone: SignerWithAddress;
    let fulfiller: SignerWithAddress;
    let firstStandardCreateOrderInput: CreateOrderInput;
    let secondStandardCreateOrderInput: CreateOrderInput;
    let thirdStandardCreateOrderInput: CreateOrderInput;
    let fulfillAvailableOrdersSpy: sinon.SinonSpy; // eslint-disable-line no-undef
    let secondTestErc721: TestERC721;
    let secondTestErc1155: TestERC1155;

    const nftId = "1";
    const nftId2 = "2";
    const erc1155Amount = "3";
    const erc1155Amount2 = "7";

    beforeEach(async () => {
      fulfillAvailableOrdersSpy = sinon.spy(fulfill, "fulfillAvailableOrders");

      [offerer, secondOfferer, zone, fulfiller] = await ethers.getSigners();

      const TestERC721 = await ethers.getContractFactory("TestERC721");
      secondTestErc721 = await TestERC721.deploy();
      await secondTestErc721.deployed();

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      secondTestErc1155 = await TestERC1155.deploy();
      await secondTestErc1155.deployed();
    });

    afterEach(() => {
      fulfillAvailableOrdersSpy.restore();
    });

    describe("Multiple ERC721s are to be transferred from separate orders", () => {
      describe("[Buy now] I want to buy three ERC721 listings", () => {
        beforeEach(async () => {
          const { testErc721 } = fixture;

          // These will be used in 3 separate orders
          await testErc721.mint(offerer.address, nftId);
          await testErc721.mint(offerer.address, nftId2);
          await secondTestErc721.mint(secondOfferer.address, nftId);

          firstStandardCreateOrderInput = {
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

          secondStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifier: nftId2,
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

          thirdStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: secondTestErc721.address,
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: secondOfferer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        describe("with ETH", () => {
          it("3 ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture;

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            );

            const firstOrder = await firstOrderUseCase.executeAllActions();

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            );

            const secondOrder = await secondOrderUseCase.executeAllActions();

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              secondOfferer.address,
            );

            const thirdOrder = await thirdOrderUseCase.executeAllActions();

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: fulfiller.address,
              domain: OPENSEA_DOMAIN,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];
            expect(action.type).eq("exchange");
            expect(
              (await action.transactionMethods.buildTransaction()).data?.slice(
                -8,
              ),
            ).to.eq(OPENSEA_DOMAIN_TAG);

            const transaction = await action.transactionMethods.transact();
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

            const owners = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
              secondTestErc721.ownerOf(nftId),
            ]);

            expect(owners.every((owner) => owner === fulfiller.address)).to.be
              .true;

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });

        describe("with ERC20", () => {
          beforeEach(() => {
            const { testErc20 } = fixture;

            // Use ERC20 instead of eth
            firstStandardCreateOrderInput = {
              ...firstStandardCreateOrderInput,
              consideration: firstStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };
            secondStandardCreateOrderInput = {
              ...secondStandardCreateOrderInput,
              consideration: secondStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };
            thirdStandardCreateOrderInput = {
              ...thirdStandardCreateOrderInput,
              consideration: thirdStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };

            [
              firstStandardCreateOrderInput,
              secondStandardCreateOrderInput,
              thirdStandardCreateOrderInput,
            ].forEach(async (createOrderInput) => {
              await testErc20.mint(
                fulfiller.address,
                BigNumber.from(
                  (createOrderInput.consideration[0] as CurrencyItem).amount,
                ),
              );
            });
          });

          it("3 ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture;

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            );

            const firstOrder = await firstOrderUseCase.executeAllActions();

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            );

            const secondOrder = await secondOrderUseCase.executeAllActions();

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              secondOfferer.address,
            );

            const thirdOrder = await thirdOrderUseCase.executeAllActions();

            await expect(
              seaport.fulfillOrders({
                fulfillOrderDetails: [
                  { order: { ...firstOrder, signature: "" } },
                ],
              }),
            ).to.be.rejectedWith("All orders must include signatures");

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
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

            expect(
              (
                await fulfillAction.transactionMethods.buildTransaction()
              ).data?.slice(-8),
            ).to.eq(OPENSEA_DOMAIN_TAG);

            const transaction =
              await fulfillAction.transactionMethods.transact();
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

            const owners = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
              secondTestErc721.ownerOf(nftId),
            ]);

            expect(owners.every((owner) => owner === fulfiller.address)).to.be
              .true;

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });
      });

      describe("[Accept offer] I want to accept three ERC721 offers", () => {
        beforeEach(async () => {
          const { testErc721, testErc20 } = fixture;

          await testErc721.mint(fulfiller.address, nftId);
          await testErc721.mint(fulfiller.address, nftId2);
          await secondTestErc721.mint(fulfiller.address, nftId);

          await testErc20.mint(offerer.address, parseEther("20").toString());
          await testErc20.mint(
            secondOfferer.address,
            parseEther("10").toString(),
          );

          firstStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: testErc20.address,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifier: nftId,
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };

          secondStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: testErc20.address,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: testErc721.address,
                identifier: nftId2,
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };

          thirdStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: testErc20.address,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: secondTestErc721.address,
                identifier: nftId,
                recipient: secondOfferer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC721", async () => {
          const { seaport, testErc721, testErc20 } = fixture;

          const firstOrderUseCase = await seaport.createOrder(
            firstStandardCreateOrderInput,
          );

          const firstOrder = await firstOrderUseCase.executeAllActions();

          const secondOrderUseCase = await seaport.createOrder(
            secondStandardCreateOrderInput,
          );

          const secondOrder = await secondOrderUseCase.executeAllActions();

          const thirdOrderUseCase = await seaport.createOrder(
            thirdStandardCreateOrderInput,
            secondOfferer.address,
          );

          const thirdOrder = await thirdOrderUseCase.executeAllActions();

          const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: [
              { order: firstOrder },
              { order: secondOrder },
              { order: thirdOrder },
            ],
            accountAddress: fulfiller.address,
            domain: OPENSEA_DOMAIN,
          });

          const approvalAction = actions[0];

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: testErc721.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: approvalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await approvalAction.transactionMethods.transact();

          expect(
            await testErc721.isApprovedForAll(
              fulfiller.address,
              seaport.contract.address,
            ),
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
            await testErc20.allowance(
              fulfiller.address,
              seaport.contract.address,
            ),
          ).eq(MAX_INT);

          const thirdApprovalAction = actions[2];

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: secondTestErc721.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await thirdApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc721.isApprovedForAll(
              fulfiller.address,
              seaport.contract.address,
            ),
          ).to.be.true;

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          expect(
            (
              await fulfillAction.transactionMethods.buildTransaction()
            ).data?.slice(-8),
          ).to.eq(OPENSEA_DOMAIN_TAG);

          const transaction = await fulfillAction.transactionMethods.transact();
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ]);

          expect(owners).deep.equal([
            offerer.address,
            offerer.address,
            secondOfferer.address,
          ]);

          expect(fulfillAvailableOrdersSpy).calledOnce;
        });
      });
    });

    describe("Multiple ERC1155s are to be transferred from separate orders", () => {
      describe("[Buy now] I want to buy three ERC1155 listings", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture;

          // These will be used in 3 separate orders
          await testErc1155.mint(offerer.address, nftId, erc1155Amount);
          await testErc1155.mint(offerer.address, nftId, erc1155Amount2);
          await secondTestErc1155.mint(
            secondOfferer.address,
            nftId,
            erc1155Amount,
          );

          firstStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                amount: erc1155Amount,
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

          secondStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: testErc1155.address,
                amount: erc1155Amount2,
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

          thirdStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: secondTestErc1155.address,
                amount: erc1155Amount,
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: secondOfferer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        describe("with ETH", () => {
          it("3 ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture;

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            );

            const firstOrder = await firstOrderUseCase.executeAllActions();

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            );

            const secondOrder = await secondOrderUseCase.executeAllActions();

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              secondOfferer.address,
            );

            const thirdOrder = await thirdOrderUseCase.executeAllActions();

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: fulfiller.address,
              domain: OPENSEA_DOMAIN,
            });

            expect(actions.length).to.eq(1);

            const action = actions[0];

            expect(action.type).eq("exchange");

            expect(
              (await action.transactionMethods.buildTransaction()).data?.slice(
                -8,
              ),
            ).to.eq(OPENSEA_DOMAIN_TAG);

            const transaction = await action.transactionMethods.transact();
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

            const balances = await Promise.all([
              testErc1155.balanceOf(fulfiller.address, nftId),
              secondTestErc1155.balanceOf(fulfiller.address, nftId),
            ]);

            expect(balances[0]).to.equal(BigNumber.from(10));
            expect(balances[1]).to.equal(BigNumber.from(erc1155Amount));

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });

        describe("with ERC20", () => {
          beforeEach(() => {
            const { testErc20 } = fixture;

            // Use ERC20 instead of eth
            firstStandardCreateOrderInput = {
              ...firstStandardCreateOrderInput,
              consideration: firstStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };
            secondStandardCreateOrderInput = {
              ...secondStandardCreateOrderInput,
              consideration: secondStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };
            thirdStandardCreateOrderInput = {
              ...thirdStandardCreateOrderInput,
              consideration: thirdStandardCreateOrderInput.consideration.map(
                (item) => ({ ...item, token: testErc20.address }),
              ),
            };

            [
              firstStandardCreateOrderInput,
              secondStandardCreateOrderInput,
              thirdStandardCreateOrderInput,
            ].forEach(async (createOrderInput) => {
              await testErc20.mint(
                fulfiller.address,
                BigNumber.from(
                  (createOrderInput.consideration[0] as CurrencyItem).amount,
                ),
              );
            });
          });

          it("3 ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture;

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            );

            const firstOrder = await firstOrderUseCase.executeAllActions();

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            );

            const secondOrder = await secondOrderUseCase.executeAllActions();

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              secondOfferer.address,
            );

            const thirdOrder = await thirdOrderUseCase.executeAllActions();

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
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

            expect(
              (
                await fulfillAction.transactionMethods.buildTransaction()
              ).data?.slice(-8),
            ).to.eq(OPENSEA_DOMAIN_TAG);

            const transaction =
              await fulfillAction.transactionMethods.transact();
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

            const balances = await Promise.all([
              testErc1155.balanceOf(fulfiller.address, nftId),
              secondTestErc1155.balanceOf(fulfiller.address, nftId),
            ]);

            expect(balances[0]).to.equal(BigNumber.from(10));
            expect(balances[1]).to.equal(BigNumber.from(erc1155Amount));

            expect(fulfillAvailableOrdersSpy).calledOnce;
          });
        });
      });

      describe("[Accept offer] I want to accept three ERC1155 offers", () => {
        beforeEach(async () => {
          const { testErc1155, testErc20 } = fixture;

          await testErc1155.mint(fulfiller.address, nftId, erc1155Amount);
          await testErc1155.mint(fulfiller.address, nftId, erc1155Amount2);
          await secondTestErc1155.mint(fulfiller.address, nftId, erc1155Amount);

          await testErc20.mint(offerer.address, parseEther("20").toString());
          await testErc20.mint(
            secondOfferer.address,
            parseEther("10").toString(),
          );

          firstStandardCreateOrderInput = {
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
                amount: erc1155Amount,
                identifier: nftId,
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };

          secondStandardCreateOrderInput = {
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
                amount: erc1155Amount2,
                identifier: nftId,
                recipient: offerer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };

          thirdStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: testErc20.address,
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC1155,
                token: secondTestErc1155.address,
                amount: erc1155Amount,
                identifier: nftId,
                recipient: secondOfferer.address,
              },
            ],
            // 2.5% fee
            fees: [{ recipient: zone.address, basisPoints: 250 }],
          };
        });

        it("ERC20 <=> ERC1155", async () => {
          const { seaport, testErc1155, testErc20 } = fixture;

          const firstOrderUseCase = await seaport.createOrder(
            firstStandardCreateOrderInput,
          );

          const firstOrder = await firstOrderUseCase.executeAllActions();

          const secondOrderUseCase = await seaport.createOrder(
            secondStandardCreateOrderInput,
          );

          const secondOrder = await secondOrderUseCase.executeAllActions();

          const thirdOrderUseCase = await seaport.createOrder(
            thirdStandardCreateOrderInput,
            secondOfferer.address,
          );

          const thirdOrder = await thirdOrderUseCase.executeAllActions();

          const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: [
              { order: firstOrder },
              { order: secondOrder },
              { order: thirdOrder },
            ],
            accountAddress: fulfiller.address,
            // When domain is empty or undefined, it should not append any tag to the calldata.
            domain: undefined,
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
            token: testErc20.address,
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await secondApprovalAction.transactionMethods.transact();

          expect(
            await testErc20.allowance(
              fulfiller.address,
              seaport.contract.address,
            ),
          ).eq(MAX_INT);

          const thirdApprovalAction = actions[2];

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: secondTestErc1155.address,
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: seaport.contract.address,
          });

          await thirdApprovalAction.transactionMethods.transact();

          expect(
            await secondTestErc1155.isApprovedForAll(
              fulfiller.address,
              seaport.contract.address,
            ),
          ).to.be.true;

          const fulfillAction = actions[3];

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          });

          // When domain is empty or undefined, it should not append any tag to the calldata.
          const emptyDomainTag = getTagFromDomain("");
          const dataForBuildTransaction = (
            await fulfillAction.transactionMethods.buildTransaction()
          ).data?.slice(-8);
          expect(dataForBuildTransaction).to.not.eq(emptyDomainTag);
          expect(dataForBuildTransaction).to.not.eq(OPENSEA_DOMAIN_TAG);

          const transaction = await fulfillAction.transactionMethods.transact();

          expect(transaction.data.slice(-8)).to.not.eq(emptyDomainTag);
          expect(transaction.data.slice(-8)).to.not.eq(OPENSEA_DOMAIN_TAG);

          const balances = await Promise.all([
            testErc1155.balanceOf(offerer.address, nftId),
            secondTestErc1155.balanceOf(secondOfferer.address, nftId),
          ]);

          expect(balances[0]).to.equal(BigNumber.from(10));
          expect(balances[1]).to.equal(BigNumber.from(erc1155Amount));

          expect(fulfillAvailableOrdersSpy).calledOnce;
        });
      });
    });

    // TODO
    describe("Special use cases", () => {
      it("Can fulfill dutch auction orders", () => {});
      it("Can fulfill criteria based orders", () => {});
      it("Can fulfill a single order", () => {});
      it("Can fulfill bundle orders", () => {});
      it("Can fulfill swap orders", () => {});
      it("Can partially fulfill orders", () => {});
    });
  },
);
