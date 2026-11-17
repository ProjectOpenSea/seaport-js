import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther, ZeroHash } from "ethers"
import { ItemType, OrderType } from "../src/constants"
import type { OrderWithCounter } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want a clear error when I ask for part of an order that cannot be split",
  fixture => {
    let offerer: HardhatEthersSigner
    let secondOfferer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let order: OrderWithCounter
    let otherOrder: OrderWithCounter

    const nftId = "1"
    const totalUnits = 10
    const price = parseEther("10")

    beforeEach(async () => {
      const { ethers, seaport, testErc1155, testErc721 } = fixture
      ;[offerer, secondOfferer, fulfiller] = await ethers.getSigners()

      await testErc1155.mint(offerer.address, nftId, totalUnits)
      await testErc721.mint(secondOfferer.address, nftId)

      // No allowPartialFills, so the order is FULL_OPEN.
      order = await (
        await seaport.createOrder(
          {
            startTime: "0",
            offer: [
              {
                itemType: ItemType.ERC1155,
                token: await testErc1155.getAddress(),
                identifier: nftId,
                amount: String(totalUnits),
              },
            ],
            consideration: [
              { amount: price.toString(), recipient: offerer.address },
            ],
          },
          offerer.address,
        )
      ).executeAllActions()
      expect(order.parameters.orderType).to.eq(OrderType.FULL_OPEN)

      otherOrder = await (
        await seaport.createOrder(
          {
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
                amount: parseEther("1").toString(),
                recipient: secondOfferer.address,
              },
            ],
          },
          secondOfferer.address,
        )
      ).executeAllActions()
    })

    it("is refused onchain by Seaport when half of it is submitted", async () => {
      const { seaportContract } = fixture

      await expect(
        seaportContract.connect(fulfiller).fulfillAdvancedOrder(
          {
            parameters: order.parameters,
            numerator: 1,
            denominator: 2,
            signature: order.signature,
            extraData: "0x",
          },
          [],
          ZeroHash,
          fulfiller.address,
          { value: parseEther("5") },
        ),
      ).to.be.revertedWithCustomError(
        seaportContract,
        "PartialFillsNotEnabledForOrder",
      )
    })

    it("rejects unitsToFill short of the whole order in fulfillOrder", async () => {
      const { seaport } = fixture

      await expect(
        seaport.fulfillOrder({
          order,
          unitsToFill: 5,
          accountAddress: fulfiller.address,
        }),
      ).to.be.rejectedWith(
        "Cannot fill 5 of 10 units: this order does not allow partial fills, so it can only be filled whole.",
      )
    })

    it("rejects unitsToFill short of the whole order in fulfillOrders", async () => {
      const { seaport } = fixture

      await expect(
        seaport.fulfillOrders({
          fulfillOrderDetails: [
            { order, unitsToFill: 5 },
            { order: otherOrder },
          ],
          accountAddress: fulfiller.address,
        }),
      ).to.be.rejectedWith(
        "Cannot fill 5 of 10 units: this order does not allow partial fills, so it can only be filled whole.",
      )
    })

    it("still fills the whole order when unitsToFill asks for all of it", async () => {
      const { seaport, testErc1155 } = fixture

      const { actions } = await seaport.fulfillOrder({
        order,
        unitsToFill: totalUnits,
        accountAddress: fulfiller.address,
      })
      const fulfillAction = actions[actions.length - 1]

      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transaction.value).to.eq(price)

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(await testErc1155.balanceOf(fulfiller.address, nftId)).to.eq(
        BigInt(totalUnits),
      )
    })

    it("still fills the whole order next to another one in fulfillOrders", async () => {
      const { seaport, testErc1155, testErc721 } = fixture

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [
          { order, unitsToFill: totalUnits },
          { order: otherOrder },
        ],
        accountAddress: fulfiller.address,
      })
      const fulfillAction = actions[actions.length - 1]

      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transaction.value).to.eq(price + parseEther("1"))

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(await testErc1155.balanceOf(fulfiller.address, nftId)).to.eq(
        BigInt(totalUnits),
      )
      expect(await testErc721.ownerOf(nftId)).to.eq(fulfiller.address)
    })
  },
)
