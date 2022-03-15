import { expect } from "chai";
import { ethers } from "hardhat";

describe("Consideration", function () {
  it("Should return the correct name of the contract", async function () {
    const Consideration = await ethers.getContractFactory("Consideration");
    const consideration = await Consideration.deploy(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero
    );
    await consideration.deployed();

    expect(await consideration.name()).to.equal("Consideration");
  });

  it("Should return a non-null address", async function () {
    const Consideration = await ethers.getContractFactory("Consideration");
    const consideration = await Consideration.deploy(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero
    );
    await consideration.deployed();

    expect(consideration.address).to.not.be.null;
  });
});
