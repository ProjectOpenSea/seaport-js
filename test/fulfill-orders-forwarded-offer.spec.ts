import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput, OrderWithCounter } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user accepting several bids I want the batch check to know where the proceeds go",
  fixture => {
    let offerer: HardhatEthersSigner
    let zone: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let recipient: HardhatEthersSigner
    let firstBid: OrderWithCounter
    let secondBid: OrderWithCounter

    const bidAmount = parseEther("10")
    // A 250bp fee on each bid is 0.25, so the batch costs the fulfiller 0.5.
    // They hold 0.3: enough for either bid alone, not for both.
    const fulfillerBalance = parseEther("0.3")

    beforeEach(async () => {
      const { ethers, seaport, testErc20, testErc721 } = fixture
      ;[offerer, zone, fulfiller, recipient] = await ethers.getSigners()

      await testErc721.mint(await fulfiller.getAddress(), "301")
      await testErc721.mint(await fulfiller.getAddress(), "302")
      await testErc20.mint(await offerer.getAddress(), bidAmount * 2n)
      await testErc20.mint(await fulfiller.getAddress(), fulfillerBalance)

      const buildBid = async (nftId: string) => {
        const input: CreateOrderInput = {
          startTime: "0",
          offer: [
            {
              token: await testErc20.getAddress(),
              amount: bidAmount.toString(),
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
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        }
        return (
          await seaport.createOrder(input, await offerer.getAddress())
        ).executeAllActions()
      }

      firstBid = await buildBid("301")
      secondBid = await buildBid("302")
    })

    it("reports the shortfall when the batch's proceeds go elsewhere", async () => {
      const { seaport } = fixture

      // The offer never reaches the fulfiller, so both fees come out of the
      // 0.3 they hold. Crediting the batch's own offer here would clear a
      // fulfillment that reverts on transfer.
      await expect(
        seaport.fulfillOrders({
          fulfillOrderDetails: [{ order: firstBid }, { order: secondBid }],
          accountAddress: await fulfiller.getAddress(),
          recipientAddress: await recipient.getAddress(),
        }),
      ).to.be.rejectedWith("The fulfiller does not have the balances needed")
    })

    it("still lets the batch fund its own fees when the proceeds are kept", async () => {
      const { seaport, testErc20 } = fixture

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order: firstBid }, { order: secondBid }],
        accountAddress: await fulfiller.getAddress(),
      })

      for (const action of actions) {
        await (await action.transactionMethods.transact()).wait()
      }

      // 0.3 held, 20 received, 0.5 paid out in fees.
      expect(await testErc20.balanceOf(await fulfiller.getAddress())).to.eq(
        parseEther("19.8"),
      )
    })

    it("still accepts a single order the fulfiller can cover alone", async () => {
      const { seaport } = fixture

      const { actions } = await seaport.fulfillOrder({
        order: firstBid,
        accountAddress: await fulfiller.getAddress(),
        recipientAddress: await recipient.getAddress(),
      })

      expect(actions.length).to.be.greaterThan(0)
    })
  },
)
