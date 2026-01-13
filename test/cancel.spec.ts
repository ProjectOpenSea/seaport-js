import { expect } from "chai";
import { parseEther } from "ethers";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ItemType } from "../src/constants";
import { CreateOrderInput } from "../src/types";
import { describeWithFixture } from "./utils/setup";
import { OVERRIDE_GAS_LIMIT } from "./utils/constants";

describeWithFixture("As a user I want to cancel an order", (fixture) => {
  let offerer: HardhatEthersSigner;
  let zone: HardhatEthersSigner;
  let fulfiller: HardhatEthersSigner;
  let standardCreateOrderInput: CreateOrderInput;
  const nftId = "1";

  before(async () => {
    [offerer, zone, fulfiller] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const { testErc721 } = fixture;

    await testErc721.mint(await offerer.getAddress(), nftId);

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
    };
  });

  it("validate then bulk cancel orders", async () => {
    const { seaport } = fixture;

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    );
    const executeAllActionsOnChainOrder = (
      await seaport.createOrder(standardCreateOrderInput)
    ).executeAllActions;

    const offChainOrder = await executeAllActions();
    const onChainOrder = await executeAllActionsOnChainOrder();

    // Remove signature
    onChainOrder.signature = "0x";

    const overrides = { gasLimit: OVERRIDE_GAS_LIMIT };

    const validateTx = await seaport
      .validate(
        [onChainOrder],
        await offerer.getAddress(),
        undefined,
        overrides,
      )
      .transact();
    expect(validateTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT);

    const bulkCancelOrdersTx = await seaport
      .bulkCancelOrders(await offerer.getAddress(), undefined, overrides)
      .transact();
    expect(bulkCancelOrdersTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT);

    const { executeAllActions: executeAllFulfillActionsOffChainOrder } =
      await seaport.fulfillOrder({
        order: offChainOrder,
        accountAddress: await fulfiller.getAddress(),
      });

    const { executeAllActions: executeAllFulfillActionsOnChainOrder } =
      await seaport.fulfillOrder({
        order: onChainOrder,
        accountAddress: await fulfiller.getAddress(),
      });

    await expect(executeAllFulfillActionsOffChainOrder()).to.be.reverted;
    await expect(executeAllFulfillActionsOnChainOrder()).to.be.reverted;

    expect(
      (await seaport.getCounter(await offerer.getAddress())) >
        BigInt(offChainOrder.parameters.counter),
    ).to.be.true;
  });

  it("validate then cancel single order", async () => {
    const { seaport } = fixture;

    const { executeAllActions } = await seaport.createOrder(
      standardCreateOrderInput,
    );
    const order = await executeAllActions();

    // Remove signature
    order.signature = "0x";

    await seaport.validate([order], await offerer.getAddress()).transact();
    const orderHash = seaport.getOrderHash(order.parameters);
    expect(await seaport.getOrderStatus(orderHash)).to.have.property(
      "isValidated",
      true,
    );

    const overrides = { gasLimit: OVERRIDE_GAS_LIMIT };
    const cancelOrdersTx = await seaport
      .cancelOrders(
        [order.parameters],
        await offerer.getAddress(),
        undefined,
        overrides,
      )
      .transact();
    expect(await seaport.getOrderStatus(orderHash)).to.have.property(
      "isCancelled",
      true,
    );
    expect(cancelOrdersTx.gasLimit).to.eq(OVERRIDE_GAS_LIMIT);
  });
});
