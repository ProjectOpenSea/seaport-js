import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumberish, Contract, ethers, providers } from "ethers";
import { formatBytes32String } from "ethers/lib/utils";
import { ConsiderationABI } from "./abi/Consideration";
import { ProxyRegistryInterfaceABI } from "./abi/ProxyRegistryInterface";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
  LEGACY_PROXY_CONDUIT,
  MAX_INT,
  Network,
  NO_CONDUIT,
  OrderType,
} from "./constants";
import { ProxyRegistryInterface } from "./typechain";
import type { Consideration as ConsiderationContract } from "./typechain/Consideration";
import type {
  ApprovalOperators,
  ConsiderationConfig,
  CreatedOrder,
  CreateOrderAction,
  CreateOrderInput,
  ExchangeAction,
  InputCriteria,
  Order,
  OrderComponents,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
  TipInputItem,
  TransactionMethods,
} from "./types";
import { getApprovalActions } from "./utils/approval";
import {
  getBalancesAndApprovals,
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
import { getMaximumSizeForOrder, isCurrencyItem } from "./utils/item";
import { LEGACY_PROXY_ADDRESSES } from "./utils/legacyAddresses";
import {
  areAllCurrenciesSame,
  deductFees,
  feeToConsiderationItem,
  generateRandomSalt,
  mapInputItemToOfferItem,
  totalItemsAmount,
} from "./utils/order";
import { executeAllActions, getTransactionMethods } from "./utils/usecase";

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
  private legacyTokenTransferProxyAddress: string;

  /**
   * @param provider - The provider to use for web3-related calls
   * @param considerationConfig - A config to provide flexibility in the usage of Consideration
   */
  public constructor(
    provider: providers.JsonRpcProvider,
    {
      overrides,
      ascendingAmountFulfillmentBuffer = 1800,
      approveExactAmount = false,
      balanceAndApprovalChecksOnOrderCreation = true,
      network = Network.MAINNET,
    }: ConsiderationConfig
  ) {
    this.provider = provider;
    this.multicallProvider = new multicallProviders.MulticallProvider(provider);

    this.contract = new Contract(
      overrides?.contractAddress ?? "",
      ConsiderationABI,
      this.multicallProvider
    ) as ConsiderationContract;

    this.config = {
      ascendingAmountFulfillmentBuffer,
      approveExactAmount,
      balanceAndApprovalChecksOnOrderCreation,
      network,
    };

    this.legacyProxyRegistryAddress =
      overrides?.legacyProxyRegistryAddress ??
      LEGACY_PROXY_ADDRESSES[network].WyvernProxyRegistry;
    this.legacyTokenTransferProxyAddress =
      overrides?.legacyTokenTransferProxy ??
      LEGACY_PROXY_ADDRESSES[network].WyvernTokenTransferProxy;
  }

  /**
   * Returns the corresponding order type based on whether it allows partial fills and is restricted by zone
   *
   * @param input
   * @param input.allowPartialFills Whether or not the order can be partially filled
   * @param input.restrictedByZone Whether or not the order can only be filled/cancelled by the zone
   * @returns the order type
   */
  private _getOrderTypeFromOrderOptions({
    allowPartialFills,
    restrictedByZone,
  }: Pick<CreateOrderInput, "allowPartialFills" | "restrictedByZone">) {
    if (allowPartialFills) {
      return restrictedByZone
        ? OrderType.PARTIAL_RESTRICTED
        : OrderType.PARTIAL_OPEN;
    }

    return restrictedByZone ? OrderType.FULL_RESTRICTED : OrderType.FULL_OPEN;
  }

  private _getConduitOperators(
    address: string,
    conduit: string
  ): Promise<ApprovalOperators> {
    if (conduit === NO_CONDUIT) {
      return Promise.resolve({
        operator: this.contract.address,
        erc20Operator: this.contract.address,
      });
    }

    if (conduit === LEGACY_PROXY_CONDUIT) {
      const proxyRegistryInterface = new Contract(
        this.legacyProxyRegistryAddress,
        ProxyRegistryInterfaceABI,
        this.multicallProvider
      ) as ProxyRegistryInterface;

      return Promise.all([
        proxyRegistryInterface.proxies(address),
        this.legacyTokenTransferProxyAddress,
      ]).then(([operator, erc20Operator]) => ({
        operator,
        erc20Operator,
      }));
    }

    return Promise.resolve({ operator: conduit, erc20Operator: conduit });
  }

  /**
   * Returns a use case that will create an order.
   * The use case will contain the list of actions necessary to finish creating an order.
   * The list of actions will either be an approval if approvals are necessary
   * or a signature request that will then be supplied into the final Order struct, ready to be fulfilled.
   *
   * @param input
   * @param input.conduit The address to source your approvals from. Defaults to address(0) which refers to the Consideration contract.
   *                      Another special value is address(1) will refer to the legacy proxy. All other values refer to the specified address
   * @param input.zone The zone of the order. Defaults to the zero address.
   * @param input.startTime The start time of the order. Defaults to the current unix time.
   * @param input.endTime The end time of the order. Defaults to "never end".
   *                      It is HIGHLY recommended to pass in an explicit end time
   * @param input.offer The items you are willing to offer. This is a condensed version of the Consideration struct OfferItem for convenience
   * @param input.consideration The items that will go to their respective recipients upon receiving your offer.
   * @param input.nonce The nonce from which to create the order with. Automatically fetched from the contract if not provided
   * @param input.allowPartialFills Whether to allow the order to be partially filled
   * @param input.restrictedByZone Whether the order should be restricted by zone
   * @param input.fees Convenience array to apply fees onto the order. The fees will be deducted from the
   *                   existing consideration items and then tacked on as new consideration items
   * @param input.salt Random salt
   * @param input.offerer The order's creator address. Defaults to the first address on the provider.
   * @param accountAddress Optional address for which to create the order with
   * @returns a use case containing the list of actions needed to be performed in order to create the order
   */
  public async createOrder(
    {
      conduit = NO_CONDUIT,
      zone = ethers.constants.AddressZero,
      startTime = Math.floor(Date.now() / 1000).toString(),
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

    if (
      !areAllCurrenciesSame({
        offer: offerItems,
        consideration: considerationItems,
      })
    ) {
      throw new Error(
        "All currency tokens in the order must be the same token"
      );
    }

    const currencies = [...offerItems, ...considerationItems].filter(
      isCurrencyItem
    );

    const totalCurrencyAmount = totalItemsAmount(currencies);

    const [operators, resolvedNonce] = await Promise.all([
      this._getConduitOperators(offerer, conduit),
      nonce ?? this.getNonce(offerer),
    ]);

    const balancesAndApprovals = await getBalancesAndApprovals({
      owner: offerer,
      items: offerItems,
      criterias: [],
      multicallProvider: this.multicallProvider,
      operators,
    });

    const orderType = this._getOrderTypeFromOrderOptions({
      allowPartialFills,
      restrictedByZone,
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
      conduit,
    };

    const checkBalancesAndApprovals =
      this.config.balanceAndApprovalChecksOnOrderCreation;

    const insufficientApprovals = validateOfferBalancesAndApprovals({
      offer: offerItems,
      criterias: [],
      balancesAndApprovals,
      throwOnInsufficientBalances: checkBalancesAndApprovals,
      operators,
    });

    const approvalActions = checkBalancesAndApprovals
      ? await getApprovalActions(insufficientApprovals, signer)
      : [];

    const createOrderAction = {
      type: "create",
      createOrder: async () => {
        const signature = await this.signOrder(
          orderParameters,
          resolvedNonce,
          offerer
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

  /**
   * Submits a request to your provider to sign the order. Signed orders are used for off-chain order books.
   * @param orderParameters standard order parameter struct
   * @param nonce nonce of the offerer
   * @param accountAddress optional account address from which to sign the order with.
   * @returns the order signature
   */
  public async signOrder(
    orderParameters: OrderParameters,
    nonce: number,
    accountAddress?: string
  ): Promise<string> {
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

  /**
   * Cancels a list of orders so that they are no longer fulfillable.
   *
   * @param orders list of order components
   * @param accountAddress optional account address from which to cancel the orders from.
   * @returns the set of transaction methods that can be used
   */
  public cancelOrders(
    orders: OrderComponents[],
    accountAddress?: string
  ): TransactionMethods {
    const signer = this.provider.getSigner(accountAddress);

    return getTransactionMethods(this.contract.connect(signer), "cancel", [
      orders,
    ]);
  }

  /**
   * Bulk cancels all existing orders for a given account
   * @param offerer the account to bulk cancel orders on
   * @returns the set of transaction methods that can be used
   */
  public bulkCancelOrders(offerer?: string): TransactionMethods {
    const signer = this.provider.getSigner(offerer);

    return getTransactionMethods(
      this.contract.connect(signer),
      "incrementNonce",
      []
    );
  }

  /**
   * Approves a list of orders on-chain. This allows accounts to fulfill the order without requiring
   * a signature
   * @param orders list of order structs
   * @param accountAddress optional account address to approve orders.
   * @returns the set of transaction methods that can be used
   */
  public approveOrders(
    orders: Order[],
    accountAddress?: string
  ): TransactionMethods {
    const signer = this.provider.getSigner(accountAddress);

    return getTransactionMethods(this.contract.connect(signer), "validate", [
      orders,
    ]);
  }

  /**
   * Returns the order status given an order hash
   * @param orderHash the hash of the order
   * @returns an order status struct
   */
  public getOrderStatus(orderHash: string): Promise<OrderStatus> {
    return this.contract.getOrderStatus(orderHash);
  }

  /**
   * Gets the nonce of a given offerer
   * @param offerer the offerer to get the nonce of
   * @returns nonce as a number
   */
  public getNonce(offerer: string): Promise<number> {
    return this.contract.getNonce(offerer).then((nonce) => nonce.toNumber());
  }

  /**
   * Calculates the order hash of order components so we can forgo executing a request to the contract
   * This saves us RPC calls and latency.
   */
  public getOrderHash = (orderComponents: OrderComponents): string => {
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
   * @param input
   * @param input.order The standard order struct
   * @param input.unitsToFill the number of units to fill for the given order. Only used if you wish to partially fill an order
   * @param input.offerCriteria an array of criteria with length equal to the number of offer criteria items
   * @param input.considerationCriteria an array of criteria with length equal to the number of consideration criteria items
   * @param input.tips an array of optional condensed consideration items to be added onto a fulfillment
   * @param input.extraData extra data supplied to the order
   * @param input.accountAddress optional address from which to fulfill the order from
   * @param input.conduit the conduit to source approvals from
   * @returns a use case containing the set of approval actions and fulfillment action
   */
  public async fulfillOrder({
    order,
    unitsToFill,
    offerCriteria = [],
    considerationCriteria = [],
    tips = [],
    extraData = "0x",
    accountAddress,
    conduit = NO_CONDUIT,
  }: {
    order: Order;
    unitsToFill?: BigNumberish;
    offerCriteria?: InputCriteria[];
    considerationCriteria?: InputCriteria[];
    tips?: TipInputItem[];
    extraData?: string;
    accountAddress?: string;
    conduit?: string;
  }): Promise<OrderUseCase<ExchangeAction>> {
    const { parameters: orderParameters } = order;
    const { offerer, offer, consideration } = orderParameters;

    const fulfiller = await this.provider.getSigner(accountAddress);

    const fulfillerAddress = await fulfiller.getAddress();

    const [offererOperators, fulfillerOperators, nonce] = await Promise.all([
      this._getConduitOperators(offerer, orderParameters.conduit),
      this._getConduitOperators(fulfillerAddress, conduit),
      this.getNonce(offerer),
    ]);

    const [
      offererBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      currentBlock,
      orderStatus,
    ] = await Promise.all([
      getBalancesAndApprovals({
        owner: offerer,
        items: offer,
        criterias: offerCriteria,
        multicallProvider: this.multicallProvider,
        operators: offererOperators,
      }),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals({
        owner: fulfillerAddress,
        items: [...offer, ...consideration],
        criterias: [...offerCriteria, ...considerationCriteria],
        multicallProvider: this.multicallProvider,
        operators: fulfillerOperators,
      }),
      this.multicallProvider.getBlock("latest"),
      this.getOrderStatus(this.getOrderHash({ ...orderParameters, nonce })),
    ]);

    const currentBlockTimestamp = currentBlock.timestamp;

    const { totalFilled, totalSize } = orderStatus;

    const sanitizedOrder = validateAndSanitizeFromOrderStatus(
      order,
      orderStatus
    );

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
      return fulfillBasicOrder({
        order: sanitizedOrder,
        considerationContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        conduit,
        offererOperators,
        fulfillerOperators,
        signer: fulfiller,
        tips: tipConsiderationItems,
      });
    }

    // Else, we fallback to the standard fulfill order
    return fulfillStandardOrder({
      order: sanitizedOrder,
      unitsToFill,
      totalFilled,
      totalSize: totalSize.eq(0)
        ? getMaximumSizeForOrder(sanitizedOrder)
        : totalSize,
      offerCriteria,
      considerationCriteria,
      tips: tipConsiderationItems,
      extraData,
      considerationContract: this.contract,
      offererBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      timeBasedItemParams,
      conduit,
      signer: fulfiller,
      offererOperators,
      fulfillerOperators,
    });
  }

  /**
   * Fulfills a list of orders in a best-effort fashion
   */
  public async fulfillOrders({
    fulfillOrderDetails,
    accountAddress,
    conduit = NO_CONDUIT,
  }: {
    conduit?: string;
    fulfillOrderDetails: {
      order: Order;
      unitsToFill?: BigNumberish;
      offerCriteria?: InputCriteria[];
      considerationCriteria?: InputCriteria[];
      tips?: TipInputItem[];
      extraData?: string;
    }[];
    accountAddress?: string;
  }) {
    const fulfiller = await this.provider.getSigner(accountAddress);

    const fulfillerAddress = await fulfiller.getAddress();

    const uniqueOfferers = [
      ...new Set(
        fulfillOrderDetails.map(({ order }) => order.parameters.offerer)
      ),
    ];

    const [allOffererOperators, fulfillerOperators, offererNonces] =
      await Promise.all([
        Promise.all(
          fulfillOrderDetails.map(({ order }) =>
            this._getConduitOperators(
              order.parameters.offerer,
              order.parameters.conduit
            )
          )
        ),
        this._getConduitOperators(fulfillerAddress, conduit),
        Promise.all(uniqueOfferers.map((offerer) => this.getNonce(offerer))),
      ]);

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
      offerersBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      currentBlock,
      orderStatuses,
    ] = await Promise.all([
      Promise.all(
        fulfillOrderDetails.map(({ order, offerCriteria = [] }, i) =>
          getBalancesAndApprovals({
            owner: order.parameters.offerer,
            items: order.parameters.offer,
            criterias: offerCriteria,
            operators: allOffererOperators[i],
            multicallProvider: this.multicallProvider,
          })
        )
      ),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals({
        owner: fulfillerAddress,
        items: [...allOfferItems, ...allConsiderationItems],
        criterias: [...allOfferCriteria, ...allConsiderationCriteria],
        operators: fulfillerOperators,
        multicallProvider: this.multicallProvider,
      }),
      this.multicallProvider.getBlock("latest"),
      Promise.all(
        fulfillOrderDetails.map(({ order }) =>
          this.getOrderStatus(
            this.getOrderHash({
              ...order.parameters,
              nonce:
                offererNonces[uniqueOfferers.indexOf(order.parameters.offerer)],
            })
          )
        )
      ),
    ]);

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
        offererBalancesAndApprovals: offerersBalancesAndApprovals[index],
        offererOperators: allOffererOperators[index],
      })
    );

    return fulfillAvailableOrders({
      ordersMetadata,
      considerationContract: this.contract,
      fulfillerBalancesAndApprovals,
      currentBlockTimestamp: currentBlock.timestamp,
      ascendingAmountTimestampBuffer:
        this.config.ascendingAmountFulfillmentBuffer,
      fulfillerOperators,
      signer: fulfiller,
      conduit,
    });
  }
}
