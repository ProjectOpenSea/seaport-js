import { parseEther } from "ethers/lib/utils";
import { JsonRpcProvider } from "ethers/node_modules/@ethersproject/providers";

export const setBalance = async (
  address: string,
  provider: JsonRpcProvider,
  amountEth = parseEther("10000").toHexString().replace("0x0", "0x")
) => {
  await provider.send("hardhat_setBalance", [
    address,
    parseEther(amountEth).toHexString().replace("0x0", "0x"),
  ]);
};
