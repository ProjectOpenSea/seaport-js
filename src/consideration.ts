import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumberish, Contract, ethers, providers } from "ethers";
import { ConsiderationABI } from "./abi/Consideration";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
} from "./constants";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
import type {
  ConsiderationConfig,
  CreateOrderInput,
  Order,
  OrderComponents,
  OrderCreateYields,
  OrderExchangeYields,
  OrderParameters,
  OrderUseCase,
} from "./types";
import { setNeededApprovals } from "./utils/approval";
import { getBalancesAndApprovals } from "./utils/balancesAndApprovals";
import {
  fulfillBasicOrder,
  fulfillStandardOrder,
  shouldUseBasicFulfill,
} from "./utils/fulfill";
import { isCurrencyItem } from "./utils/item";
import {
  feeToConsiderationItem,
  getNonce,
  getOrderHash,
  getOrderStatus,
  mapInputItemToOfferItem,
  ORDER_OPTIONS_TO_ORDER_TYPE,
  totalItemsAmount,
  useOffererProxy,
  validateOrderParameters,
} from "./utils/order";
import { getProxy } from "./utils/proxy";

export class Consideration {
  // Provides the raw interface to the contract for flexibility
  public contract: ConsiderationContract;

  private provider: providers.JsonRpcProvider;

  // Use the multicall provider for reads for batching and performance optimisations
  // NOTE: Do NOT await between sequential requests if you're intending to batch
  // instead, use Promise.all() and map to fetch data in parallel
  // https://www.npmjs.com/package/@0xsequence/multicall
  private multicallProvider: multicallProviders.MulticallProvider;

  private config: Required<Omit<ConsiderationConfig, "overrides">>;
  private legacyProxyRegistryAddress: string;

  public constructor(
    provider: providers.JsonRpcProvider,
    {
      overrides,
      ascendingAmountFulfillmentBuffer = 1800,
      approveExactAmount = false,
      safetyChecksOnOrderCreation = true,
      safetyChecksOnOrderFulfillment = true,
    }: ConsiderationConfig
  ) {
    this.provider = provider;
    this.multicallProvider = new multicallProviders.MulticallProvider(provider);

    this.contract = new Contract(
      overrides?.contractAddress ?? "",
      ConsiderationABI,
      provider.getSigner()
    ) as ConsiderationContract;

    this.config = {
      ascendingAmountFulfillmentBuffer,
      approveExactAmount,
      safetyChecksOnOrderCreation,
      safetyChecksOnOrderFulfillment,
    };

    this.legacyProxyRegistryAddress =
      overrides?.legacyProxyRegistryAddress ?? "";
  }

  private _getOrderTypeFromOrderOptions({
    allowPartialFills,
    restrictedByZone,
    useProxy,
  }: Pick<
    CreateOrderInput,
    "allowPartialFills" | "restrictedByZone" | "useProxy"
  >) {
    const fillsKey = allowPartialFills ? "PARTIAL" : "FULL";
    const restrictedKey = restrictedByZone ? "RESTRICTED" : "OPEN";
    const proxyKey = useProxy ? "VIA_PROXY" : "WITHOUT_PROXY";

    const orderType =
      ORDER_OPTIONS_TO_ORDER_TYPE[fillsKey][restrictedKey][proxyKey];

    return orderType;
  }

  // Check if single offer 721/1155 - if so do NOT use proxy
  // Check to see if theres sufficient approvals on consideration. if so use it
  // If not, check if theres proxies, and then check in proxy for approvals. If it has enough approvals, then use proxy
  public async createOrder({
    zone = ethers.constants.AddressZero,
    startTime,
    endTime,
    offer,
    consideration,
    nonce,
    allowPartialFills,
    restrictedByZone,
    // TODO: abstract
    useProxy,
    fees,
    salt = ethers.utils.randomBytes(16),
  }: CreateOrderInput): Promise<OrderUseCase<OrderCreateYields>> {
    const offerer = await this.provider.getSigner().getAddress();
    const orderType = this._getOrderTypeFromOrderOptions({
      allowPartialFills,
      restrictedByZone,
      useProxy,
    });
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

    const [proxy, resolvedNonce] = await Promise.all([
      getProxy(offerer, {
        legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
        multicallProvider: this.multicallProvider,
      }),
      nonce ??
        getNonce(
          { offerer, zone },
          {
            considerationContract: this.contract,
            multicallProvider: this.multicallProvider,
          }
        ),
    ]);

    const balancesAndApprovals = await getBalancesAndApprovals(
      offerer,
      orderParameters.offer,
      {
        proxy,
        considerationContract: this.contract,
        multicallProvider: this.multicallProvider,
      }
    );

    const insufficientApprovals = validateOrderParameters(orderParameters, {
      balancesAndApprovals,
    });

    const signOrder = this.signOrder.bind(this);

    async function* execute() {
      yield* setNeededApprovals(insufficientApprovals, {
        provider: this.provider,
      });

      const signature = await signOrder(orderParameters, resolvedNonce);

      yield {
        type: "create",
        order: {
          ...orderParameters,
          nonce: resolvedNonce,
          signature,
        },
      } as const;
    }

    return { insufficientApprovals, execute };
  }

  public async signOrder(
    orderParameters: OrderParameters,
    nonce: BigNumberish
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
      nonce,
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

  /**
   * Fulfills an order through either the basic fulfill methods or the standard method
   * Units to fill are denominated by the max possible size of the order, which is the greatest common denominator (GCD).
   * We expose a helper to get this: getMaximumSizeForOrder
   * i.e. If the maximum size of an order is 4, supplying 2 as the units to fulfill will fill half of the order
   */
  public async fulfillOrder(
    order: Order,
    { unitsToFill }: { unitsToFill?: BigNumberish }
  ): Promise<OrderUseCase<OrderExchangeYields>> {
    const { parameters: orderParameters } = order;
    const { orderType, offerer, zone, offer, consideration } = orderParameters;

    const fulfiller = await this.provider.getSigner().getAddress();

    const shouldUseOffererProxy = useOffererProxy(orderType);

    const [offererProxy, fulfillerProxy, nonce, latestBlock] =
      await Promise.all([
        shouldUseOffererProxy
          ? getProxy(offerer, {
              legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
              multicallProvider: this.multicallProvider,
            })
          : undefined,
        getProxy(fulfiller, {
          legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
          multicallProvider: this.multicallProvider,
        }),
        getNonce(
          { offerer, zone },
          {
            considerationContract: this.contract,
            multicallProvider: this.multicallProvider,
          }
        ),
        this.multicallProvider.getBlockNumber(),
      ]);

    const [
      offererBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      currentBlock,
    ] = await Promise.all([
      getBalancesAndApprovals(offerer, offer, {
        proxy: offererProxy,
        considerationContract: this.contract,
        multicallProvider: this.multicallProvider,
      }),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals(fulfiller, [...offer, ...consideration], {
        proxy: fulfillerProxy,
        considerationContract: this.contract,
        multicallProvider: this.multicallProvider,
      }),
      this.multicallProvider.getBlock(latestBlock),
    ]);

    const currentBlockTimestamp = currentBlock.timestamp;

    const { isValidated, isCancelled, totalFilled, totalSize } =
      await getOrderStatus(getOrderHash({ ...orderParameters, nonce }), {
        considerationContract: this.contract,
        provider: this.provider,
      });

    if (isCancelled) {
      throw new Error("The order you are trying to fulfill is cancelled");
    }

    if (isValidated) {
      // If the order is already validated, manually wipe the signature off of the order to save gas
      order.signature = "";
    }

    const timeBasedItemParams = {
      startTime: order.parameters.startTime,
      endTime: order.parameters.endTime,
      currentBlockTimestamp,
      ascendingAmountTimestampBuffer:
        this.config.ascendingAmountFulfillmentBuffer,
    };

    // We use basic fulfills as they are more optimal for simple and "hot" use cases
    if (shouldUseBasicFulfill(order.parameters, totalFilled)) {
      // TODO: Use fulfiller proxy if there are approvals needed directly, but none needed for proxy
      return fulfillBasicOrder(order, {
        considerationContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        provider: this.provider,
        timeBasedItemParams,
      });
    }

    // Else, we fallback to the standard fulfill order
    return fulfillStandardOrder(
      order,
      { unitsToFill, totalFilled, totalSize },
      {
        considerationContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        provider: this.provider,
        timeBasedItemParams,
      }
    );
  }
}
