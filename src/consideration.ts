import { BigNumberish, Contract, ethers, providers } from "ethers";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
import ConsiderationABI from "../artifacts/consideration/contracts/Consideration.sol/Consideration.json";
import {
  ConsiderationConfig,
  CreateOrderInput,
  Order,
  OrderComponents,
  OrderParameters,
} from "./types";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
} from "./constants";
import { fulfillBasicOrder, shouldUseBasicFulfill } from "./utils/fulfill";
import {
  feeToConsiderationItem,
  mapInputItemToOfferItem,
  ORDER_OPTIONS_TO_ORDER_TYPE,
  validateOrderParameters,
} from "./utils/order";

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

  public async createOrder({
    zone = ethers.constants.AddressZero,
    startTime,
    endTime,
    offer,
    consideration,
    nonce,
    allowPartialFills,
    restrictedByZone,
    useProxy,
    // fees,
    salt = ethers.utils.randomBytes(16),
  }: CreateOrderInput): Order {
    const offerer = await this.provider.getSigner().getAddress();

    const fillsKey = allowPartialFills ? "PARTIAL" : "FULL";
    const restrictedKey = restrictedByZone ? "RESTRICTED" : "OPEN";
    const proxyKey = useProxy ? "VIA_PROXY" : "WITHOUT_PROXY";

    const orderType =
      ORDER_OPTIONS_TO_ORDER_TYPE[fillsKey][restrictedKey][proxyKey];

    const orderParameters: OrderParameters = {
      offerer,
      zone,
      startTime,
      endTime,
      orderType,
      offer: offer.map(mapInputItemToOfferItem),
      consideration: [
        ...consideration.map((consideration) => ({
          ...mapInputItemToOfferItem(consideration),
          recipient: consideration.recipient ?? offerer,
        })),
        // ...(fees?.map((fee) => feeToConsiderationItem({ fee })) ?? []),
      ],
      salt,
    };

    validateOrderParameters(orderParameters);

    const signature = await this.signOrder(orderParameters, nonce);

    return { parameters: orderParameters, signature };
  }

  public async signOrder(
    orderParameters: OrderParameters,
    nonce?: BigNumberish
  ) {
    const signer = this.provider.getSigner();
    const { chainId } = await this.provider.getNetwork();

    const domainData = {
      name: CONSIDERATION_CONTRACT_NAME,
      version: CONSIDERATION_CONTRACT_VERSION,
      chainId,
    };

    const orderComponents: OrderComponents = {
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

  public async cancelOrders(orders: OrderComponents[]) {
    return this.contract.cancel(orders);
  }

  public async bulkCancelOrders({
    offerer,
    zone = ethers.constants.AddressZero,
  }: {
    offerer?: string;
    zone: string;
  }) {
    const resolvedOfferer =
      offerer ?? (await this.provider.getSigner().getAddress());

    return this.contract.incrementNonce(resolvedOfferer, zone);
  }

  public fulfillOrder(order: Order) {
    if (shouldUseBasicFulfill(order)) {
      return fulfillBasicOrder(order, this.contract);
    }

    // TODO: Implement more advanced order fulfillment
    return null;
  }
}
