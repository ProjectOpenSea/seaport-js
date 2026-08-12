import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types"
import { use } from "chai"
import chaiAsPromised from "chai-as-promised"
import hre from "hardhat"
import { Seaport } from "../../src/seaport"
import type {
  DomainRegistry,
  Seaport as SeaportContract,
  TestERC20,
  TestERC20USDC,
  TestERC721,
  TestERC1155,
  TestERC1271Wallet,
} from "../../src/typechain-types/index"

use(chaiAsPromised)

type Fixture = {
  seaportContract: SeaportContract
  seaport: Seaport
  domainRegistry: DomainRegistry
  testErc721: TestERC721
  testErc20: TestERC20
  testErc20USDC: TestERC20USDC
  testErc1155: TestERC1155
  testERC1271Wallet: TestERC1271Wallet
  seaportWithSigner: Seaport
  ethers: HardhatEthers
}

/**
 * Pulls the chain's clock forward to wall-clock time.
 *
 * The simulated chain only advances its timestamp when a block is mined, one
 * second per block, so chain time tracks *blocks mined*, not elapsed real time.
 * Wall clock keeps running regardless. Over a suite that mines few blocks but
 * takes a long time, chain time falls behind real time, and it never catches up
 * on its own because the network is not recreated between tests.
 *
 * That matters because `createOrder` defaults `startTime` to
 * `Math.floor(Date.now() / 1000)`, which is wall clock. Once the drift exceeds
 * the blocks a test mines, every order it creates has a `startTime` in the
 * chain's future, Seaport skips them all as not yet active, and a multi-order
 * fulfillment reverts with `NoSpecifiedOrdersAvailable()`.
 *
 * The failure is timing-dependent rather than deterministic, which is why it
 * showed up only under `npm run coverage` (roughly 3x slower) and only
 * intermittently: it needs total suite wall time to outrun total blocks mined.
 *
 * Only ever moves the clock forward. When a test has mined enough blocks to put
 * chain time ahead of wall clock, this is a no-op, and
 * `evm_setNextBlockTimestamp` rejects a timestamp at or behind the current
 * block anyway.
 */
export type ChainTimeProvider = {
  provider: {
    getBlock: (tag: string) => Promise<{ timestamp: number } | null>
    send: (method: string, params: unknown[]) => Promise<unknown>
  }
}

export const syncChainTimeToWallClock = async (
  ethers: ChainTimeProvider,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  const latest = await ethers.provider.getBlock("latest")

  if (!latest || latest.timestamp >= nowSeconds) {
    return false
  }

  await ethers.provider.send("evm_setNextBlockTimestamp", [nowSeconds])
  await ethers.provider.send("evm_mine", [])
  return true
}

export const describeWithFixture = (
  name: string,
  suiteCb: (fixture: Fixture) => unknown,
) => {
  describe(name, () => {
    const fixture: Partial<Fixture> = {}

    beforeEach(async () => {
      const { ethers } = await hre.network.connect()

      const SeaportFactory = await ethers.getContractFactory(
        "seaport/contracts/Seaport.sol:Seaport",
      )

      const ConduitControllerFactory = await ethers.getContractFactory(
        "seaport/contracts/conduit/ConduitController.sol:LocalConduitController",
      )

      const conduitController = await ConduitControllerFactory.deploy()

      const seaportContract = (await SeaportFactory.deploy(
        await conduitController.getAddress(),
      )) as SeaportContract
      await seaportContract.waitForDeployment()

      const DomainRegistryFactory =
        await ethers.getContractFactory("DomainRegistry")
      const domainRegistry = await DomainRegistryFactory.deploy()
      await domainRegistry.waitForDeployment()

      const seaport = new Seaport(ethers.provider as any, {
        overrides: {
          contractAddress: await seaportContract.getAddress(),
          domainRegistryAddress: await domainRegistry.getAddress(),
        },
      })
      const [signer] = await ethers.getSigners()
      const seaportWithSigner = new Seaport(signer as any, {
        overrides: {
          contractAddress: await seaportContract.getAddress(),
          domainRegistryAddress: await domainRegistry.getAddress(),
        },
      })

      const TestERC721 = await ethers.getContractFactory("TestERC721")
      const testErc721 = await TestERC721.deploy()
      await testErc721.waitForDeployment()

      const TestERC1155 = await ethers.getContractFactory("TestERC1155")
      const testErc1155 = await TestERC1155.deploy()
      await testErc1155.waitForDeployment()

      const TestERC20 = await ethers.getContractFactory("TestERC20")
      const testErc20 = await TestERC20.deploy()
      await testErc20.waitForDeployment()

      const TestERC20USDC = await ethers.getContractFactory("TestERC20USDC")
      const testErc20USDC = await TestERC20USDC.deploy()
      await testErc20USDC.waitForDeployment()

      const TestERC1271Wallet =
        await ethers.getContractFactory("TestERC1271Wallet")
      const testERC1271Wallet = await TestERC1271Wallet.deploy()
      await testERC1271Wallet.waitForDeployment()

      // In order for cb to get the correct fixture values we have
      // to pass a reference to an object that you we mutate.
      fixture.seaportContract = seaportContract
      fixture.seaport = seaport
      fixture.seaportWithSigner = seaportWithSigner
      fixture.domainRegistry = domainRegistry
      fixture.testErc721 = testErc721
      fixture.testErc1155 = testErc1155
      fixture.testErc20 = testErc20
      fixture.testErc20USDC = testErc20USDC
      fixture.testERC1271Wallet = testERC1271Wallet
      fixture.ethers = ethers

      await syncChainTimeToWallClock(ethers)
    })

    suiteCb(fixture as Fixture)
  })
}
