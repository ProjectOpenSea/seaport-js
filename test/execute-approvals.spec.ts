import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType, MAX_INT } from "../src/constants"
import type {
  ApprovalAction,
  CreateBulkOrdersAction,
  CreateOrderAction,
} from "../src/types"
import { generateRandomSalt } from "../src/utils/order"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want to approve an order onchain instead of signing it",
  fixture => {
    it("exposes the built order components without requesting a signature", async () => {
      const { seaport, testErc721, ethers } = fixture

      const [offerer, zone] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)
      const salt = generateRandomSalt()

      const useCase = await seaport.createOrder({
        startTime: "0",
        endTime: MAX_INT.toString(),
        salt,
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
        fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
      })

      const createOrderAction = useCase.actions[
        useCase.actions.length - 1
      ] as CreateOrderAction

      // The exposed components must be the same order signOrder would sign.
      const signed = await createOrderAction.createOrder()
      expect(createOrderAction.orderComponents).to.deep.equal(signed.parameters)
    })

    it("runs approvals without performing the final action", async () => {
      const { seaportContract, seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      const useCase = await seaport.createOrder({
        startTime: "0",
        endTime: MAX_INT.toString(),
        salt: generateRandomSalt(),
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
      })

      const approvalAction = useCase.actions[0] as ApprovalAction
      expect(approvalAction.type).to.equal("approval")
      expect(
        await testErc721.isApprovedForAll(
          await offerer.getAddress(),
          await seaportContract.getAddress(),
        ),
      ).to.be.false

      await useCase.executeApprovals()

      expect(
        await testErc721.isApprovedForAll(
          await offerer.getAddress(),
          await seaportContract.getAddress(),
        ),
      ).to.be.true
    })

    it("validates the order onchain from the exposed components", async () => {
      const { seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      const useCase = await seaport.createOrder({
        startTime: "0",
        endTime: MAX_INT.toString(),
        salt: generateRandomSalt(),
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
      })

      await useCase.executeApprovals()

      const { orderComponents } = useCase.actions[
        useCase.actions.length - 1
      ] as CreateOrderAction

      const orderHash = seaport.getOrderHash(orderComponents)
      expect((await seaport.getOrderStatus(orderHash)).isValidated).to.be.false

      // An empty signature is what makes this worth having: Seaport takes the
      // offerer sending the transaction as proof they approved the order.
      const transaction = await seaport
        .validate(
          [{ parameters: orderComponents, signature: "0x" }],
          await offerer.getAddress(),
        )
        .transact()
      await transaction.wait()

      expect((await seaport.getOrderStatus(orderHash)).isValidated).to.be.true
    })

    it("exposes components for every order in a bulk use case, in input order", async () => {
      const { seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      await testErc721.mint(await offerer.getAddress(), "1")
      await testErc721.mint(await offerer.getAddress(), "2")

      const inputs = ["1", "2"].map(identifier => ({
        startTime: "0",
        endTime: MAX_INT.toString(),
        salt: generateRandomSalt(),
        offer: [
          {
            itemType: ItemType.ERC721 as const,
            token: testErc721.target as string,
            identifier,
          },
        ],
        consideration: [
          {
            amount: parseEther("10").toString(),
            recipient: offerer.address,
          },
        ],
      }))

      const useCase = await seaport.createBulkOrders(inputs)
      const bulkAction = useCase.actions[
        useCase.actions.length - 1
      ] as CreateBulkOrdersAction

      expect(bulkAction.orderComponents).to.have.lengthOf(2)
      expect(
        bulkAction.orderComponents.map(
          components => components.offer[0].identifierOrCriteria,
        ),
      ).to.deep.equal(["1", "2"])

      const signed = await bulkAction.createBulkOrders()
      expect(bulkAction.orderComponents).to.deep.equal(
        signed.map(order => order.parameters),
      )
    })
  },
)
