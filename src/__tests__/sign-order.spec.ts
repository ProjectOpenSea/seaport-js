import { expect } from "chai";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, NO_CONDUIT, OrderType } from "../constants";
import { ConsiderationItem, OfferItem } from "../types";
import { generateRandomSalt } from "../utils/order";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to sign an order", (fixture) => {
  it("should be a valid order", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;
    const [offerer, zone, randomSigner] = await ethers.getSigners();

    const startTime = 0;
    const endTime = MAX_INT;
    const salt = generateRandomSalt();
    const nftId = "0";

    const offer: OfferItem[] = [
      {
        itemType: ItemType.ERC721,
        token: testErc721.address,
        identifierOrCriteria: nftId,
        startAmount: "1",
        endAmount: "1",
      },
    ];

    const considerationData: ConsiderationItem[] = [
      {
        itemType: ItemType.NATIVE,
        token: ethers.constants.AddressZero,
        startAmount: ethers.utils.parseEther("10").toString(),
        endAmount: ethers.utils.parseEther("10").toString(),
        recipient: offerer.address,
        identifierOrCriteria: "0",
      },
      {
        itemType: ItemType.NATIVE,
        token: ethers.constants.AddressZero,
        startAmount: ethers.utils.parseEther("1").toString(),
        endAmount: ethers.utils.parseEther("1").toString(),
        recipient: zone.address,
        identifierOrCriteria: "0",
      },
    ];

    const counter = await seaportContract.getCounter(offerer.address);

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
      zoneHash: formatBytes32String(counter.toString()),
      conduitKey: NO_CONDUIT,
    };

    const signature = await seaport.signOrder(
      orderParameters,
      counter.toNumber()
    );

    const order = {
      parameters: {
        ...orderParameters,
        totalOriginalConsiderationItems: orderParameters.consideration.length,
      },
      signature,
    };

    // Use a random address to verify that the signature is valid
    const isValid = await seaportContract
      .connect(randomSigner)
      .callStatic.validate([order]);

    expect(isValid).to.be.true;
  });
});
