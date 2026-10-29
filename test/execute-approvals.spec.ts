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

    it("rejects exactApproval for an unapproved criteria-based ERC721", async () => {
      const { seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      await expect(
        seaport.createOrder(
          {
            startTime: "0",
            endTime: MAX_INT.toString(),
            salt: generateRandomSalt(),
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifiers: [nftId],
              },
            ],
            consideration: [
              {
                amount: parseEther("10").toString(),
                recipient: await offerer.getAddress(),
              },
            ],
          },
          await offerer.getAddress(),
          true,
        ),
      ).to.be.rejectedWith(
        "Exact approval is not available for a criteria-based ERC721 order",
      )
    })

    it("allows exactApproval for a criteria-based ERC721 already approved for all", async () => {
      const { seaportContract, seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)
      await testErc721.setApprovalForAll(
        await seaportContract.getAddress(),
        true,
      )

      const useCase = await seaport.createOrder(
        {
          startTime: "0",
          endTime: MAX_INT.toString(),
          salt: generateRandomSalt(),
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifiers: [nftId],
            },
          ],
          consideration: [
            {
              amount: parseEther("10").toString(),
              recipient: await offerer.getAddress(),
            },
          ],
        },
        await offerer.getAddress(),
        true,
      )

      expect(useCase.actions).to.have.lengthOf(1)
      expect(useCase.actions[0].type).to.equal("create")
    })

    it("rejects exactApproval for a criteria-based ERC721 in a bulk order", async () => {
      const { seaport, testErc721, ethers } = fixture

      const [offerer] = await ethers.getSigners()
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      await expect(
        seaport.createBulkOrders(
          [
            {
              startTime: "0",
              endTime: MAX_INT.toString(),
              salt: generateRandomSalt(),
              offer: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  identifiers: [nftId],
                },
              ],
              consideration: [
                {
                  amount: parseEther("10").toString(),
                  recipient: await offerer.getAddress(),
                },
              ],
            },
          ],
          await offerer.getAddress(),
          true,
        ),
      ).to.be.rejectedWith(
        "Exact approval is not available for a criteria-based ERC721 order",
      )
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

    describe("an ERC721 approved one token at a time by exactApproval", () => {
      const nftId = "1"

      // Lists nftId with exactApproval, which approves Seaport for that one
      // token only, and leaves the collection unapproved.
      const createExactApprovalListing = async () => {
        const { seaport, seaportContract, testErc721, ethers } = fixture
        const [offerer] = await ethers.getSigners()
        await testErc721.mint(await offerer.getAddress(), nftId)

        const useCase = await seaport.createOrder(
          {
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
                recipient: await offerer.getAddress(),
              },
            ],
          },
          await offerer.getAddress(),
          true,
        )
        const order = await useCase.executeAllActions()

        const seaportAddress = await seaportContract.getAddress()
        expect(await testErc721.getApproved(nftId)).to.equal(seaportAddress)
        expect(
          await testErc721.isApprovedForAll(
            await offerer.getAddress(),
            seaportAddress,
          ),
        ).to.be.false

        return order
      }

      it("fulfills the listing through fulfillOrder on the basic route", async () => {
        const { seaport, seaportContract, testErc721, ethers } = fixture
        const [, fulfiller] = await ethers.getSigners()
        const order = await createExactApprovalListing()

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
        })
        expect(actions).to.have.lengthOf(1)
        const tx = await actions[0].transactionMethods.buildTransaction()
        expect(seaportContract.interface.parseTransaction(tx)?.name).to.equal(
          "fulfillBasicOrder",
        )
        await (await actions[0].transactionMethods.transact()).wait()

        expect(await testErc721.ownerOf(nftId)).to.equal(
          await fulfiller.getAddress(),
        )
      })

      it("fulfills the listing through fulfillOrder on the standard route", async () => {
        const { seaport, seaportContract, testErc721, ethers } = fixture
        const [, fulfiller, recipient] = await ethers.getSigners()
        const order = await createExactApprovalListing()

        const { actions } = await seaport.fulfillOrder({
          order,
          accountAddress: await fulfiller.getAddress(),
          recipientAddress: await recipient.getAddress(),
        })
        expect(actions).to.have.lengthOf(1)
        const tx = await actions[0].transactionMethods.buildTransaction()
        expect(seaportContract.interface.parseTransaction(tx)?.name).to.equal(
          "fulfillAdvancedOrder",
        )
        await (await actions[0].transactionMethods.transact()).wait()

        expect(await testErc721.ownerOf(nftId)).to.equal(
          await recipient.getAddress(),
        )
      })

      it("fulfills the listing through fulfillOrders", async () => {
        const { seaport, testErc721, ethers } = fixture
        const [, fulfiller] = await ethers.getSigners()
        const order = await createExactApprovalListing()

        const { executeAllActions } = await seaport.fulfillOrders({
          fulfillOrderDetails: [{ order }],
          accountAddress: await fulfiller.getAddress(),
        })
        await executeAllActions()

        expect(await testErc721.ownerOf(nftId)).to.equal(
          await fulfiller.getAddress(),
        )
      })

      it("does not ask to approve the token again for a second listing", async () => {
        const { seaport, testErc721, ethers } = fixture
        const [offerer] = await ethers.getSigners()
        await createExactApprovalListing()

        const useCase = await seaport.createOrder(
          {
            offer: [
              {
                itemType: ItemType.ERC721,
                token: await testErc721.getAddress(),
                identifier: nftId,
              },
            ],
            consideration: [
              {
                amount: parseEther("2").toString(),
                recipient: await offerer.getAddress(),
              },
            ],
          },
          await offerer.getAddress(),
          true,
        )

        expect(useCase.actions.map(({ type }) => type)).to.deep.equal([
          "create",
        ])
      })

      it("does not ask the fulfiller to approve a criteria token it already approved", async () => {
        const { seaport, seaportContract, testErc721, testErc20, ethers } =
          fixture
        const [offerer, fulfiller] = await ethers.getSigners()
        await testErc721.mint(await fulfiller.getAddress(), nftId)
        await testErc20.mint(await offerer.getAddress(), parseEther("1"))
        await testErc721
          .connect(fulfiller)
          .approve(await seaportContract.getAddress(), nftId)

        // A collection offer: any token of the collection.
        const order = await (
          await seaport.createOrder(
            {
              offer: [
                {
                  amount: parseEther("1").toString(),
                  token: await testErc20.getAddress(),
                },
              ],
              consideration: [
                {
                  itemType: ItemType.ERC721,
                  token: await testErc721.getAddress(),
                  identifiers: [],
                  recipient: await offerer.getAddress(),
                },
              ],
            },
            await offerer.getAddress(),
          )
        ).executeAllActions()

        const { actions, executeAllActions } = await seaport.fulfillOrder({
          order,
          considerationCriteria: [{ identifier: nftId, proof: [] }],
          accountAddress: await fulfiller.getAddress(),
          exactApproval: true,
        })
        expect(actions.map(({ type }) => type)).to.deep.equal(["exchange"])

        await executeAllActions()
        expect(await testErc721.ownerOf(nftId)).to.equal(
          await offerer.getAddress(),
        )
      })

      it("still asks for an approval when the token is approved for another operator", async () => {
        const { seaport, testErc721, ethers } = fixture
        const [offerer, otherOperator] = await ethers.getSigners()
        await testErc721.mint(await offerer.getAddress(), nftId)
        await testErc721.approve(await otherOperator.getAddress(), nftId)

        const useCase = await seaport.createOrder(
          {
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
                recipient: await offerer.getAddress(),
              },
            ],
          },
          await offerer.getAddress(),
          true,
        )

        expect(useCase.actions.map(({ type }) => type)).to.deep.equal([
          "approval",
          "create",
        ])
      })
    })
  },
)
