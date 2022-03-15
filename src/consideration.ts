import { Contract, providers } from "ethers";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
import ConsiderationABI from "../artifacts/consideration/contracts/Consideration.sol/Consideration.json";
import { ConsiderationConfig, OrderParameters } from "./types";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
} from "./constants";

export class Consideration {
  // Provides the raw interface to the contract for flexibility
  public contract: ConsiderationContract;

  private provider: providers.JsonRpcProvider;

  public constructor(
    provider: providers.JsonRpcProvider,
    config?: ConsiderationConfig
  ) {
    this.provider = provider;

    this.contract = new Contract(
      config?.overrides?.contractAddress ?? "",
      ConsiderationABI.abi,
      provider.getSigner()
    ) as ConsiderationContract;
  }

  public async signOrder(orderParameters: OrderParameters, nonce?: number) {
    const signer = this.provider.getSigner();
    const { chainId } = await this.provider.getNetwork();

    const domainData = {
      name: CONSIDERATION_CONTRACT_NAME,
      version: CONSIDERATION_CONTRACT_VERSION,
      chainId,
    };

    const orderComponents = {
      ...orderParameters,
      nonce:
        nonce ??
        (await this.contract.getNonce(
          orderParameters.offerer,
          orderParameters.zone
        )),
    };

    return await signer._signTypedData(
      domainData,
      EIP_712_ORDER_TYPE,
      orderComponents
    );
  }
}
