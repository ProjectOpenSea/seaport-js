import { expect } from "chai";
import { randomBytes } from "crypto";
import { ethers } from "hardhat";
import { MAX_INT, OrderType } from "../constants";
import { constructCurrencyItem, constructNftItem } from "./utils/item";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to sign an order", (fixture) => {
  it("should be a valid order", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;
    const [offerer, zone] = await ethers.getSigners();

    const startTime = 0;
    const endTime = MAX_INT;
    const salt = randomBytes(32);
    const nftId = 0;

    const offer = [
      constructNftItem({
        token: testErc721.address,
        identifierOrCriteria: nftId,
        amount: 1,
      }),
    ];

    const considerationData = [
      constructCurrencyItem({
        amount: ethers.utils.parseEther("10"),
        recipient: offerer.address,
      }),
      constructCurrencyItem({
        amount: ethers.utils.parseEther("1"),
        recipient: zone.address,
      }),
    ];

    const orderParameters = {
      offerer: offerer.address,
      zone: ethers.constants.AddressZero,
      offer,
      consideration: considerationData,
      orderType: OrderType.FULL_OPEN,
      salt,
      startTime,
      endTime,
    };

    const nonce = await considerationContract.getNonce(
      offerer.address,
      zone.address
    );

    const signature = await consideration.signOrder(orderParameters, nonce);

    const isValid = await considerationContract.callStatic.validate([
      { parameters: orderParameters, signature },
    ]);

    expect(isValid).to.be.true;
  });
});
