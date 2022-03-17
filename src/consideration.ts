import { BigNumberish, Contract, ethers, providers } from "ethers";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
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
  checkApprovals,
  feeToConsiderationItem,
  mapInputItemToOfferItem,
  ORDER_OPTIONS_TO_ORDER_TYPE,
  totalItemsAmount,
  validateOrderParameters,
} from "./utils/order";
import { isCurrencyItem } from "./utils/item";
import { ConsiderationABI } from "./abi/Consideration";

export class Consideration {
  // Provides the raw interface to the contract for flexibility
  public contract: ConsiderationContract;

  private provider: providers.JsonRpcProvider;
  private legacyProxyRegistryAddress: string;

  public constructor(
    provider: providers.JsonRpcProvider,
    config?: ConsiderationConfig
  ) {
    this.provider = provider;

    this.contract = new Contract(
      config?.overrides?.contractAddress ?? "",
      ConsiderationABI,
      provider.getSigner()
    ) as ConsiderationContract;

    this.legacyProxyRegistryAddress =
      config?.overrides?.legacyProxyRegistryAddress ?? "";
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
    fees,
    salt = ethers.utils.randomBytes(16),
  }: CreateOrderInput): Promise<Order> {
    const offerer = await this.provider.getSigner().getAddress();

    const fillsKey = allowPartialFills ? "PARTIAL" : "FULL";
    const restrictedKey = restrictedByZone ? "RESTRICTED" : "OPEN";
    const proxyKey = useProxy ? "VIA_PROXY" : "WITHOUT_PROXY";

    const orderType =
      ORDER_OPTIONS_TO_ORDER_TYPE[fillsKey][restrictedKey][proxyKey];

    const offerItems = offer.map(mapInputItemToOfferItem);

    const considerationItems = [
      ...consideration.map((consideration) => ({
        ...mapInputItemToOfferItem(consideration),
        recipient: consideration.recipient ?? offerer,
      })),
    ];

    const currencies = [...offerItems, ...considerationItems].filter(
      isCurrencyItem
    );

    const totalCurrencyAmount = totalItemsAmount(currencies);

    const orderParameters: OrderParameters = {
      offerer,
      zone,
      startTime,
      endTime,
      orderType,
      offer: offer.map(mapInputItemToOfferItem),
      consideration: [
        ...considerationItems,
        ...(fees?.map((fee) =>
          feeToConsiderationItem({
            fee,
            token: currencies[0].token,
            baseAmount: totalCurrencyAmount.startAmount,
            baseEndAmount: totalCurrencyAmount.endAmount,
          })
        ) ?? []),
      ],
      salt,
    };

    validateOrderParameters(orderParameters, this.provider);
    checkApprovals(orderParameters, {
      considerationContract: this.contract,
      legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
      provider: this.provider,
    });

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

    const signature = await signer._signTypedData(
      domainData,
      EIP_712_ORDER_TYPE,
      orderComponents
    );

    // Use EIP-2098 compact signatures to save gas. https://eips.ethereum.org/EIPS/eip-2098
    return ethers.utils.splitSignature(signature).compact;
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

  public fulfillOrder(order: Order, useFulfillerProxy = false) {
    if (shouldUseBasicFulfill(order)) {
      return fulfillBasicOrder(order, useFulfillerProxy, this.contract);
    }

    // TODO: Implement more advanced order fulfillment
    return null;
  }
}
