import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther } from "ethers"
import { ItemType } from "../src/constants"
import type { OrderWithCounter } from "../src/types"
import { getTagFromDomain } from "../src/utils/usecase"
import { OPENSEA_DOMAIN } from "./utils/constants"
import { describeWithFixture } from "./utils/setup"

describeWithFixture("estimateGas on a domain tagged call", fixture => {
  let offerer: HardhatEthersSigner
  let order: OrderWithCounter

  beforeEach(async () => {
    const { ethers, seaport, testErc721 } = fixture
    ;[offerer] = await ethers.getSigners()

    await testErc721.mint(await offerer.getAddress(), "1")

    const { executeAllActions } = await seaport.createOrder({
      startTime: "0",
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: "1",
        },
      ],
      consideration: [
        {
          amount: parseEther("1").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
    })

    order = await executeAllActions()
  })

  it("covers the gas the appended domain tag costs", async () => {
    const { seaport } = fixture

    const methods = seaport.validate(
      [order],
      await offerer.getAddress(),
      OPENSEA_DOMAIN,
    )

    // The tag rides along on the calldata transact sends, so the estimate has
    // to account for it or it cannot be used as a gas limit.
    const transaction = await methods.buildTransaction()
    expect(transaction.data).to.match(
      new RegExp(`${getTagFromDomain(OPENSEA_DOMAIN)}$`),
    )

    const estimate = await methods.estimateGas()
    const receipt = await (await methods.transact()).wait()

    expect(estimate).to.be.gte(receipt!.gasUsed)
  })

  it("leaves an untagged call estimating the same as before", async () => {
    const { seaport } = fixture

    const methods = seaport.validate([order], await offerer.getAddress())

    const estimate = await methods.estimateGas()
    const receipt = await (await methods.transact()).wait()

    expect(estimate).to.be.gte(receipt!.gasUsed)
  })
})
