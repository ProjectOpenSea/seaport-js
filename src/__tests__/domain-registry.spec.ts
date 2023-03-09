import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to register or look up a domain",
  (fixture) => {
    let user: SignerWithAddress;

    const OPENSEA_DOMAIN = "opensea.io";
    const OPENSEA_TAG = keccak256(toUtf8Bytes(OPENSEA_DOMAIN)).slice(0, 10);

    const expectedExampleDomainArray = [
      "join_tg_invmru_haha_fd06787(address,bool)",
      "func_2093253501(bytes)",
      "transfer(bytes4[9],bytes5[6],int48[11])",
      "many_msg_babbage(bytes1)",
    ];
    const exampleTag = keccak256(
      toUtf8Bytes(expectedExampleDomainArray[0])
    ).slice(0, 10);

    beforeEach(async () => {
      const { seaportv12 } = fixture;

      [user] = await ethers.getSigners();

      await seaportv12
        .setDomain(expectedExampleDomainArray[0], user.address)
        .transact();

      await seaportv12
        .setDomain(expectedExampleDomainArray[1], user.address)
        .transact();

      await seaportv12
        .setDomain(expectedExampleDomainArray[2], user.address)
        .transact();

      await seaportv12
        .setDomain(expectedExampleDomainArray[3], user.address)
        .transact();
    });

    it("Should return the proper domain for a given tag", async () => {
      const { seaportv12 } = fixture;

      await seaportv12.setDomain(OPENSEA_DOMAIN, user.address).transact();

      expect(await seaportv12.getDomain(OPENSEA_TAG, 0)).to.eq(OPENSEA_DOMAIN);

      expect(await seaportv12.getDomain(exampleTag, 0)).to.eq(
        expectedExampleDomainArray[0]
      );

      expect(await seaportv12.getDomain(exampleTag, 1)).to.eq(
        expectedExampleDomainArray[1]
      );

      expect(await seaportv12.getDomain(exampleTag, 2)).to.eq(
        expectedExampleDomainArray[2]
      );

      expect(await seaportv12.getDomain(exampleTag, 3)).to.eq(
        expectedExampleDomainArray[3]
      );
    });

    it("Should return the array of registered domains for a given tag", async () => {
      const { seaportv12 } = fixture;

      expect(await seaportv12.getDomains(exampleTag)).to.deep.eq(
        expectedExampleDomainArray
      );
    });

    it("Should return the number of registered domains for a given tag", async () => {
      const { seaportv12 } = fixture;

      expect(await seaportv12.getNumberOfDomains(exampleTag)).to.eq(4);
    });

    it("Should return an array of domains even if getDomains should throw", async () => {
      const { seaportv12 } = fixture;

      expect(await seaportv12.getDomains(exampleTag, true)).to.deep.eq(
        expectedExampleDomainArray
      );
    });
  }
);
