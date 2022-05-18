import { ethers } from "hardhat";
import { Consideration } from "../../consideration";
import type {
  TestERC721,
  TestERC20,
  TestERC1155,
  Consideration as ConsiderationContract,
  OwnedUpgradeabilityProxy,
  WyvernProxyRegistry,
  WyvernTokenTransferProxy,
} from "../../typechain";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

chai.use(chaiAsPromised);
chai.use(sinonChai);

type Fixture = {
  considerationContract: ConsiderationContract;
  consideration: Consideration;
  testErc721: TestERC721;
  testErc20: TestERC20;
  testErc1155: TestERC1155;
  ownedUpgradeabilityProxy: OwnedUpgradeabilityProxy;
  legacyProxyRegistry: WyvernProxyRegistry;
  legacyTokenTransferProxy: WyvernTokenTransferProxy;
};

export const describeWithFixture = (
  name: string,
  suiteCb: (fixture: Fixture) => unknown
) => {
  describe(name, () => {
    const fixture: Partial<Fixture> = {};

    beforeEach(async () => {
      const LegacyProxyRegistryFactory = await ethers.getContractFactory(
        "WyvernProxyRegistry"
      );
      const legacyProxyRegistry = await LegacyProxyRegistryFactory.deploy();

      const OwnedUpgradeabilityProxyFactory = await ethers.getContractFactory(
        "OwnedUpgradeabilityProxy"
      );

      const ownedUpgradeabilityProxy =
        await OwnedUpgradeabilityProxyFactory.deploy();

      const LegacyTokenTransferProxyFactory = await ethers.getContractFactory(
        "WyvernTokenTransferProxy"
      );

      const legacyTokenTransferProxy =
        await LegacyTokenTransferProxyFactory.deploy(
          legacyProxyRegistry.address
        );

      const ConsiderationFactory = await ethers.getContractFactory(
        "Consideration"
      );

      const legacyProxyImplementation =
        await legacyProxyRegistry.delegateProxyImplementation();

      const ConduitControllerFactory = await ethers.getContractFactory(
        "ConduitController"
      );

      const conduitController = await ConduitControllerFactory.deploy();

      const considerationContract = await ConsiderationFactory.deploy(
        conduitController.address,
        legacyProxyRegistry.address,
        legacyTokenTransferProxy.address,
        legacyProxyImplementation
      );

      await considerationContract.deployed();

      await legacyProxyRegistry.grantInitialAuthentication(
        considerationContract.address
      );

      const consideration = new Consideration(ethers.provider, {
        overrides: {
          contractAddress: considerationContract.address,
        },
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
      fixture.considerationContract = considerationContract;
      fixture.consideration = consideration;
      fixture.testErc721 = testErc721;
      fixture.testErc1155 = testErc1155;
      fixture.testErc20 = testErc20;
    });

    suiteCb(fixture as Fixture);
  });
};
