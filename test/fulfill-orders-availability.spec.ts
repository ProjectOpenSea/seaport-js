import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput, OrderWithCounter } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want a batch fulfill to survive one unfillable order",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let firstOrder: OrderWithCounter
    let secondOrder: OrderWithCounter

    const firstNftId = "1"
    const secondNftId = "2"
    const price = parseEther("1")

    const listingFor = async (nftId: string): Promise<CreateOrderInput> => ({
      startTime: "0",
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await fixture.testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        { amount: price.toString(), recipient: await offerer.getAddress() },
      ],
    })

    beforeEach(async () => {
      const { ethers, seaport, testErc721 } = fixture
      ;[offerer, , fulfiller] = await ethers.getSigners()

      await testErc721.mint(await offerer.getAddress(), firstNftId)
      await testErc721.mint(await offerer.getAddress(), secondNftId)

      firstOrder = await (
        await seaport.createOrder(await listingFor(firstNftId))
      ).executeAllActions()
      secondOrder = await (
        await seaport.createOrder(await listingFor(secondNftId))
      ).executeAllActions()
    })

    it("drops a cancelled order and still fulfills the other", async () => {
      const { seaport, testErc721 } = fixture

      await (
        await seaport
          .cancelOrders([firstOrder.parameters], await offerer.getAddress())
          .transact()
      ).wait()

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order: firstOrder }, { order: secondOrder }],
        accountAddress: await fulfiller.getAddress(),
      })

      const fulfillAction = actions[actions.length - 1]

      // Only the surviving order is paid for.
      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transaction.value).to.eq(price)

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(await testErc721.ownerOf(secondNftId)).to.eq(
        await fulfiller.getAddress(),
      )
      expect(await testErc721.ownerOf(firstNftId)).to.eq(
        await offerer.getAddress(),
      )
    })

    it("drops an already filled order and still fulfills the other", async () => {
      const { seaport, testErc721 } = fixture

      await (
        await seaport.fulfillOrder({
          order: firstOrder,
          accountAddress: await fulfiller.getAddress(),
        })
      ).executeAllActions()

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order: firstOrder }, { order: secondOrder }],
        accountAddress: await fulfiller.getAddress(),
      })

      await (
        await actions[actions.length - 1].transactionMethods.transact()
      ).wait()

      expect(await testErc721.ownerOf(secondNftId)).to.eq(
        await fulfiller.getAddress(),
      )
    })

    it("still reports when nothing in the batch can be filled", async () => {
      const { seaport } = fixture

      await (
        await seaport
          .cancelOrders(
            [firstOrder.parameters, secondOrder.parameters],
            await offerer.getAddress(),
          )
          .transact()
      ).wait()

      await expect(
        seaport.fulfillOrders({
          fulfillOrderDetails: [{ order: firstOrder }, { order: secondOrder }],
          accountAddress: await fulfiller.getAddress(),
        }),
      ).to.be.rejectedWith("None of the orders can be fulfilled")
    })
  },
)
