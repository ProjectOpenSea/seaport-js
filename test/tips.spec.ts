import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput } from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a fulfiller I want to tip in a token the order does not carry",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let tipRecipient: HardhatEthersSigner
    let erc20Listing: CreateOrderInput
    const nftId = "1"
    const listingPrice = parseEther("10")
    const tipAmount = parseEther("1")

    beforeEach(async () => {
      const { ethers, testErc20, testErc721 } = fixture
      ;[offerer, , fulfiller, tipRecipient] = await ethers.getSigners()

      await testErc721.mint(await offerer.getAddress(), nftId)
      await testErc20.mint(await fulfiller.getAddress(), listingPrice)

      erc20Listing = {
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
            amount: listingPrice.toString(),
            token: await testErc20.getAddress(),
            recipient: await offerer.getAddress(),
          },
        ],
      }
    })

    it("surfaces the approval a second ERC20 tip needs", async () => {
      const { seaport, testErc20, testErc20USDC, testErc721 } = fixture

      await testErc20USDC.mint(await fulfiller.getAddress(), tipAmount)

      const { executeAllActions } = await seaport.createOrder(
        erc20Listing,
        await offerer.getAddress(),
      )
      const order = await executeAllActions()

      const { actions } = await seaport.fulfillOrder({
        order,
        accountAddress: await fulfiller.getAddress(),
        tips: [
          {
            amount: tipAmount.toString(),
            token: await testErc20USDC.getAddress(),
            recipient: await tipRecipient.getAddress(),
          },
        ],
      })

      // The tip is paid by the fulfiller in a token the order never mentions,
      // so it needs an approval of its own next to the listing currency's.
      // Without it the fulfillment would revert on the tip transfer.
      const approvalActions = actions.filter(
        action => action.type === "approval",
      )

      expect(approvalActions.map(action => action.token)).to.have.members([
        await testErc20.getAddress(),
        await testErc20USDC.getAddress(),
      ])

      for (const approvalAction of approvalActions) {
        await approvalAction.transactionMethods.transact()
      }

      const fulfillAction = actions[actions.length - 1]
      const transaction = await fulfillAction.transactionMethods.transact()
      await transaction.wait()

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
      expect(
        await testErc20USDC.balanceOf(await tipRecipient.getAddress()),
      ).to.eq(tipAmount)
    })

    it("carries a native tip as msg.value through fulfillOrders", async () => {
      const { ethers, seaport, testErc721 } = fixture

      const { executeAllActions } = await seaport.createOrder(
        erc20Listing,
        await offerer.getAddress(),
      )
      const order = await executeAllActions()

      const { actions } = await seaport.fulfillOrders({
        fulfillOrderDetails: [
          {
            order,
            tips: [
              {
                amount: tipAmount.toString(),
                recipient: await tipRecipient.getAddress(),
              },
            ],
          },
        ],
        accountAddress: await fulfiller.getAddress(),
      })

      const approvalAction = actions[0]
      expect(approvalAction.type).to.eq("approval")
      await approvalAction.transactionMethods.transact()

      // The listing is priced in ERC20, so the tip is the order's only native
      // item and has to be carried as msg.value.
      const fulfillAction = actions[actions.length - 1]
      const transactionRequest =
        await fulfillAction.transactionMethods.buildTransaction()
      expect(transactionRequest.value).to.eq(tipAmount)

      const balanceBefore = await ethers.provider.getBalance(
        await tipRecipient.getAddress(),
      )

      const transaction = await fulfillAction.transactionMethods.transact()
      await transaction.wait()

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
      expect(
        (await ethers.provider.getBalance(await tipRecipient.getAddress())) -
          balanceBefore,
      ).to.eq(tipAmount)
    })
  },
)
