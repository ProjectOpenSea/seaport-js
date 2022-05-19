import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumberish, Contract, ethers, providers } from "ethers";
import { formatBytes32String, _TypedDataEncoder } from "ethers/lib/utils";
import { SeaportABI } from "./abi/Seaport";
import {
  CONSIDERATION_CONTRACT_NAME,
  CONSIDERATION_CONTRACT_VERSION,
  EIP_712_ORDER_TYPE,
  KNOWN_CONDUIT_KEYS_TO_CONDUIT,
  MAX_INT,
  Network,
  NO_CONDUIT,
  OrderType,
} from "./constants";
import type { Seaport as SeaportContract } from "./typechain/Seaport";
import type {
  SeaportConfig,
  CreateOrderAction,
  CreateOrderInput,
  ExchangeAction,
  InputCriteria,
  Order,
  OrderComponents,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
  OrderWithNonce,
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
import {
  areAllCurrenciesSame,
  deductFees,
  feeToConsiderationItem,
  generateRandomSalt,
  mapInputItemToOfferItem,
  totalItemsAmount,
} from "./utils/order";
import { executeAllActions, getTransactionMethods } from "./utils/usecase";

export class Seaport {
  // Provides the raw interface to the contract for flexibility
  public contract: SeaportContract;

  private provider: providers.JsonRpcProvider;

  // Use the multicall provider for reads for batching and performance optimisations
  // NOTE: Do NOT await between sequential requests if you're intending to batch
  // instead, use Promise.all() and map to fetch data in parallel
  // https://www.npmjs.com/package/@0xsequence/multicall
  private multicallProvider: multicallProviders.MulticallProvider;

  private config: Required<Omit<SeaportConfig, "overrides">>;

  private defaultConduitKey: string;

  /**
   * @param provider - The provider to use for web3-related calls
   * @param considerationConfig - A config to provide flexibility in the usage of Seaport
   */
  public constructor(
    provider: providers.JsonRpcProvider,
    {
      overrides,
      // Five minute buffer
      ascendingAmountFulfillmentBuffer = 300,
      balanceAndApprovalChecksOnOrderCreation = true,
      network = Network.MAINNET,
      conduitKeyToConduit,
    }: SeaportConfig
  ) {
    this.provider = provider;
    this.multicallProvider = new multicallProviders.MulticallProvider(provider);

    this.contract = new Contract(
      overrides?.contractAddress ?? "",
      SeaportABI,
      this.multicallProvider
    ) as SeaportContract;

    this.config = {
      ascendingAmountFulfillmentBuffer,
      balanceAndApprovalChecksOnOrderCreation,
      network,
      conduitKeyToConduit: {
        ...KNOWN_CONDUIT_KEYS_TO_CONDUIT,
        [NO_CONDUIT]: this.contract.address,
        ...conduitKeyToConduit,
      },
    };

    this.defaultConduitKey = overrides?.defaultConduitKey ?? NO_CONDUIT;
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

  /**
   * Returns a use case that will create an order.
   * The use case will contain the list of actions necessary to finish creating an order.
   * The list of actions will either be an approval if approvals are necessary
   * or a signature request that will then be supplied into the final Order struct, ready to be fulfilled.
   *
   * @param input
   * @param input.conduitKey The conduitKey key to derive where to source your approvals from. Defaults to 0 which refers to the Seaport contract.
   *                         Another special value is address(1) will refer to the legacy proxy. All other must derive to the specified address.
   * @param input.zone The zone of the order. Defaults to the zero address.
   * @param input.startTime The start time of the order. Defaults to the current unix time.
   * @param input.endTime The end time of the order. Defaults to "never end".
   *                      It is HIGHLY recommended to pass in an explicit end time
   * @param input.offer The items you are willing to offer. This is a condensed version of the Seaport struct OfferItem for convenience
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
      conduitKey = this.defaultConduitKey,
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

    const operator = this.config.conduitKeyToConduit[conduitKey];

    const [resolvedNonce, balancesAndApprovals] = await Promise.all([
      nonce ?? this.getNonce(offerer),
      getBalancesAndApprovals({
        owner: offerer,
        items: offerItems,
        criterias: [],
        multicallProvider: this.multicallProvider,
        operator,
      }),
    ]);

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
      conduitKey,
    };

    const checkBalancesAndApprovals =
      this.config.balanceAndApprovalChecksOnOrderCreation;

    const insufficientApprovals = validateOfferBalancesAndApprovals({
      offer: offerItems,
      criterias: [],
      balancesAndApprovals,
      throwOnInsufficientBalances: checkBalancesAndApprovals,
      operator,
    });

    const approvalActions = checkBalancesAndApprovals
      ? await getApprovalActions(insufficientApprovals, signer)
      : [];

    const createOrderAction = {
      type: "create",
      getMessageToSign: () => {
        return this._getMessageToSign(orderParameters, resolvedNonce);
      },
      createOrder: async () => {
        const signature = await this.signOrder(
          orderParameters,
          resolvedNonce,
          offerer
        );

        return {
          parameters: { ...orderParameters, nonce: resolvedNonce },
          signature,
        };
      },
    } as const;

    const actions = [...approvalActions, createOrderAction] as const;

    return {
      actions,
      executeAllActions: () =>
        executeAllActions(actions) as Promise<OrderWithNonce>,
    };
  }

  /**
   * Returns the domain data used when signing typed data
   * @returns domain data
   */
  private async _getDomainData() {
    const { chainId } = await this.provider.getNetwork();

    return {
      name: CONSIDERATION_CONTRACT_NAME,
      version: CONSIDERATION_CONTRACT_VERSION,
      chainId,
      verifyingContract: this.contract.address,
    };
  }

  /**
   * Returns a raw message to be signed using EIP-712
   * @param orderParameters order parameter struct
   * @param nonce nonce of the order
   * @returns JSON string of the message to be signed
   */
  private async _getMessageToSign(
    orderParameters: OrderParameters,
    nonce: number
  ) {
    const domainData = await this._getDomainData();

    const orderComponents: OrderComponents = {
      ...orderParameters,
      nonce,
    };

    return JSON.stringify(
      _TypedDataEncoder.getPayload(
        domainData,
        EIP_712_ORDER_TYPE,
        orderComponents
      )
    );
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

    const domainData = await this._getDomainData();

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
      "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 nonce)";
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
          orderComponents.zoneHash.slice(2),
          orderComponents.salt.slice(2).padStart(64, "0"),
          orderComponents.conduitKey.slice(2).padStart(64, "0"),
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
   * i.e. If the maximum size of an order is 4, supplying 2 as the units to fulfill will fill half of the order: ;
   * @param input
   * @param input.order The standard order struct
   * @param input.unitsToFill the number of units to fill for the given order. Only used if you wish to partially fill an order
   * @param input.offerCriteria an array of criteria with length equal to the number of offer criteria items
   * @param input.considerationCriteria an array of criteria with length equal to the number of consideration criteria items
   * @param input.tips an array of optional condensed consideration items to be added onto a fulfillment
   * @param input.extraData extra data supplied to the order
   * @param input.accountAddress optional address from which to fulfill the order from
   * @param input.conduitKey the conduitKey to source approvals from
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
    conduitKey = this.defaultConduitKey,
  }: {
    order: OrderWithNonce;
    unitsToFill?: BigNumberish;
    offerCriteria?: InputCriteria[];
    considerationCriteria?: InputCriteria[];
    tips?: TipInputItem[];
    extraData?: string;
    accountAddress?: string;
    conduitKey?: string;
  }): Promise<OrderUseCase<ExchangeAction>> {
    const { parameters: orderParameters } = order;
    const { offerer, offer, consideration } = orderParameters;

    const fulfiller = await this.provider.getSigner(accountAddress);

    const fulfillerAddress = await fulfiller.getAddress();

    const offererOperator =
      this.config.conduitKeyToConduit[orderParameters.conduitKey];

    const fulfillerOperator = this.config.conduitKeyToConduit[conduitKey];

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
        operator: offererOperator,
      }),
      // Get fulfiller balances and approvals of all items in the set, as offer items
      // may be received by the fulfiller for standard fulfills
      getBalancesAndApprovals({
        owner: fulfillerAddress,
        items: [...offer, ...consideration],
        criterias: [...offerCriteria, ...considerationCriteria],
        multicallProvider: this.multicallProvider,
        operator: fulfillerOperator,
      }),
      this.multicallProvider.getBlock("latest"),
      this.getOrderStatus(this.getOrderHash(orderParameters)),
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
        seaportContract: this.contract,
        offererBalancesAndApprovals,
        fulfillerBalancesAndApprovals,
        timeBasedItemParams,
        conduitKey,
        offererOperator,
        fulfillerOperator,
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
      seaportContract: this.contract,
      offererBalancesAndApprovals,
      fulfillerBalancesAndApprovals,
      timeBasedItemParams,
      conduitKey,
      signer: fulfiller,
      offererOperator,
      fulfillerOperator,
    });
  }

  /**
   * Fulfills a list of orders in a best-effort fashion
   */
  public async fulfillOrders({
    fulfillOrderDetails,
    accountAddress,
    conduitKey = this.defaultConduitKey,
  }: {
    conduitKey?: string;
    fulfillOrderDetails: {
      order: OrderWithNonce;
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

    const allOffererOperators = fulfillOrderDetails.map(
      ({ order }) =>
        this.config.conduitKeyToConduit[order.parameters.conduitKey]
    );

    const fulfillerOperator = this.config.conduitKeyToConduit[conduitKey];

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
            operator: allOffererOperators[i],
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
        operator: fulfillerOperator,
        multicallProvider: this.multicallProvider,
      }),
      this.multicallProvider.getBlock("latest"),
      Promise.all(
        fulfillOrderDetails.map(({ order }) =>
          this.getOrderStatus(this.getOrderHash(order.parameters))
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
        offererOperator: allOffererOperators[index],
      })
    );

    return fulfillAvailableOrders({
      ordersMetadata,
      seaportContract: this.contract,
      fulfillerBalancesAndApprovals,
      currentBlockTimestamp: currentBlock.timestamp,
      ascendingAmountTimestampBuffer:
        this.config.ascendingAmountFulfillmentBuffer,
      fulfillerOperator,
      signer: fulfiller,
      conduitKey,
    });
  }
}
