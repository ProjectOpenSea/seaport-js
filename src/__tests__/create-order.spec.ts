import { ethers } from "hardhat";
import { ItemType } from "../constants";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order", async () => {
    const { consideration, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const endTime = ethers.BigNumber.from(
      "0xff00000000000000000000000000000000000000000000000000000000000000"
    );

    const nftId = 0;
    await testErc721.mint(offerer.address, nftId);

    const { insufficientApprovals, execute, numExecutions } =
      await consideration.createOrder({
        endTime,
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

    console.log(insufficientApprovals, numExecutions);

    // const isValid = await considerationContract.callStatic.validate([
    //   { parameters: orderParameters, signature },
    // ]);

    // expect(isValid).to.be.true;
  });

  it("should fail to create the order if offerer hasn't approved", async () => {
    const { consideration, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const endTime = ethers.BigNumber.from(
      "0xff00000000000000000000000000000000000000000000000000000000000000"
    );

    const nftId = 0;
    await testErc721.mint(offerer.address, nftId);

    const { insufficientApprovals, execute, numExecutions } =
      await consideration.createOrder({
        endTime,
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

    console.log(insufficientApprovals, numExecutions);
  });
});
