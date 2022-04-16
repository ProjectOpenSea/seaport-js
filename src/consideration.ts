import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumberish, Contract, ethers, providers } from "ethers";
import { formatBytes32String } from "ethers/lib/utils";
import { ConsiderationABI } from "./abi/Consideration";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
  MAX_INT,
  ProxyStrategy,
} from "./constants";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
import type {
  ConsiderationConfig,
  CreatedOrder,
  CreateOrderAction,
  CreateOrderInput,
  ExchangeAction,
  InputCriteria,
  OfferItem,
  Order,
  OrderComponents,
  OrderParameters,
  OrderUseCase,
  TipInputItem,
} from "./types";
import { getApprovalActions } from "./utils/approval";
import {
  BalancesAndApprovals,
  getBalancesAndApprovals,
  getInsufficientBalanceAndApprovalAmounts,
  validateOfferBalancesAndApprovals,
} from "./utils/balanceAndApprovalCheck";
import {
  fulfillAvailableOrders,
  fulfillBasicOrder,
  FulfillOrdersMetadata,
  fulfillStandardOrder,
  shouldUseBasicFulfill,
  validateAndSanitizeFromOrderStatus,
} from "./utils/fulfill";
import {
  getMaximumSizeForOrder,
  getSummedTokenAndIdentifierAmounts,
  isCurrencyItem,
} from "./utils/item";
import {
  areAllCurrenciesSame,
  deductFees,
  feeToConsiderationItem,
  generateRandomSalt,
  mapInputItemToOfferItem,
  ORDER_OPTIONS_TO_ORDER_TYPE,
  totalItemsAmount,
  useProxyFromApprovals,
} from "./utils/order";
import { getProxy } from "./utils/proxy";
import { executeAllActions } from "./utils/usecase";

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
      balanceAndApprovalChecksOnOrderCreation = true,
      proxyStrategy = ProxyStrategy.IF_ZERO_APPROVALS_NEEDED,
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
      balanceAndApprovalChecksOnOrderCreation,
      proxyStrategy,
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

  public async createOrder(
    {
      zone = ethers.constants.AddressZero,
      // Default to current unix time.
      startTime = Math.floor(Date.now() / 1000).toString(),
      // Defaulting to "never end". We HIGHLY recommend passing in an explicit end time
      endTime = MAX_INT.toString(),
      offer,
      consideration,
      nonce,
      allowPartialFills,
      restrictedByZone,
      fees,
      salt = generateRandomSalt(),
    }: CreateOrderInput,
    accountAddress?: string
  ): Promise<OrderUseCase<CreateOrderAction>> {
    const signer = await this.provider.getSigner(accountAddress);
    const offerer = await signer.getAddress();
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

    const [proxy, resolvedNonce] = await Promise.all([
      getProxy(offerer, {
        legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
        multicallProvider: this.multicallProvider,
      }),
      nonce ?? this.getNonce(offerer),
    ]);

    const balancesAndApprovals = await getBalancesAndApprovals(
      offerer,
      offerItems,
      [],
      {
        proxy,
        considerationContract: this.contract,
        multicallProvider: this.multicallProvider,
      }
    );

    const { insufficientOwnerApprovals, insufficientProxyApprovals } =
      getInsufficientBalanceAndApprovalAmounts(
        balancesAndApprovals,
        getSummedTokenAndIdentifierAmounts(offerItems, { criterias: [] }),
        {
          considerationContract: this.contract,
          proxy,
          proxyStrategy: this.config.proxyStrategy,
        }
      );

    const useProxy = useProxyFromApprovals({
      insufficientOwnerApprovals,
      insufficientProxyApprovals,
      proxyStrategy: this.config.proxyStrategy,
    });

    const orderType = this._getOrderTypeFromOrderOptions({
      allowPartialFills,
      restrictedByZone,
      useProxy,
    });

    const considerationItemsWithFees = [
      ...deductFees(considerationItems, fees),
      ...(currencies.length
        ? fees?.map((fee) =>
            feeToConsiderationItem({
              fee,
              token: currencies[0].token,
              baseAmount: totalCurrencyAmount.startAmount,
              baseEndAmount: totalCurrencyAmount.endAmount,
            })
          ) ?? []
        : []),
    ];

    const orderParameters: OrderParameters = {
      offerer,
      zone,
      // TODO: Placeholder
      zoneHash: formatBytes32String(resolvedNonce.toString()),
      startTime,
      endTime,
      orderType,
      offer: offerItems,
      consideration: considerationItemsWithFees,
      totalOriginalConsiderationItems: considerationItemsWithFees.length,
      salt,
    };

    const checkBalancesAndApprovals =
      this.config.balanceAndApprovalChecksOnOrderCreation;

    if (
      !areAllCurrenciesSame({
        offer: offerItems,
        consideration: considerationItemsWithFees,
      })
    ) {
      throw new Error(
        "All currency tokens in the order must be the same token"
      );
    }

    const insufficientApprovals = validateOfferBalancesAndApprovals(
      { offer: offerItems, orderType, criterias: [] },
      {
        balancesAndApprovals,
        throwOnInsufficientBalances: checkBalancesAndApprovals,
        considerationContract: this.contract,
        proxy,
        proxyStrategy: this.config.proxyStrategy,
      }
    );

    const approvalActions = checkBalancesAndApprovals
      ? await getApprovalActions(insufficientApprovals, {
          signer,
        })
      : [];

    const createOrderAction = {
      type: "create",
      createOrder: async () => {
        const signature = await this.signOrder(
          orderParameters,
          resolvedNonce,
          accountAddress
        );

        return {
          parameters: orderParameters,
          nonce: resolvedNonce,
          signature,
        };
      },
    } as const;

    const actions = [...approvalActions, createOrderAction] as const;

    return {
      actions,
      executeAllActions: () =>
        executeAllActions(actions) as Promise<CreatedOrder>,
    };
  }

  public async signOrder(
    orderParameters: OrderParameters,
    nonce: number,
    accountAddress?: string
  ) {
    const signer = this.provider.getSigner(accountAddress);
    const { chainId } = await this.provider.getNetwork();

    const domainData = {
      name: CONSIDERATION_CONTRACT_NAME,
      version: CONSIDERATION_CONTRACT_VERSION,
      chainId,
      verifyingContract: this.contract.address,
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

  public async cancelOrders(
    orders: OrderComponents[],
    accountAddress?: string
  ) {
    const signer = this.provider.getSigner(accountAddress);
    return this.contract.connect(signer).cancel(orders);
  }

  public async bulkCancelOrders(offerer?: string) {
    const signer = this.provider.getSigner(offerer);

    return this.contract.connect(signer).incrementNonce();
  }

  public async approveOrders(orders: Order[], accountAddress?: string) {
    const signer = this.provider.getSigner(accountAddress);

    return this.contract.connect(signer).validate(orders);
  }

  public getOrderStatus(orderHash: string) {
    return this.contract.getOrderStatus(orderHash);
  }

  public getNonce(offerer: string) {
    return this.contract.getNonce(offerer).then((nonce) => nonce.toNumber());
  }

  /**
   * Calculates the order hash of order components so we can forgo executing a request to the contract
   * This saves us RPC calls and latency.
   */
  public getOrderHash = (orderComponents: OrderComponents) => {
    const offerItemTypeString =
      "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";
    const considerationItemTypeString =
      "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)";
    const orderComponentsPartialTypeString =
      "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,uint256 salt,uint256 nonce)";
    const orderTypeString = `${orderComponentsPartialTypeString}${considerationItemTypeString}${offerItemTypeString}`;

    const offerItemTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(offerItemTypeString)
    );
    const considerationItemTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(considerationItemTypeString)
    );
    const orderTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(orderTypeString)
    );

    const offerHash = ethers.utils.keccak256(
      "0x" +
        orderComponents.offer
          .map((offerItem) => {
            return ethers.utils
              .keccak256(
                "0x" +
                  [
                    offerItemTypeHash.slice(2),
                    offerItem.itemType.toString().padStart(64, "0"),
                    offerItem.token.slice(2).padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.identifierOrCriteria)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.startAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.endAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                  ].join("")
              )
              .slice(2);
          })
          .join("")
    );

    const considerationHash = ethers.utils.keccak256(
      "0x" +
        orderComponents.consideration
          .map((considerationItem) => {
            return ethers.utils
              .keccak256(
                "0x" +
                  [
                    considerationItemTypeHash.slice(2),
                    considerationItem.itemType.toString().padStart(64, "0"),
                    considerationItem.token.slice(2).padStart(64, "0"),
                    ethers.BigNumber.from(
                      considerationItem.identifierOrCriteria
                    )
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(considerationItem.startAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(considerationItem.endAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    considerationItem.recipient.slice(2).padStart(64, "0"),
                  ].join("")
              )
              .slice(2);
          })
          .join("")
    );

    const derivedOrderHash = ethers.utils.keccak256(
      "0x" +
        [
          orderTypeHash.slice(2),
          orderComponents.offerer.slice(2).padStart(64, "0"),
          orderComponents.zone.slice(2).padStart(64, "0"),
          offerHash.slice(2),
          considerationHash.slice(2),
          orderComponents.orderType.toString().padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.startTime)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.endTime)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
          orderComponents.salt.slice(2).padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.nonce)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
        ].join("")
    );

    return derivedOrderHash;
  };

  /**
   * Fulfills an order through either the basic method or the standard method
   * Units to fill are denominated by the max possible size of the order, which is the greatest common denominator (GCD).
   * We expose a helper to get this: getMaximumSizeForOrder
   * i.e. If the maximum size of an order is 4, supplying 2 as the units to fulfill will fill half of the order
   */
  public async fulfillOrder({
    order,
    unitsToFill,
    offerCriteria = [],
    considerationCriteria = [],
    tips = [],
    extraData,
    accountAddress,
  }: {
    order: Order;
    unitsToFill?: BigNumberish;
    offerCriteria?: InputCriteria[];
    considerationCriteria?: InputCriteria[];
    tips?: TipInputItem[];
    extraData?: string;
    accountAddress?: string;
  }): Promise<OrderUseCase<ExchangeAction>> {
    const { parameters: orderParameters } = order;
    const { offerer, offer, consideration } = orderParameters;

    const fulfiller = await this.provider.getSigner(accountAddress);

    const fulfillerAddress = await fulfiller.getAddress();

    const [offererProxy, fulfillerProxy, nonce] = await Promise.all([
      getProxy(offerer, {
        legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
        multicallProvider: this.multicallProvider,
      }),
      getProxy(fulfillerAddress, {
        legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
        multicallProvider: this.multicallProvider,
      }),
      this.getNonce(offerer),
    ]);

    const [
      offererBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      currentBlock,
      orderStatus,
    ] = await Promise.all([
      getBalancesAndApprovals(offerer, offer, offerCriteria, {
        proxy: offererProxy,
        considerationContract: this.contract,
        multicallProvider: this.multicallProvider,
      }),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals(
        fulfillerAddress,
        [...offer, ...consideration],
        [...offerCriteria, ...considerationCriteria],
        {
          proxy: fulfillerProxy,
          considerationContract: this.contract,
          multicallProvider: this.multicallProvider,
        }
      ),
      this.multicallProvider.getBlock("latest"),
      this.getOrderStatus(this.getOrderHash({ ...orderParameters, nonce })),
    ]);

    const currentBlockTimestamp = currentBlock.timestamp;

    const { totalFilled, totalSize } = orderStatus;

    const sanitizedOrder = validateAndSanitizeFromOrderStatus({
      order,
      orderStatus,
    });

    const timeBasedItemParams = {
      startTime: sanitizedOrder.parameters.startTime,
      endTime: sanitizedOrder.parameters.endTime,
      currentBlockTimestamp,
      ascendingAmountTimestampBuffer:
        this.config.ascendingAmountFulfillmentBuffer,
    };

    const tipConsiderationItems = tips.map((tip) => ({
      ...mapInputItemToOfferItem(tip),
      recipient: tip.recipient,
    }));

    // We use basic fulfills as they are more optimal for simple and "hot" use cases
    // We cannot use basic fulfill if user is trying to partially fill though.
    if (
      !unitsToFill &&
      shouldUseBasicFulfill(sanitizedOrder.parameters, totalFilled)
    ) {
      // TODO: Use fulfiller proxy if there are approvals needed directly, but none needed for proxy
      return fulfillBasicOrder(sanitizedOrder, {
        considerationContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        offererProxy,
        fulfillerProxy,
        proxyStrategy: this.config.proxyStrategy,
        signer: fulfiller,
        tips: tipConsiderationItems,
      });
    }

    // Else, we fallback to the standard fulfill order
    return fulfillStandardOrder(
      sanitizedOrder,
      {
        unitsToFill,
        totalFilled,
        totalSize: totalSize.eq(0)
          ? getMaximumSizeForOrder(sanitizedOrder)
          : totalSize,
        offerCriteria,
        considerationCriteria,
        tips: tipConsiderationItems,
        extraData,
      },
      {
        considerationContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        offererProxy,
        fulfillerProxy,
        proxyStrategy: this.config.proxyStrategy,
        signer: fulfiller,
      }
    );
  }

  /**
   * Fulfills a list of orders in a best-effort fashion
   */
  public async fulfillOrders(
    fulfillOrderDetails: {
      order: Order;
      unitsToFill?: BigNumberish;
      offerCriteria?: InputCriteria[];
      considerationCriteria?: InputCriteria[];
      tips?: TipInputItem[];
      extraData?: string;
    }[],
    accountAddress?: string
  ) {
    const fulfiller = await this.provider.getSigner(accountAddress);

    const fulfillerAddress = await fulfiller.getAddress();

    const uniqueOfferers = [
      ...new Set(
        fulfillOrderDetails.map(({ order }) => order.parameters.offerer)
      ),
    ];

    const [offererProxies, fulfillerProxy, offererNonces] = await Promise.all([
      Promise.all(
        uniqueOfferers.map((offerer) =>
          getProxy(offerer, {
            legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
            multicallProvider: this.multicallProvider,
          })
        )
      ),
      getProxy(fulfillerAddress, {
        legacyProxyRegistryAddress: this.legacyProxyRegistryAddress,
        multicallProvider: this.multicallProvider,
      }),
      Promise.all(uniqueOfferers.map(this.getNonce)),
    ]);

    const offererOrderMetadata: Record<
      string,
      {
        proxy: string;
        nonce: number;
        items: OfferItem[];
        criteria: InputCriteria[];
        balancesAndApprovals: BalancesAndApprovals;
      }
    > = {};

    uniqueOfferers.forEach((offerer, i) => {
      offererOrderMetadata[offerer] = {
        proxy: offererProxies[i],
        nonce: offererNonces[i],
        items: fulfillOrderDetails
          .filter(({ order }) => order.parameters.offerer === offerer)
          .flatMap(({ order }) => order.parameters.offer),
        criteria: fulfillOrderDetails
          .filter(({ order }) => order.parameters.offerer === offerer)
          .flatMap(({ offerCriteria = [] }) => offerCriteria),
        balancesAndApprovals: [],
      };
    });

    const allOfferItems = fulfillOrderDetails.flatMap(
      ({ order }) => order.parameters.offer
    );

    const allConsiderationItems = fulfillOrderDetails.flatMap(
      ({ order }) => order.parameters.consideration
    );
    const allOfferCriteria = fulfillOrderDetails.flatMap(
      ({ offerCriteria = [] }) => offerCriteria
    );
    const allConsiderationCriteria = fulfillOrderDetails.flatMap(
      ({ considerationCriteria = [] }) => considerationCriteria
    );

    const [
      uniqueOfferersBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      currentBlock,
      orderStatuses,
    ] = await Promise.all([
      Promise.all(
        uniqueOfferers.map((offerer) =>
          getBalancesAndApprovals(
            offerer,
            offererOrderMetadata[offerer].items,
            offererOrderMetadata[offerer].criteria,
            {
              proxy: offererOrderMetadata[offerer].proxy,
              considerationContract: this.contract,
              multicallProvider: this.multicallProvider,
            }
          )
        )
      ),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals(
        fulfillerAddress,
        [...allOfferItems, ...allConsiderationItems],
        [...allOfferCriteria, ...allConsiderationCriteria],
        {
          proxy: fulfillerProxy,
          considerationContract: this.contract,
          multicallProvider: this.multicallProvider,
        }
      ),
      this.multicallProvider.getBlock("latest"),
      Promise.all(
        fulfillOrderDetails.map(({ order }) =>
          this.getOrderStatus(
            this.getOrderHash({
              ...order.parameters,
              nonce: offererOrderMetadata[order.parameters.offerer].nonce,
            })
          )
        )
      ),
    ]);

    uniqueOfferers.forEach((offerer, i) => {
      offererOrderMetadata[offerer].balancesAndApprovals =
        uniqueOfferersBalancesAndApprovals[i];
    });

    const ordersMetadata: FulfillOrdersMetadata = fulfillOrderDetails.map(
      (orderDetails, index) => ({
        order: orderDetails.order,
        unitsToFill: orderDetails.unitsToFill,
        orderStatus: orderStatuses[index],
        offerCriteria: orderDetails.offerCriteria ?? [],
        considerationCriteria: orderDetails.considerationCriteria ?? [],
        tips:
          orderDetails.tips?.map((tip) => ({
            ...mapInputItemToOfferItem(tip),
            recipient: tip.recipient,
          })) ?? [],
        extraData: orderDetails.extraData ?? "0x",
        offererBalancesAndApprovals:
          offererOrderMetadata[orderDetails.order.parameters.offerer]
            .balancesAndApprovals,
        offererProxy:
          offererOrderMetadata[orderDetails.order.parameters.offerer].proxy,
      })
    );

    return fulfillAvailableOrders({
      ordersMetadata,
      considerationContract: this.contract,
      fulfillerBalancesAndApprovals,
      currentBlockTimestamp: currentBlock.timestamp,
      ascendingAmountTimestampBuffer:
        this.config.ascendingAmountFulfillmentBuffer,
      fulfillerProxy,
      proxyStrategy: this.config.proxyStrategy,
      signer: fulfiller,
    });
  }
}
