import { expect } from "chai";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { MAX_INT, OrderType } from "../constants";
import { generateRandomSalt } from "../utils/order";
import { constructCurrencyItem, constructNftItem } from "./utils/item";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to sign an order", (fixture) => {
  it("should be a valid order", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;
    const [offerer, zone, randomSigner] = await ethers.getSigners();

    const startTime = 0;
    const endTime = MAX_INT;
    const salt = generateRandomSalt();
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

    const nonce = await considerationContract.getNonce(offerer.address);

    const orderParameters = {
      offerer: offerer.address,
      zone: ethers.constants.AddressZero,
      offer,
      consideration: considerationData,
      orderType: OrderType.FULL_OPEN,
      totalOriginalConsiderationItems: considerationData.length,
      salt,
      startTime,
      endTime,
      zoneHash: formatBytes32String(nonce.toString()),
    };

    const signature = await consideration.signOrder(
      orderParameters,
      nonce.toNumber()
    );

    const order = {
      parameters: {
        ...orderParameters,
        totalOriginalConsiderationItems: orderParameters.consideration.length,
      },
      signature,
    };

    // Use a random address to verify that the signature is valid
    const isValid = await considerationContract
      .connect(randomSigner)
      .callStatic.validate([order]);

    expect(isValid).to.be.true;
  });
});
