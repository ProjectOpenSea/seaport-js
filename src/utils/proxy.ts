import { providers as multicallProviders } from "@0xsequence/multicall";
import { Contract, ethers } from "ethers";
import { ProxyRegistryInterfaceABI } from "../abi/ProxyRegistryInterface";
import type { ProxyRegistryInterface } from "../typechain";

export const getProxy = (
  address: string,
  {
    legacyProxyRegistryAddress,
    multicallProvider,
  }: {
    legacyProxyRegistryAddress: string;
    multicallProvider: multicallProviders.MulticallProvider;
  }
) => {
  const proxyRegistryInterface = new Contract(
    legacyProxyRegistryAddress,
    ProxyRegistryInterfaceABI,
    multicallProvider
  ) as ProxyRegistryInterface;

  return proxyRegistryInterface.proxies(address).then((address) =>
    // Return undefined for convenience if the user proxy is address zero (i.e. doesn't exist)
    address === ethers.constants.AddressZero ? undefined : address
  );
};
