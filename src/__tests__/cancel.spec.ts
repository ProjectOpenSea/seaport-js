import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType } from "../constants";
import { CreateOrderInput } from "../types";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to cancel an order", (fixture) => {
  let offerer: SignerWithAddress;
  let zone: SignerWithAddress;
  let fulfiller: SignerWithAddress;
  let standardCreateOrderInput: CreateOrderInput;
  const nftId = "1";

  before(async () => {
    [offerer, zone, fulfiller] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const { testErc721 } = fixture;

    await testErc721.mint(offerer.address, nftId);

    standardCreateOrderInput = {
      startTime: "0",
      offer: [
        {
          itemType: ItemType.ERC721,
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    };
  });

  it("validate then bulk cancel orders", async () => {
    const { seaportv12 } = fixture;

    const { executeAllActions } = await seaportv12.createOrder(
      standardCreateOrderInput
    );
    const executeAllActionsOnChainOrder = (
      await seaportv12.createOrder(standardCreateOrderInput)
    ).executeAllActions;

    const offChainOrder = await executeAllActions();
    const onChainOrder = await executeAllActionsOnChainOrder();

    // Remove signature
    onChainOrder.signature = "0x";

    await seaportv12.validate([onChainOrder], offerer.address).transact();
    await seaportv12.bulkCancelOrders(offerer.address).transact();

    const { executeAllActions: executeAllFulfillActionsOffChainOrder } =
      await seaportv12.fulfillOrder({
        order: offChainOrder,
        accountAddress: fulfiller.address,
      });

    const { executeAllActions: executeAllFulfillActionsOnChainOrder } =
      await seaportv12.fulfillOrder({
        order: onChainOrder,
        accountAddress: fulfiller.address,
      });

    await expect(executeAllFulfillActionsOffChainOrder()).to.be.reverted;
    await expect(executeAllFulfillActionsOnChainOrder()).to.be.reverted;

    expect(await seaportv12.getCounter(offerer.address)).to.deep.equal(
      BigNumber.from(offChainOrder.parameters.counter).add(1)
    );
  });

  it("validate then cancel single order", async () => {
    const { seaportv12 } = fixture;

    const { executeAllActions } = await seaportv12.createOrder(
      standardCreateOrderInput
    );
    const order = await executeAllActions();

    // Remove signature
    order.signature = "0x";

    await seaportv12.validate([order], offerer.address).transact();
    const orderHash = seaportv12.getOrderHash(order.parameters);
    expect(await seaportv12.getOrderStatus(orderHash)).to.have.property(
      "isValidated",
      true
    );

    await seaportv12
      .cancelOrders([order.parameters], offerer.address)
      .transact();
    expect(await seaportv12.getOrderStatus(orderHash)).to.have.property(
      "isCancelled",
      true
    );
  });
});
