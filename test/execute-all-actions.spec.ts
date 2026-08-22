import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want to wait on the transaction a fulfillment sends",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner

    const price = parseEther("1")

    beforeEach(async () => {
      const { ethers } = fixture
      ;[offerer, , fulfiller] = await ethers.getSigners()
    })

    const erc721Listing = async (nftId: string): Promise<CreateOrderInput> => ({
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

    it("hands back a sent transaction from the basic route", async () => {
      const { seaport, testErc721 } = fixture
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      const order = await (
        await seaport.createOrder(await erc721Listing(nftId))
      ).executeAllActions()

      const { executeAllActions } = await seaport.fulfillOrder({
        order,
        accountAddress: await fulfiller.getAddress(),
      })

      const transaction = await executeAllActions()
      const receipt = await transaction.wait()

      expect(transaction.hash).to.match(/^0x[0-9a-f]{64}$/)
      expect(receipt?.status).to.eq(1)
      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
    })

    it("hands back a sent transaction from the advanced route", async () => {
      const { seaport, testErc1155 } = fixture
      const nftId = "1"
      await testErc1155.mint(await offerer.getAddress(), nftId, 10)

      const order = await (
        await seaport.createOrder({
          startTime: "0",
          allowPartialFills: true,
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: await testErc1155.getAddress(),
              identifier: nftId,
              amount: "10",
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              recipient: await offerer.getAddress(),
            },
          ],
        })
      ).executeAllActions()

      const { executeAllActions } = await seaport.fulfillOrder({
        order,
        unitsToFill: 4,
        accountAddress: await fulfiller.getAddress(),
      })

      const receipt = await (await executeAllActions()).wait()

      expect(receipt?.status).to.eq(1)
      expect(
        await testErc1155.balanceOf(await fulfiller.getAddress(), nftId),
      ).to.eq(4n)
    })

    it("hands back a sent transaction from a batch fulfillment", async () => {
      const { seaport, testErc721 } = fixture
      const first = "1"
      const second = "2"
      await testErc721.mint(await offerer.getAddress(), first)
      await testErc721.mint(await offerer.getAddress(), second)

      const orders = []
      for (const nftId of [first, second]) {
        orders.push(
          await (
            await seaport.createOrder(await erc721Listing(nftId))
          ).executeAllActions(),
        )
      }

      const { executeAllActions } = await seaport.fulfillOrders({
        fulfillOrderDetails: orders.map(order => ({ order })),
        accountAddress: await fulfiller.getAddress(),
      })

      const receipt = await (await executeAllActions()).wait()

      expect(receipt?.status).to.eq(1)
      expect(await testErc721.ownerOf(first)).to.eq(
        await fulfiller.getAddress(),
      )
      expect(await testErc721.ownerOf(second)).to.eq(
        await fulfiller.getAddress(),
      )
    })
  },
)
