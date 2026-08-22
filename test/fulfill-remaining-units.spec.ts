import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput, OrderWithCounter } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want to fill what is left of an order someone else partly took",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let order: OrderWithCounter
    let orderHash: string

    const nftId = "1"
    const totalUnits = 10
    const price = parseEther("10")

    beforeEach(async () => {
      const { ethers, seaport, testErc1155 } = fixture
      ;[offerer, , fulfiller] = await ethers.getSigners()

      await testErc1155.mint(await offerer.getAddress(), nftId, totalUnits)

      const input: CreateOrderInput = {
        startTime: "0",
        allowPartialFills: true,
        offer: [
          {
            itemType: ItemType.ERC1155,
            token: await testErc1155.getAddress(),
            identifier: nftId,
            amount: String(totalUnits),
          },
        ],
        consideration: [
          { amount: price.toString(), recipient: await offerer.getAddress() },
        ],
      }

      order = await (await seaport.createOrder(input)).executeAllActions()
      orderHash = seaport.getOrderHash(order.parameters)

      // Someone takes 6 of the 10 units first.
      const { actions } = await seaport.fulfillOrder({
        order,
        unitsToFill: 6,
        accountAddress: await fulfiller.getAddress(),
      })
      for (const action of actions) {
        await (await action.transactionMethods.transact()).wait()
      }
    })

    it("fills the remaining units when asked for more than are left", async () => {
      const { seaport, testErc1155 } = fixture

      const { actions } = await seaport.fulfillOrder({
        order,
        unitsToFill: 8, // only 4 remain
        accountAddress: await fulfiller.getAddress(),
      })

      const fulfillAction = actions[actions.length - 1]

      // Four units at 1 ETH each, not the eight that were asked for.
      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transaction.value).to.eq(parseEther("4"))

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(
        await testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
      ).to.eq(BigInt(totalUnits))

      const status = await seaport.getOrderStatus(orderHash)
      expect(status.totalFilled).to.eq(status.totalSize)
    })

    it("does the same through fulfillOrders", async () => {
      const { seaport, testErc1155 } = fixture

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order, unitsToFill: 8 }],
        accountAddress: await fulfiller.getAddress(),
      })

      const fulfillAction = actions[actions.length - 1]
      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transaction.value).to.eq(parseEther("4"))

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(
        await testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
      ).to.eq(BigInt(totalUnits))
    })
  },
)
