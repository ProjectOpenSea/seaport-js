import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { TestExtraDataZone } from "../src/typechain-types"
import { describeWithFixture } from "./utils/setup"

describeWithFixture(
  "As a user I want the extraData I pass to fulfillOrder to reach the zone",
  fixture => {
    let offerer: HardhatEthersSigner
    let fulfiller: HardhatEthersSigner
    let zone: TestExtraDataZone
    const extraData = "0x1234abcd"

    beforeEach(async () => {
      const { ethers } = fixture
      ;[offerer, , fulfiller] = await ethers.getSigners()

      const TestExtraDataZone =
        await ethers.getContractFactory("TestExtraDataZone")
      zone = (await TestExtraDataZone.deploy()) as TestExtraDataZone
      await zone.waitForDeployment()
    })

    it("restricted ERC721 <=> ETH listing that would otherwise take the basic route", async () => {
      const { seaport, testErc721 } = fixture
      const nftId = "1"
      await testErc721.mint(await offerer.getAddress(), nftId)

      const { executeAllActions } = await seaport.createOrder({
        startTime: "0",
        zone: await zone.getAddress(),
        restrictedByZone: true,
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
      })
      const order = await executeAllActions()

      const { executeAllActions: fulfill } = await seaport.fulfillOrder({
        order,
        extraData,
        accountAddress: await fulfiller.getAddress(),
      })
      await (await fulfill()).wait()

      expect(await testErc721.ownerOf(nftId)).to.eq(
        await fulfiller.getAddress(),
      )
      expect(await zone.lastExtraData()).to.eq(extraData)
    })

    it("restricted ERC721 bundle <=> ETH listing that would otherwise take fulfillOrder", async () => {
      const { seaport, testErc721 } = fixture
      await testErc721.mint(await offerer.getAddress(), "1")
      await testErc721.mint(await offerer.getAddress(), "2")

      const { executeAllActions } = await seaport.createOrder({
        startTime: "0",
        zone: await zone.getAddress(),
        restrictedByZone: true,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: "1",
          },
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: "2",
          },
        ],
        consideration: [
          {
            amount: parseEther("2").toString(),
            recipient: await offerer.getAddress(),
          },
        ],
      })
      const order = await executeAllActions()

      const { executeAllActions: fulfill } = await seaport.fulfillOrder({
        order,
        extraData,
        accountAddress: await fulfiller.getAddress(),
      })
      await (await fulfill()).wait()

      expect(await testErc721.ownerOf("1")).to.eq(await fulfiller.getAddress())
      expect(await testErc721.ownerOf("2")).to.eq(await fulfiller.getAddress())
      expect(await zone.lastExtraData()).to.eq(extraData)
    })
  },
)
