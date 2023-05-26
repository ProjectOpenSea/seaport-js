import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "solidity-coverage";

dotenv.config();

// Go to https://hardhat.org/config to learn more
const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.13",
        settings: {
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
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 1,
    },
  },
  typechain: {
    outDir: "src/typechain-types",
    target: "ethers-v5",
  },
  paths: {
    tests: "test",
    artifacts: "src/artifacts",
    sources: "src/contracts",
  },
};

export default config;
