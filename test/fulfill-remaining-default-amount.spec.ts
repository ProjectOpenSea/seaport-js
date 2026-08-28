import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput } from "../src/types"
import { describeWithFixture } from "./utils/setup"

// mapOrderAmountsFromFilledStatus is what runs on the default "fill whatever
// is left" path (no unitsToFill passed in). Its sibling mapOrderAmountsFromUnitsToFill
// scales amounts with a single exact division; this one used to go through a
// basis points detour instead, which loses precision whenever totalSize does
// not divide evenly into basis points. 9 ETH over 3 units, with 1 unit
// already taken, leaves a remaining fraction of 2/3, which basis points
// cannot represent exactly (6666 bp, not 6666.67), so the old code sent
// 5.9994 ETH instead of the 6 ETH the contract actually requires and reverted
// with InsufficientNativeTokensSupplied.
describeWithFixture(
  "As a user I want the default fill-remaining path to send the exact amount owed",
  fixture => {
    let offerer: HardhatEthersSigner
    let firstFulfiller: HardhatEthersSigner
    let secondFulfiller: HardhatEthersSigner

    const totalUnits = 3
    // 9, not 10: gcd(3, 9 ETH in wei) is 3, so the order is genuinely
    // divisible into thirds instead of collapsing to a single fillable unit.
    const price = parseEther("9")

    const listing = async (nftId: string): Promise<CreateOrderInput> => ({
      startTime: "0",
      allowPartialFills: true,
      offer: [
        {
          itemType: ItemType.ERC1155,
          token: await fixture.testErc1155.getAddress(),
          identifier: nftId,
          amount: String(totalUnits),
        },
      ],
      consideration: [
        { amount: price.toString(), recipient: await offerer.getAddress() },
      ],
    })

    beforeEach(async () => {
      const { ethers } = fixture
      ;[offerer, , firstFulfiller, secondFulfiller] = await ethers.getSigners()
    })

    it("builds a transaction whose value is the exact remaining native amount, not a basis points approximation", async () => {
      const { seaport, testErc1155 } = fixture
      const nftId = "1"

      await testErc1155.mint(await offerer.getAddress(), nftId, totalUnits)
      const order = await (
        await seaport.createOrder(await listing(nftId))
      ).executeAllActions()

      // First fulfiller explicitly takes 1 of 3 units, leaving 2/3 remaining.
      const first = await seaport.fulfillOrder({
        order,
        unitsToFill: 1,
        accountAddress: await firstFulfiller.getAddress(),
      })
      for (const action of first.actions) {
        await (await action.transactionMethods.transact()).wait()
      }

      const orderHash = seaport.getOrderHash(order.parameters)
      const status = await seaport.getOrderStatus(orderHash)

      // Exact remaining fraction: 2/3 of 9 ETH = 6 ETH.
      const exactRemaining =
        (price * (status.totalSize - status.totalFilled)) / status.totalSize
      expect(exactRemaining).to.eq(parseEther("6"))

      const { actions } = await seaport.fulfillOrder({
        order,
        accountAddress: await secondFulfiller.getAddress(),
      })
      const fulfillAction = actions[actions.length - 1]
      const transaction =
        await fulfillAction.transactionMethods.buildTransaction()

      expect(transaction.value).to.eq(exactRemaining)

      await (await fulfillAction.transactionMethods.transact()).wait()

      expect(
        await testErc1155.balanceOf(await secondFulfiller.getAddress(), nftId),
      ).to.eq(2n)
    })

    // The actual ERC20 transfer amount is decided on chain by Seaport's own
    // numerator/denominator math, not by the SDK's local estimate, so it is
    // correct either way and cannot show this bug. exactApproval routes the
    // SDK's estimate into a real approve() call instead, which is where an
    // under counted amount is actually observable: the approval this issues
    // would come up short of what the contract goes on to pull.
    it("with exactApproval approves the exact remaining amount, not a basis points approximation", async () => {
      const { seaport, testErc1155, testErc20 } = fixture
      const nftId = "2"
      const operator = await seaport.contract.getAddress()

      await testErc1155.mint(await offerer.getAddress(), nftId, totalUnits)
      await testErc20.mint(await firstFulfiller.getAddress(), price)
      await testErc20.mint(await secondFulfiller.getAddress(), price)

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
          {
            amount: price.toString(),
            token: await testErc20.getAddress(),
            recipient: await offerer.getAddress(),
          },
        ],
      }

      const order = await (await seaport.createOrder(input)).executeAllActions()

      const first = await seaport.fulfillOrder({
        order,
        unitsToFill: 1,
        accountAddress: await firstFulfiller.getAddress(),
      })
      for (const action of first.actions) {
        await (await action.transactionMethods.transact()).wait()
      }

      const orderHash = seaport.getOrderHash(order.parameters)
      const status = await seaport.getOrderStatus(orderHash)
      const exactRemaining =
        (price * (status.totalSize - status.totalFilled)) / status.totalSize
      expect(exactRemaining).to.eq(parseEther("6"))

      const { actions } = await seaport.fulfillOrder({
        order,
        accountAddress: await secondFulfiller.getAddress(),
        exactApproval: true,
      })

      const approvalAction = actions.find(action => action.type === "approval")
      expect(approvalAction, "expected an approval action").to.not.be.undefined
      await (await approvalAction!.transactionMethods.transact()).wait()

      const approvedAmount = await testErc20.allowance(
        await secondFulfiller.getAddress(),
        operator,
      )
      expect(approvedAmount).to.eq(exactRemaining)
    })
  },
)
