import { expect } from "chai";
import { randomBytes } from "crypto";
import { ethers } from "hardhat";
import { Consideration } from "../consideration";
import type { Consideration as ConsiderationContract } from "../typechain";
import { TestERC721 } from "../typechain/TestERC721";
import { constructCurrencyItem, constructNftItem } from "../utils/item";

describe("Sign order", function () {
  let considerationContract: ConsiderationContract;
  let consideration: Consideration;
  let testERC721: TestERC721;

  before(async () => {
    const ConsiderationFactory = await ethers.getContractFactory(
      "Consideration"
    );
    considerationContract = await ConsiderationFactory.deploy(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero
    );
    await considerationContract.deployed();

    consideration = new Consideration(ethers.provider, {
      overrides: {
        contractAddress: considerationContract.address,
        legacyProxyRegistryAddress: "",
      },
    });

    const TestERC721 = await ethers.getContractFactory("TestERC721");
    testERC721 = await TestERC721.deploy();
    await testERC721.deployed();
  });

  it("should be a valid order", async function () {
    const [offerer, zone] = await ethers.getSigners();
    const startTime = 0;
    const endTime = ethers.BigNumber.from(
      "0xff00000000000000000000000000000000000000000000000000000000000000"
    );
    const salt = randomBytes(32);

    const nftId = 0;

    const offer = [
      constructNftItem({
        token: testERC721.address,
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
      orderType: 0,
      salt,
      startTime,
      endTime,
    };

    const signature = await consideration.signOrder(orderParameters, 0);

    const isValid = await considerationContract.callStatic.validate([
      { parameters: orderParameters, signature },
    ]);

    expect(isValid).to.be.true;
  });
});
