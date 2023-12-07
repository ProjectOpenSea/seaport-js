import { expect } from "chai";
import { Signer, keccak256, toUtf8Bytes } from "ethers";
import { ethers } from "hardhat";
import { describeWithFixture } from "./utils/setup";
import {
  OPENSEA_DOMAIN,
  OPENSEA_DOMAIN_TAG,
  OVERRIDE_GAS_LIMIT,
} from "./utils/constants";

describeWithFixture(
  "As a user I want to register or look up a domain",
  (fixture) => {
    let user: Signer;

    const expectedExampleDomainArray = [
      "join_tg_invmru_haha_fd06787(address,bool)",
      "func_2093253501(bytes)",
      "transfer(bytes4[9],bytes5[6],int48[11])",
      "many_msg_babbage(bytes1)",
    ];
    const exampleTag = keccak256(
      toUtf8Bytes(expectedExampleDomainArray[0]),
    ).slice(0, 10);

    beforeEach(async () => {
      const { seaport } = fixture;

      [user] = await ethers.getSigners();

      const overrides = { gasLimit: OVERRIDE_GAS_LIMIT };
      const setDomainTxWithOverrides = await seaport
        .setDomain(
          expectedExampleDomainArray[0],
          await user.getAddress(),
          overrides,
        )
        .transact();
      expect(setDomainTxWithOverrides.gasLimit).to.eq(OVERRIDE_GAS_LIMIT);

      await seaport
        .setDomain(expectedExampleDomainArray[1], await user.getAddress())
        .transact();

      await seaport
        .setDomain(expectedExampleDomainArray[2], await user.getAddress())
        .transact();

      await seaport
        .setDomain(expectedExampleDomainArray[3], await user.getAddress())
        .transact();
    });

    it("Should return the proper domain for a given tag", async () => {
      const { seaport } = fixture;

      await seaport
        .setDomain(OPENSEA_DOMAIN, await user.getAddress())
        .transact();

      expect(await seaport.getDomain(`0x${OPENSEA_DOMAIN_TAG}`, 0)).to.eq(
        OPENSEA_DOMAIN,
      );

      expect(await seaport.getDomain(exampleTag, 0)).to.eq(
        expectedExampleDomainArray[0],
      );

      expect(await seaport.getDomain(exampleTag, 1)).to.eq(
        expectedExampleDomainArray[1],
      );

      expect(await seaport.getDomain(exampleTag, 2)).to.eq(
        expectedExampleDomainArray[2],
      );

      expect(await seaport.getDomain(exampleTag, 3)).to.eq(
        expectedExampleDomainArray[3],
      );
    });

    it("Should return the array of registered domains for a given tag", async () => {
      const { seaport } = fixture;

      expect(await seaport.getDomains(exampleTag)).to.deep.eq(
        expectedExampleDomainArray,
      );
    });

    it("Should return the number of registered domains for a given tag", async () => {
      const { seaport } = fixture;

      expect(await seaport.getNumberOfDomains(exampleTag)).to.eq(4);
    });

    it("Should return an array of domains even if getDomains throws", async () => {
      const { seaport } = fixture;

      (seaport.domainRegistry as any).getDomains = () => {
        throw new Error("intentional error");
      };

      expect(await seaport.getDomains(exampleTag)).to.deep.eq(
        expectedExampleDomainArray,
      );
    });
  },
);
