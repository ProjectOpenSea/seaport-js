import { providers as multicallProviders } from "@0xsequence/multicall";
import { Contract } from "ethers";
import { ProxyRegistryInterfaceABI } from "../abi/ProxyRegistryInterface";
import type { ProxyRegistryInterface } from "../typechain/ProxyRegistryInterface";

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

  return proxyRegistryInterface.proxies(address);
};
