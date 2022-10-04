import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to register a domain", (fixture) => {
  let setter: SignerWithAddress;
  let getter: SignerWithAddress;

  const OPENSEA_DOMAIN = "opensea.io";
  const OPENSEA_TAG = "360c6ebe";

  const exampleTag = "0xa9059cbb";
  const expectedExampleDomainArray = [
    "join_tg_invmru_haha_fd06787(address,bool)",
    "func_2093253501(bytes)",
    "transfer(bytes4[9],bytes5[6],int48[11])",
    "many_msg_babbage(bytes1)",
  ];

  beforeEach(async () => {
    [setter, getter] = await ethers.getSigners();
  });

  describe("I want to register a domain", async () => {
    const { seaport } = fixture;

    await seaport.setDomain(OPENSEA_DOMAIN);

    expect(await seaport.getDomain(OPENSEA_TAG, BigNumber.from(0))).to.eq(
      OPENSEA_DOMAIN
    );
  });
});
