import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import { Seaport } from "../src/seaport"
import { LocalConduitController__factory } from "../src/typechain-types/index"
import type {
  ApprovalAction,
  CreateOrderInput,
  OrderWithCounter,
} from "../src/types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want a conduit key to resolve whatever hex case it arrives in",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let seaport: Seaport
    let conduitKey: string
    let conduit: string

    const nftId = "1"
    const price = parseEther("1")

    const upperCased = (key: string) => `0x${key.slice(2).toUpperCase()}`

    beforeEach(async () => {
      const { ethers, seaportContract, testErc721 } = fixture
      ;[offerer, , fulfiller] = await ethers.getSigners()

      // The conduit key has to start with its creator's twenty bytes.
      conduitKey = `${(await offerer.getAddress()).toLowerCase()}${"00".repeat(11)}01`

      const [, , controllerAddress] = await seaportContract.information()
      const controller = LocalConduitController__factory.connect(
        controllerAddress,
        ethers.provider,
      )

      await (
        await controller
          .connect(offerer)
          .createConduit(conduitKey, await offerer.getAddress())
      ).wait()
      ;[conduit] = await controller.getConduit(conduitKey)
      await (
        await controller
          .connect(offerer)
          .updateChannel(conduit, await seaportContract.getAddress(), true)
      ).wait()

      seaport = new Seaport(ethers.provider as never, {
        overrides: { contractAddress: await seaportContract.getAddress() },
        conduitKeyToConduit: { [conduitKey]: conduit },
      })

      await testErc721.mint(await offerer.getAddress(), nftId)
    })

    const listingWithConduit = async (
      key: string,
    ): Promise<CreateOrderInput> => ({
      startTime: "0",
      conduitKey: key,
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

    const createListing = async (key: string): Promise<OrderWithCounter> =>
      (
        await seaport.createOrder(
          await listingWithConduit(key),
          await offerer.getAddress(),
        )
      ).executeAllActions()

    it("approves the conduit when creating with an upper-cased key", async () => {
      const { actions } = await seaport.createOrder(
        await listingWithConduit(upperCased(conduitKey)),
        await offerer.getAddress(),
      )

      const approval = actions[0] as ApprovalAction
      expect(approval.type).to.eq("approval")
      expect(approval.operator).to.eq(conduit)
    })

    it("fulfills an order carrying an upper-cased key", async () => {
      const { testErc721 } = fixture

      const order = await createListing(conduitKey)
      const reCased = {
        ...order,
        parameters: {
          ...order.parameters,
          conduitKey: upperCased(order.parameters.conduitKey),
        },
      }

      const { actions } = await seaport.fulfillOrder({
        order: reCased,
        accountAddress: await fulfiller.getAddress(),
      })

      await (
        await actions[actions.length - 1].transactionMethods.transact()
      ).wait()

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
    })

    it("sources the fulfiller's approvals from an upper-cased key", async () => {
      const { testErc20, testErc721 } = fixture

      // Price the listing in ERC20 so the fulfiller needs an approval of its
      // own, which is what the fulfiller side conduit key decides.
      await testErc20.mint(await fulfiller.getAddress(), price)

      const order = await (
        await seaport.createOrder(
          {
            ...(await listingWithConduit(conduitKey)),
            consideration: [
              {
                amount: price.toString(),
                token: await testErc20.getAddress(),
                recipient: await offerer.getAddress(),
              },
            ],
          },
          await offerer.getAddress(),
        )
      ).executeAllActions()

      const { actions } = await seaport.fulfillOrder({
        order,
        accountAddress: await fulfiller.getAddress(),
        conduitKey: upperCased(conduitKey),
      })

      const approval = actions[0] as ApprovalAction
      expect(approval.type).to.eq("approval")
      expect(approval.operator).to.eq(conduit)

      for (const action of actions) {
        await (await action.transactionMethods.transact()).wait()
      }

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
    })

    it("still resolves a key that matches the configured case", async () => {
      const { testErc721 } = fixture

      const order = await createListing(conduitKey)
      const { actions } = await seaport.fulfillOrder({
        order,
        accountAddress: await fulfiller.getAddress(),
      })

      await (
        await actions[actions.length - 1].transactionMethods.transact()
      ).wait()

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
    })
  },
)
