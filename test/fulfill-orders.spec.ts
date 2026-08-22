import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType, MAX_INT } from "../src/constants"
import type { TestERC721, TestERC1155 } from "../src/typechain-types/index"
import type {
  ApprovalAction,
  CreateOrderInput,
  CurrencyItem,
} from "../src/types"
import { getTagFromDomain } from "../src/utils/usecase"
import { OPENSEA_DOMAIN, OPENSEA_DOMAIN_TAG } from "./utils/constants"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want to buy multiple listings or accept multiple offers",
  fixture => {
    let offerer: HardhatEthersSigner
    let secondOfferer: HardhatEthersSigner
    let zone: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let firstStandardCreateOrderInput: CreateOrderInput
    let secondStandardCreateOrderInput: CreateOrderInput
    let thirdStandardCreateOrderInput: CreateOrderInput
    let secondTestErc721: TestERC721
    let secondTestErc1155: TestERC1155

    const nftId = "1"
    const nftId2 = "2"
    const erc1155Amount = "3"
    const erc1155Amount2 = "7"

    beforeEach(async () => {
      const { ethers } = fixture

      ;[offerer, secondOfferer, zone, fulfiller] = await ethers.getSigners()

      const TestERC721 = await ethers.getContractFactory("TestERC721")
      secondTestErc721 = await TestERC721.deploy()
      await secondTestErc721.waitForDeployment()

      const TestERC1155 = await ethers.getContractFactory("TestERC1155")
      secondTestErc1155 = await TestERC1155.deploy()
      await secondTestErc1155.waitForDeployment()
    })

    describe("Multiple ERC721s are to be transferred from separate orders", () => {
      describe("[Buy now] I want to buy three ERC721 listings", () => {
        beforeEach(async () => {
          const { testErc721 } = fixture

          // These will be used in 3 separate orders
          await testErc721.mint(await offerer.getAddress(), nftId)
          await testErc721.mint(await offerer.getAddress(), nftId2)
          await secondTestErc721.mint(await secondOfferer.getAddress(), nftId)

          firstStandardCreateOrderInput = {
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
          }

          secondStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifier: nftId2,
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
          }

          thirdStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: await secondOfferer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }
        })

        describe("with ETH", () => {
          it("3 ERC721 <=> ETH", async () => {
            const { seaport, testErc721 } = fixture

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            )

            const firstOrder = await firstOrderUseCase.executeAllActions()

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            )

            const secondOrder = await secondOrderUseCase.executeAllActions()

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              await secondOfferer.getAddress(),
            )

            const thirdOrder = await thirdOrderUseCase.executeAllActions()

            const gasLimit = 10_000_000n
            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
              overrides: { gasLimit },
            })

            expect(actions.length).to.eq(1)

            const action = actions[0]
            expect(action.type).eq("exchange")
            const transactionRequest =
              await action.transactionMethods.buildTransaction()
            expect(transactionRequest.data?.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)
            expect(transactionRequest.gasLimit).to.eq(gasLimit)

            const transaction = await action.transactionMethods.transact()
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const owners = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
              secondTestErc721.ownerOf(nftId),
            ])

            expect(
              owners.every(
                async owner => owner === (await fulfiller.getAddress()),
              ),
            ).to.be.true
          })
        })

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress()
            firstStandardCreateOrderInput = {
              ...firstStandardCreateOrderInput,
              consideration: firstStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }
            secondStandardCreateOrderInput = {
              ...secondStandardCreateOrderInput,
              consideration: secondStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }
            thirdStandardCreateOrderInput = {
              ...thirdStandardCreateOrderInput,
              consideration: thirdStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }

            ;[
              firstStandardCreateOrderInput,
              secondStandardCreateOrderInput,
              thirdStandardCreateOrderInput,
            ].forEach(async createOrderInput => {
              await testErc20.mint(
                await fulfiller.getAddress(),
                (createOrderInput.consideration[0] as CurrencyItem).amount,
              )
            })
          })

          it("3 ERC721 <=> ERC20", async () => {
            const { seaport, testErc20, testErc721 } = fixture

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            )

            const firstOrder = await firstOrderUseCase.executeAllActions()

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            )

            const secondOrder = await secondOrderUseCase.executeAllActions()

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              await secondOfferer.getAddress(),
            )

            const thirdOrder = await thirdOrderUseCase.executeAllActions()

            await expect(
              seaport.fulfillOrders({
                fulfillOrderDetails: [
                  { order: { ...firstOrder, signature: "" } },
                ],
              }),
            ).to.be.rejectedWith("All orders must include signatures")

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            })

            expect(actions.length).to.eq(2)

            const approvalAction = actions[0]

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            })

            await approvalAction.transactionMethods.transact()

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT)

            const fulfillAction = actions[1]

            expect(
              (
                await fulfillAction.transactionMethods.buildTransaction()
              ).data?.slice(-8),
            ).to.eq(OPENSEA_DOMAIN_TAG)

            const transaction =
              await fulfillAction.transactionMethods.transact()
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const owners = await Promise.all([
              testErc721.ownerOf(nftId),
              testErc721.ownerOf(nftId2),
              secondTestErc721.ownerOf(nftId),
            ])

            expect(
              owners.every(
                async owner => owner === (await fulfiller.getAddress()),
              ),
            ).to.be.true
          })
        })
      })

      describe("[Accept offer] I want to accept three ERC721 offers", () => {
        beforeEach(async () => {
          const { testErc721, testErc20 } = fixture

          await testErc721.mint(await fulfiller.getAddress(), nftId)
          await testErc721.mint(await fulfiller.getAddress(), nftId2)
          await secondTestErc721.mint(await fulfiller.getAddress(), nftId)

          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("20").toString(),
          )
          await testErc20.mint(
            await secondOfferer.getAddress(),
            parseEther("10").toString(),
          )

          firstStandardCreateOrderInput = {
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
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          secondStandardCreateOrderInput = {
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
                identifier: nftId2,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          thirdStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: await testErc20.getAddress(),
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC721,
                token: await secondTestErc721.getAddress(),
                identifier: nftId,
                recipient: await secondOfferer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }
        })

        it("ERC20 <=> ERC721", async () => {
          const { seaport, testErc721, testErc20 } = fixture

          const firstOrderUseCase = await seaport.createOrder(
            firstStandardCreateOrderInput,
          )

          const firstOrder = await firstOrderUseCase.executeAllActions()

          const secondOrderUseCase = await seaport.createOrder(
            secondStandardCreateOrderInput,
          )

          const secondOrder = await secondOrderUseCase.executeAllActions()

          const thirdOrderUseCase = await seaport.createOrder(
            thirdStandardCreateOrderInput,
            await secondOfferer.getAddress(),
          )

          const thirdOrder = await thirdOrderUseCase.executeAllActions()

          const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: [
              { order: firstOrder },
              { order: secondOrder },
              { order: thirdOrder },
            ],
            accountAddress: await fulfiller.getAddress(),
            domain: OPENSEA_DOMAIN,
          })

          const approvalAction = actions[0]

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc721.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: approvalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await approvalAction.transactionMethods.transact()

          expect(
            await testErc721.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true

          const secondApprovalAction = actions[1]

          expect(secondApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await secondApprovalAction.transactionMethods.transact()

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT)

          const thirdApprovalAction = actions[2]

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: await secondTestErc721.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await thirdApprovalAction.transactionMethods.transact()

          expect(
            await secondTestErc721.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true

          const fulfillAction = actions[3]

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          })

          expect(
            (
              await fulfillAction.transactionMethods.buildTransaction()
            ).data?.slice(-8),
          ).to.eq(OPENSEA_DOMAIN_TAG)

          const transaction = await fulfillAction.transactionMethods.transact()
          expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

          const owners = await Promise.all([
            testErc721.ownerOf(nftId),
            testErc721.ownerOf(nftId2),
            secondTestErc721.ownerOf(nftId),
          ])

          expect(owners).deep.equal([
            await offerer.getAddress(),
            await offerer.getAddress(),
            await secondOfferer.getAddress(),
          ])
        })
      })
    })

    describe("Multiple ERC1155s are to be transferred from separate orders", () => {
      describe("[Buy now] I want to buy three ERC1155 listings", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture

          // These will be used in 3 separate orders
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId,
            erc1155Amount,
          )
          await testErc1155.mint(
            await offerer.getAddress(),
            nftId,
            erc1155Amount2,
          )
          await secondTestErc1155.mint(
            await secondOfferer.getAddress(),
            nftId,
            erc1155Amount,
          )

          firstStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: erc1155Amount,
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
          }

          secondStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                amount: erc1155Amount2,
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
          }

          thirdStandardCreateOrderInput = {
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                amount: erc1155Amount,
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: await secondOfferer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }
        })

        describe("with ETH", () => {
          it("3 ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            )

            const firstOrder = await firstOrderUseCase.executeAllActions()

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            )

            const secondOrder = await secondOrderUseCase.executeAllActions()

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              await secondOfferer.getAddress(),
            )

            const thirdOrder = await thirdOrderUseCase.executeAllActions()

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            })

            expect(actions.length).to.eq(1)

            const action = actions[0]

            expect(action.type).eq("exchange")

            expect(
              (await action.transactionMethods.buildTransaction()).data?.slice(
                -8,
              ),
            ).to.eq(OPENSEA_DOMAIN_TAG)

            const transaction = await action.transactionMethods.transact()
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const balances = await Promise.all([
              testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
              secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            ])

            expect(balances[0]).to.equal(10n)
            expect(balances[1]).to.equal(BigInt(erc1155Amount))
          })
        })

        describe("with ERC20", () => {
          beforeEach(async () => {
            const { testErc20 } = fixture

            // Use ERC20 instead of eth
            const token = await testErc20.getAddress()
            firstStandardCreateOrderInput = {
              ...firstStandardCreateOrderInput,
              consideration: firstStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }
            secondStandardCreateOrderInput = {
              ...secondStandardCreateOrderInput,
              consideration: secondStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }
            thirdStandardCreateOrderInput = {
              ...thirdStandardCreateOrderInput,
              consideration: thirdStandardCreateOrderInput.consideration.map(
                item => ({
                  ...item,
                  token,
                }),
              ),
            }

            ;[
              firstStandardCreateOrderInput,
              secondStandardCreateOrderInput,
              thirdStandardCreateOrderInput,
            ].forEach(async createOrderInput => {
              await testErc20.mint(
                await fulfiller.getAddress(),
                (createOrderInput.consideration[0] as CurrencyItem).amount,
              )
            })
          })

          it("3 ERC1155 <=> ERC20", async () => {
            const { seaport, testErc20, testErc1155 } = fixture

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            )

            const firstOrder = await firstOrderUseCase.executeAllActions()

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            )

            const secondOrder = await secondOrderUseCase.executeAllActions()

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              await secondOfferer.getAddress(),
            )

            const thirdOrder = await thirdOrderUseCase.executeAllActions()

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder },
                { order: secondOrder },
                { order: thirdOrder },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            })

            expect(actions.length).to.eq(2)

            const approvalAction = actions[0]

            expect(approvalAction).to.deep.equal({
              type: "approval",
              token: await testErc20.getAddress(),
              identifierOrCriteria: "0",
              itemType: ItemType.ERC20,
              transactionMethods: approvalAction.transactionMethods,
              operator: await seaport.contract.getAddress(),
            })

            await approvalAction.transactionMethods.transact()

            expect(
              await testErc20.allowance(
                await fulfiller.getAddress(),
                await seaport.contract.getAddress(),
              ),
            ).to.eq(MAX_INT)

            const fulfillAction = actions[1]

            expect(
              (
                await fulfillAction.transactionMethods.buildTransaction()
              ).data?.slice(-8),
            ).to.eq(OPENSEA_DOMAIN_TAG)

            const transaction =
              await fulfillAction.transactionMethods.transact()
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const balances = await Promise.all([
              testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
              secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            ])

            expect(balances[0]).to.equal(10n)
            expect(balances[1]).to.equal(BigInt(erc1155Amount))
          })
        })
      })

      describe("[Buy now] I want to buy three ERC1155 listings twice", () => {
        beforeEach(async () => {
          const { testErc1155 } = fixture

          // These will be used in 3 separate orders
          await testErc1155.mint(await offerer.getAddress(), nftId, 100)
          await testErc1155.mint(await offerer.getAddress(), nftId, 100)
          await secondTestErc1155.mint(
            await secondOfferer.getAddress(),
            nftId,
            100,
          )

          firstStandardCreateOrderInput = {
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
                amount: parseEther("10").toString(),
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          secondStandardCreateOrderInput = {
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
                amount: parseEther("10").toString(),
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          thirdStandardCreateOrderInput = {
            allowPartialFills: true,
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                amount: "100",
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: await secondOfferer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }
        })

        describe("with ETH", () => {
          it("3 ERC1155 <=> ETH", async () => {
            const { seaport, testErc1155 } = fixture

            const firstOrderUseCase = await seaport.createOrder(
              firstStandardCreateOrderInput,
            )

            const firstOrder = await firstOrderUseCase.executeAllActions()

            const secondOrderUseCase = await seaport.createOrder(
              secondStandardCreateOrderInput,
            )

            const secondOrder = await secondOrderUseCase.executeAllActions()

            const thirdOrderUseCase = await seaport.createOrder(
              thirdStandardCreateOrderInput,
              await secondOfferer.getAddress(),
            )

            const thirdOrder = await thirdOrderUseCase.executeAllActions()

            const { actions } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder, unitsToFill: 50 },
                { order: secondOrder, unitsToFill: 50 },
                { order: thirdOrder, unitsToFill: 50 },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            })

            expect(actions.length).to.eq(1)

            const action = actions[0]

            expect(action.type).eq("exchange")

            expect(
              (await action.transactionMethods.buildTransaction()).data?.slice(
                -8,
              ),
            ).to.eq(OPENSEA_DOMAIN_TAG)

            const transaction = await action.transactionMethods.transact()
            expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const balances = await Promise.all([
              testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
              secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            ])

            expect(balances[0]).to.equal(100n)
            expect(balances[1]).to.equal(50n)

            // Fulfill the order again for another 7 units
            const { actions: actions2 } = await seaport.fulfillOrders({
              fulfillOrderDetails: [
                { order: firstOrder, unitsToFill: 7 },
                { order: secondOrder, unitsToFill: 7 },
                { order: thirdOrder, unitsToFill: 7 },
              ],
              accountAddress: await fulfiller.getAddress(),
              domain: OPENSEA_DOMAIN,
            })

            expect(actions2.length).to.eq(1)

            const action2 = actions2[0]

            expect(action2.type).eq("exchange")

            expect(
              (await action2.transactionMethods.buildTransaction()).data?.slice(
                -8,
              ),
            ).to.eq(OPENSEA_DOMAIN_TAG)

            const transaction2 = await action2.transactionMethods.transact()
            expect(transaction2.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG)

            const balances2 = await Promise.all([
              testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
              secondTestErc1155.balanceOf(await fulfiller.getAddress(), nftId),
            ])

            expect(balances2[0]).to.equal(114n)
            expect(balances2[1]).to.equal(BigInt(57n))
          })
        })
      })

      describe("[Accept offer] I want to accept three ERC1155 offers", () => {
        beforeEach(async () => {
          const { testErc1155, testErc20 } = fixture

          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
          )
          await testErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount2,
          )
          await secondTestErc1155.mint(
            await fulfiller.getAddress(),
            nftId,
            erc1155Amount,
          )

          await testErc20.mint(
            await offerer.getAddress(),
            parseEther("20").toString(),
          )
          await testErc20.mint(
            await secondOfferer.getAddress(),
            parseEther("10").toString(),
          )

          firstStandardCreateOrderInput = {
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
                amount: erc1155Amount,
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          secondStandardCreateOrderInput = {
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
                amount: erc1155Amount2,
                identifier: nftId,
                recipient: await offerer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }

          thirdStandardCreateOrderInput = {
            offer: [
              {
                amount: parseEther("10").toString(),
                token: await testErc20.getAddress(),
              },
            ],
            consideration: [
              {
                itemType: ItemType.ERC1155,
                token: await secondTestErc1155.getAddress(),
                amount: erc1155Amount,
                identifier: nftId,
                recipient: await secondOfferer.getAddress(),
              },
            ],
            // 2.5% fee
            fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
          }
        })

        it("ERC20 <=> ERC1155", async () => {
          const { seaport, testErc1155, testErc20 } = fixture

          const firstOrderUseCase = await seaport.createOrder(
            firstStandardCreateOrderInput,
          )

          const firstOrder = await firstOrderUseCase.executeAllActions()

          const secondOrderUseCase = await seaport.createOrder(
            secondStandardCreateOrderInput,
          )

          const secondOrder = await secondOrderUseCase.executeAllActions()

          const thirdOrderUseCase = await seaport.createOrder(
            thirdStandardCreateOrderInput,
            await secondOfferer.getAddress(),
          )

          const thirdOrder = await thirdOrderUseCase.executeAllActions()

          const { actions } = await seaport.fulfillOrders({
            fulfillOrderDetails: [
              { order: firstOrder },
              { order: secondOrder },
              { order: thirdOrder },
            ],
            accountAddress: await fulfiller.getAddress(),
            // When domain is empty or undefined, it should not append any tag to the calldata.
            domain: undefined,
          })

          const approvalAction = actions[0]

          expect(approvalAction).to.deep.equal({
            type: "approval",
            token: await testErc1155.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: approvalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await approvalAction.transactionMethods.transact()

          expect(
            await testErc1155.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true

          const secondApprovalAction = actions[1]

          expect(secondApprovalAction).to.deep.equal({
            type: "approval",
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            transactionMethods: secondApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await secondApprovalAction.transactionMethods.transact()

          expect(
            await testErc20.allowance(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.eq(MAX_INT)

          const thirdApprovalAction = actions[2]

          expect(thirdApprovalAction).to.deep.equal({
            type: "approval",
            token: await secondTestErc1155.getAddress(),
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            transactionMethods: thirdApprovalAction.transactionMethods,
            operator: await seaport.contract.getAddress(),
          })

          await thirdApprovalAction.transactionMethods.transact()

          expect(
            await secondTestErc1155.isApprovedForAll(
              await fulfiller.getAddress(),
              await seaport.contract.getAddress(),
            ),
          ).to.be.true

          const fulfillAction = actions[3]

          expect(fulfillAction).to.be.deep.equal({
            type: "exchange",
            transactionMethods: fulfillAction.transactionMethods,
          })

          // When domain is empty or undefined, it should not append any tag to the calldata.
          const emptyDomainTag = getTagFromDomain("")
          const dataForBuildTransaction = (
            await fulfillAction.transactionMethods.buildTransaction()
          ).data?.slice(-8)
          expect(dataForBuildTransaction).to.not.eq(emptyDomainTag)
          expect(dataForBuildTransaction).to.not.eq(OPENSEA_DOMAIN_TAG)

          const transaction = await fulfillAction.transactionMethods.transact()

          expect(transaction.data.slice(-8)).to.not.eq(emptyDomainTag)
          expect(transaction.data.slice(-8)).to.not.eq(OPENSEA_DOMAIN_TAG)

          const balances = await Promise.all([
            testErc1155.balanceOf(await offerer.getAddress(), nftId),
            secondTestErc1155.balanceOf(
              await secondOfferer.getAddress(),
              nftId,
            ),
          ])

          expect(balances[0]).to.equal(10n)
          expect(balances[1]).to.equal(BigInt(erc1155Amount))
        })
      })
    })

    describe("exactApproval: true", () => {
      it("generates a separate approve action for each ERC721 token ID when filling multiple buy orders from the same collection", async () => {
        const { seaport, testErc721, testErc20 } = fixture

        await testErc721.mint(await fulfiller.getAddress(), nftId)
        await testErc721.mint(await fulfiller.getAddress(), nftId2)
        await testErc20.mint(
          await offerer.getAddress(),
          parseEther("20").toString(),
        )
        await testErc20.mint(
          await secondOfferer.getAddress(),
          parseEther("10").toString(),
        )

        const firstOrder = await (
          await seaport.createOrder({
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
            ],
          })
        ).executeAllActions()

        const secondOrder = await (
          await seaport.createOrder(
            {
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
                  identifier: nftId2,
                  recipient: await secondOfferer.getAddress(),
                },
              ],
            },
            await secondOfferer.getAddress(),
          )
        ).executeAllActions()

        const { actions } = await seaport.fulfillOrders({
          fulfillOrderDetails: [{ order: firstOrder }, { order: secondOrder }],
          accountAddress: await fulfiller.getAddress(),
          exactApproval: true,
        })

        // With exactApproval=true, each token ID needs its own approve() call.
        // Before the fix, addApprovalIfNeeded deduped by token only, so
        // the approval for nftId2 was silently dropped.
        const erc721Address = await testErc721.getAddress()
        const nftApprovals = actions.filter(
          (action): action is ApprovalAction =>
            action.type === "approval" && action.token === erc721Address,
        )
        expect(nftApprovals.length).to.equal(2)
        expect(nftApprovals.map(a => a.identifierOrCriteria)).to.have.members([
          nftId,
          nftId2,
        ])

        for (const action of actions.filter(a => a.type === "approval")) {
          await action.transactionMethods.transact()
        }

        await actions[actions.length - 1].transactionMethods.transact()

        expect(await testErc721.ownerOf(nftId)).to.equal(
          await offerer.getAddress(),
        )
        expect(await testErc721.ownerOf(nftId2)).to.equal(
          await secondOfferer.getAddress(),
        )
      })

      it("approves the batch total for one ERC20, not the first order's share", async () => {
        const { seaport, testErc721, testErc20 } = fixture

        // Two listings priced in the same ERC20, 10 and 20, so the batch needs 30.
        await testErc721.mint(await offerer.getAddress(), nftId)
        await testErc721.mint(await secondOfferer.getAddress(), nftId2)
        await testErc20.mint(
          await fulfiller.getAddress(),
          parseEther("30").toString(),
        )

        const listing = async (
          seller: HardhatEthersSigner,
          identifier: string,
          price: string,
        ) =>
          (
            await seaport.createOrder(
              {
                offer: [
                  {
                    itemType: ItemType.ERC721,
                    token: await testErc721.getAddress(),
                    identifier,
                  },
                ],
                consideration: [
                  {
                    amount: parseEther(price).toString(),
                    token: await testErc20.getAddress(),
                    recipient: await seller.getAddress(),
                  },
                ],
              },
              await seller.getAddress(),
            )
          ).executeAllActions()

        const firstOrder = await listing(offerer, nftId, "10")
        const secondOrder = await listing(secondOfferer, nftId2, "20")

        const { actions } = await seaport.fulfillOrders({
          fulfillOrderDetails: [{ order: firstOrder }, { order: secondOrder }],
          accountAddress: await fulfiller.getAddress(),
          exactApproval: true,
        })

        const erc20Address = await testErc20.getAddress()
        const erc20Approvals = actions.filter(
          (action): action is ApprovalAction =>
            action.type === "approval" && action.token === erc20Address,
        )
        // One allowance is shared by the whole batch, so one action is correct.
        expect(erc20Approvals.length).to.equal(1)

        for (const action of actions.filter(a => a.type === "approval")) {
          await action.transactionMethods.transact()
        }

        // The allowance has to cover 10 + 20, not just the first order's 10.
        // Read the spender off the action rather than recomputing the conduit.
        expect(
          await testErc20.allowance(
            await fulfiller.getAddress(),
            erc20Approvals[0].operator,
          ),
        ).to.equal(parseEther("30"))

        await actions[actions.length - 1].transactionMethods.transact()

        expect(await testErc721.ownerOf(nftId)).to.equal(
          await fulfiller.getAddress(),
        )
        expect(await testErc721.ownerOf(nftId2)).to.equal(
          await fulfiller.getAddress(),
        )
      })
    })
    // TODO
    describe("Special use cases", () => {
      it("Can fulfill dutch auction orders", () => {})
      it("Can fulfill criteria based orders", () => {})
      it("Can fulfill a single order", () => {})
      it("Can fulfill bundle orders", () => {})
      it("Can fulfill swap orders", () => {})
      it("Can partially fulfill orders", () => {})
    })
  },
)
