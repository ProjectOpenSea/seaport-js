import { ethers } from "hardhat";
import { Seaport } from "../../seaport";
import type {
  TestERC721,
  TestERC20,
  TestERC1155,
  Seaport as SeaportContract,
  DomainRegistry,
} from "../../typechain";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

chai.use(chaiAsPromised);
chai.use(sinonChai);

type Fixture = {
  seaportContract: SeaportContract;
  seaportv15Contract: SeaportContract;
  seaport: Seaport;
  seaportv15: Seaport;
  domainRegistry: DomainRegistry;
  testErc721: TestERC721;
  testErc20: TestERC20;
  testErc1155: TestERC1155;
};

export const describeWithFixture = (
  name: string,
  suiteCb: (fixture: Fixture) => unknown
) => {
  describe(name, () => {
    const fixture: Partial<Fixture> = {};

    beforeEach(async () => {
      const Seaportv14Factory = await ethers.getContractFactory(
        "seaport_v1_4/contracts/Seaport.sol:Seaport"
      );

      const Seaportv15Factory = await ethers.getContractFactory(
        "seaport_v1_5/contracts/Seaport.sol:Seaport"
      );

      const ConduitControllerFactory = await ethers.getContractFactory(
        "ConduitController"
      );

      const conduitController = await ConduitControllerFactory.deploy();

      const seaportv14Contract = (await Seaportv14Factory.deploy(
        conduitController.address
      )) as SeaportContract;

      const seaportv15Contract = (await Seaportv15Factory.deploy(
        conduitController.address
      )) as SeaportContract;

      await seaportv14Contract.deployed();

      const DomainRegistryFactory = await ethers.getContractFactory(
        "DomainRegistry"
      );
      const domainRegistry = await DomainRegistryFactory.deploy();
      await domainRegistry.deployed();

      const seaportv14 = new Seaport(ethers.provider, {
        overrides: {
          contractAddress: seaportv14Contract.address,
          domainRegistryAddress: domainRegistry.address,
        },
        seaportVersion: "1.4",
      });

      const seaportv15 = new Seaport(ethers.provider, {
        overrides: {
          contractAddress: seaportv15Contract.address,
          domainRegistryAddress: domainRegistry.address,
        },
        seaportVersion: "1.5",
      });

      const TestERC721 = await ethers.getContractFactory("TestERC721");
      const testErc721 = await TestERC721.deploy();
      await testErc721.deployed();

      const TestERC1155 = await ethers.getContractFactory("TestERC1155");
      const testErc1155 = await TestERC1155.deploy();
      await testErc1155.deployed();

      const TestERC20 = await ethers.getContractFactory("TestERC20");
      const testErc20 = await TestERC20.deploy();
      await testErc20.deployed();

      // In order for cb to get the correct fixture values we have
      // to pass a reference to an object that you we mutate.
      fixture.seaportContract = seaportv14Contract;
      fixture.seaportv15Contract = seaportv15Contract;
      fixture.seaport = seaportv14;
      fixture.seaportv15 = seaportv15;
      fixture.domainRegistry = domainRegistry;
      fixture.testErc721 = testErc721;
      fixture.testErc1155 = testErc1155;
      fixture.testErc20 = testErc20;
    });

    suiteCb(fixture as Fixture);
  });
};
