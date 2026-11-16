import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types"
import { expect } from "chai"
import { parseEther, ZeroHash } from "ethers"
import { ItemType } from "../src/constants"
import type { CreateOrderInput } from "../src/types"
import { getTransactionMethods } from "../src/utils/usecase"
import { OVERRIDE_GAS_LIMIT } from "./utils/constants"
import { describeWithFixture } from "./utils/setup"

describeWithFixture("As a user I want to cancel an order", fixture => {
  let offerer: HardhatEthersSigner
  let zone: HardhatEthersSigner
  let fulfiller: HardhatEthersSigner
  let secondOfferer: HardhatEthersSigner
  let standardCreateOrderInput: CreateOrderInput
  const nftId = "1"

  beforeEach(async () => {
    const { ethers } = fixture
    ;[offerer, zone, fulfiller, secondOfferer] = await ethers.getSigners()
  })

  beforeEach(async () => {
    const { testErc721 } = fixture

    await testErc721.mint(await offerer.getAddress(), nftId)

    standardCreateOrderInput = {
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
          amount: parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    }
  })

  it("validate then bulk cancel orders", async () => {
    const { seaport } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const executeAllActionsOnChainOrder = (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions

    const offChainOrder = await executeAllActions()
    const onChainOrder = await executeAllActionsOnChainOrder()

    // Remove signature
    onChainOrder.signature = "0x"

    const overrides = { gasLimit: OVERRIDE_GAS_LIMIT }

    const validateTx = await seaport
      .validate(
        [onChainOrder],
        await offerer.getAddress(),
        undefined,
        overrides,
      )
      .transact()
    expect(validateTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT)

    const bulkCancelOrdersTx = await seaport
      .bulkCancelOrders(await offerer.getAddress(), undefined, overrides)
      .transact()
    expect(bulkCancelOrdersTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT)

    await expect(
      seaport.fulfillOrder({
        order: offChainOrder,
        accountAddress: await fulfiller.getAddress(),
      }),
    ).to.be.rejectedWith("The order you are trying to fulfill is cancelled")

    await expect(
      seaport.fulfillOrder({
        order: onChainOrder,
        accountAddress: await fulfiller.getAddress(),
      }),
    ).to.be.rejectedWith("The order you are trying to fulfill is cancelled")

    expect(
      (await seaport.getCounter(await offerer.getAddress())) >
        BigInt(offChainOrder.parameters.counter),
    ).to.be.true
  })

  it("is refused onchain for an order signed under the old counter", async () => {
    const { seaport, seaportContract } = fixture

    const order = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()
    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()

    const value = order.parameters.consideration.reduce(
      (sum, { endAmount }) => sum + BigInt(endAmount),
      0n,
    )
    await expect(
      seaportContract
        .connect(fulfiller)
        .fulfillOrder(order, ZeroHash, { value }),
    ).to.be.revertedWithCustomError(seaportContract, "InvalidSigner")
  })

  it("rejects an order cancelled by bulkCancelOrders in fulfillOrder", async () => {
    const { seaport } = fixture

    const order = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()
    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()

    await expect(
      seaport.fulfillOrder({ order, accountAddress: fulfiller.address }),
    ).to.be.rejectedWith("The order you are trying to fulfill is cancelled")
  })

  it("drops an order cancelled by bulkCancelOrders from fulfillOrders and fills the rest", async () => {
    const { seaport, testErc721 } = fixture

    const staleOrder = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()
    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()

    const liveNftId = "2"
    await testErc721.mint(secondOfferer.address, liveNftId)
    const liveOrder = await (
      await seaport.createOrder(
        {
          ...standardCreateOrderInput,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: liveNftId,
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

    const { actions } = await seaport.fulfillOrders({
      fulfillOrderDetails: [{ order: staleOrder }, { order: liveOrder }],
      accountAddress: fulfiller.address,
    })
    const fulfillAction = actions[actions.length - 1]

    // Only the live order is paid for.
    const transaction =
      await fulfillAction.transactionMethods.buildTransaction()
    expect(transaction.value).to.eq(parseEther("1"))

    await (await fulfillAction.transactionMethods.transact()).wait()

    expect(await testErc721.ownerOf(liveNftId)).to.eq(fulfiller.address)
    expect(await testErc721.ownerOf(nftId)).to.eq(offerer.address)
  })

  it("still fills an order signed after bulkCancelOrders", async () => {
    const { seaport, testErc721 } = fixture

    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()
    const order = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()

    const { executeAllActions } = await seaport.fulfillOrder({
      order,
      accountAddress: fulfiller.address,
    })
    await executeAllActions()

    expect(await testErc721.ownerOf(nftId)).to.eq(fulfiller.address)
  })

  it("still fills an order the offerer validated again after bulkCancelOrders", async () => {
    const { seaport, testErc721 } = fixture

    const order = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()
    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()

    // Seaport validates under the current counter and skips the signature check
    // when the offerer calls, so the order is live again.
    await (await seaport.validate([order], offerer.address).transact()).wait()

    const { executeAllActions } = await seaport.fulfillOrder({
      order,
      accountAddress: fulfiller.address,
    })
    await executeAllActions()

    expect(await testErc721.ownerOf(nftId)).to.eq(fulfiller.address)
  })

  it("still lets the offerer fill their own order after bulkCancelOrders", async () => {
    const { seaport } = fixture

    const order = await (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions()
    await (await seaport.bulkCancelOrders(offerer.address).transact()).wait()

    // Seaport skips the signature check when the offerer is the caller, so the
    // order still settles, under the hash for the current counter.
    const { executeAllActions } = await seaport.fulfillOrder({
      order,
      accountAddress: offerer.address,
    })
    await executeAllActions()

    const counter = await seaport.getCounter(offerer.address)
    const status = await seaport.getOrderStatus(
      seaport.getOrderHash({
        ...order.parameters,
        counter: counter.toString(),
      }),
    )
    expect(status.totalFilled).to.eq(1n)
    expect(status.totalSize).to.eq(1n)
  })

  it("validate then cancel single order", async () => {
    const { seaport } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    // Remove signature
    order.signature = "0x"

    await seaport.validate([order], await offerer.getAddress()).transact()
    const orderHash = seaport.getOrderHash(order.parameters)
    expect(await seaport.getOrderStatus(orderHash)).to.have.property(
      "isValidated",
      true,
    )

    const overrides = { gasLimit: OVERRIDE_GAS_LIMIT }
    const cancelOrdersTx = await seaport
      .cancelOrders(
        [order.parameters],
        await offerer.getAddress(),
        undefined,
        overrides,
      )
      .transact()
    expect(await seaport.getOrderStatus(orderHash)).to.have.property(
      "isCancelled",
      true,
    )
    expect(cancelOrdersTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT)
  })

  it("treats empty overrides as a no-op", async () => {
    const { seaport } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    const tx = await seaport
      .cancelOrders(
        [order.parameters],
        await offerer.getAddress(),
        undefined,
        {},
      )
      .buildTransaction()

    expect(tx.to).to.equal(await fixture.seaportContract.getAddress())
  })

  it("handles from and chainId transaction overrides", async () => {
    const { seaport } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    const tx = await seaport
      .cancelOrders([order.parameters], await offerer.getAddress(), undefined, {
        from: await offerer.getAddress(),
        chainId: 31337,
      })
      .buildTransaction()

    expect(tx.to).to.equal(await fixture.seaportContract.getAddress())
    expect(tx.from).to.equal(await offerer.getAddress())
    expect(tx.chainId).to.equal(31337n)
  })

  it("does not mutate caller arguments array or fail on frozen arguments", async () => {
    const { seaport, ethers } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    const overrides = { from: await offerer.getAddress() }
    const args = Object.freeze([[order.parameters], overrides])

    const methods = getTransactionMethods(
      ethers.getSigner(await offerer.getAddress()),
      fixture.seaportContract,
      "cancel",
      args as any,
    )

    const tx = await methods.buildTransaction()
    expect(tx.from).to.equal(await offerer.getAddress())
    expect(args).to.have.length(2)
  })

  it("leaves a mutable caller arguments array intact", async () => {
    const { seaport, ethers } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    const overrides = { gasLimit: OVERRIDE_GAS_LIMIT }
    const args = [[order.parameters], overrides]

    await getTransactionMethods(
      ethers.getSigner(await offerer.getAddress()),
      fixture.seaportContract,
      "cancel",
      args as any,
    ).buildTransaction()

    expect(args).to.deep.equal([[order.parameters], overrides])
  })

  it("treats an authorizationList as an override", async () => {
    const { seaport } = fixture

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    )
    const order = await executeAllActions()

    const tx = await seaport
      .cancelOrders([order.parameters], await offerer.getAddress(), undefined, {
        authorizationList: [],
      })
      .buildTransaction()

    expect(tx.to).to.equal(await fixture.seaportContract.getAddress())
    expect(tx.authorizationList).to.deep.equal([])
  })
})
