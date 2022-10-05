import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to register a domain", (fixture) => {
  let user: SignerWithAddress;

  const OPENSEA_DOMAIN = "opensea.io";
  const OPENSEA_TAG = keccak256(toUtf8Bytes(OPENSEA_DOMAIN)).slice(0, 10);

  const exampleTag = "0xa9059cbb";
  const expectedExampleDomainArray = [
    "join_tg_invmru_haha_fd06787(address,bool)",
    "func_2093253501(bytes)",
    "transfer(bytes4[9],bytes5[6],int48[11])",
    "many_msg_babbage(bytes1)",
  ];

  beforeEach(async () => {
    [user] = await ethers.getSigners();
  });

  it("I want to register a domain", async () => {
    const { seaport } = fixture;

    await seaport.setDomain(OPENSEA_DOMAIN, user.address).transact();

    console.log(
      await seaport.getDomain(OPENSEA_TAG, BigNumber.from(0), user.address)
    );

    expect(
      await seaport.getDomain(OPENSEA_TAG, BigNumber.from(0), user.address)
    ).to.eq(OPENSEA_DOMAIN);
  });
});
