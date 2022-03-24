import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../constants";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = 1;
    await testErc721.mint(offerer.address, nftId);
    const startTime = 0;
    const endTime = MAX_INT;
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
    expect(createOrderAction.value.order).to.deep.equal({});
  });
});
