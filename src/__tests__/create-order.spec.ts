import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, OrderType } from "../constants";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = ethers.utils.randomBytes(16);

    const { insufficientApprovals, genActions, numActions } =
      await consideration.createOrder({
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifierOrCriteria: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: offerer.address,
          },
        ],
        // 2.5% fee
        fees: [{ recipient: zone.address, basisPoints: 250 }],
      });

    expect(insufficientApprovals).to.be.deep.equal([
      {
        token: testErc721.address,
        identifierOrCriteria: nftId.toString(),
        approvedAmount: BigNumber.from(0),
        requiredApprovedAmount: BigNumber.from(1),
        operator: considerationContract.address,
        itemType: ItemType.ERC721,
      },
    ]);
    expect(numActions).to.equal(2);
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.false;

    const actions = await genActions();

    const approvalAction = await actions.next();

    isExactlyNotTrue(approvalAction.done);

    expect(approvalAction.value).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId.toString(),
      itemType: ItemType.ERC721,
      transaction: approvalAction.value.transaction,
    });

    await approvalAction.value.transaction.wait();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.true;

    const createOrderAction = await actions.next();

    isExactlyTrue(createOrderAction.done);
    expect(createOrderAction.value.type).to.equal("create");
    expect(createOrderAction.value.order).to.deep.equal({
      consideration: [
        {
          endAmount: ethers.utils.parseEther("10").toString(),
          identifierOrCriteria: "0",
          itemType: ItemType.NATIVE,
          recipient: offerer.address,
          startAmount: ethers.utils.parseEther("10").toString(),
          token: ethers.constants.AddressZero,
        },
        {
          endAmount: ethers.utils.parseEther(".25").toString(),
          identifierOrCriteria: "0",
          itemType: ItemType.NATIVE,
          recipient: zone.address,
          startAmount: ethers.utils.parseEther(".25").toString(),
          token: ethers.constants.AddressZero,
        },
      ],
      endTime,
      nonce: 0,
      offer: [
        {
          endAmount: "1",
          identifierOrCriteria: nftId,
          itemType: ItemType.ERC721,
          startAmount: "1",
          token: testErc721.address,
        },
      ],
      offerer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      orderType: OrderType.FULL_OPEN,
      salt,
      signature: createOrderAction.value.order.signature,
      startTime,
      zone: ethers.constants.AddressZero,
    });

    const isValid = await considerationContract
      .connect(randomSigner)
      .callStatic.validate([
        {
          parameters: createOrderAction.value.order,
          signature: createOrderAction.value.order.signature,
        },
      ]);

    expect(isValid).to.be.true;
  });
});
