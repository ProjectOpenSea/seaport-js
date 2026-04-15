import "dotenv/config"
import hardhatToolbox from "@nomicfoundation/hardhat-toolbox-mocha-ethers"
import { defineConfig } from "hardhat/config"

export default defineConfig({
  plugins: [hardhatToolbox],
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.14",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    npmFilesToBuild: [
      "seaport/contracts/Seaport.sol",
      "seaport/contracts/conduit/Conduit.sol",
      "seaport/contracts/conduit/ConduitController.sol",
    ],
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      allowUnlimitedContractSize: true,
      chainId: 1,
    },
  },
  typechain: {
    outDir: "src/typechain-types",
  },
  paths: {
    tests: { mocha: "test" },
    artifacts: "src/artifacts",
    sources: "src/contracts",
  },
})
