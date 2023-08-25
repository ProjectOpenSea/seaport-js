import { providers as multicallProviders } from "@0xsequence/multicall";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ethers,
  PayableOverrides,
  providers,
} from "ethers";
import { _TypedDataEncoder, formatBytes32String } from "ethers/lib/utils";
import { DomainRegistryABI } from "./abi/DomainRegistry";
import { SeaportABI } from "./abi/Seaport";
import {
  CROSS_CHAIN_SEAPORT_ADDRESS,
  DOMAIN_REGISTRY_ADDRESS,
  EIP_712_ORDER_TYPE,
  KNOWN_CONDUIT_KEYS_TO_CONDUIT,
  MAX_INT,
  NO_CONDUIT,
  OrderType,
  SEAPORT_CONTRACT_NAME,
  SEAPORT_CONTRACT_VERSION,
} from "./constants";
import type {
  ContractMethodReturnType,
  CreateOrderAction,
  CreateOrderInput,
  DomainRegistryContract,
  ExchangeAction,
  InputCriteria,
  MatchOrdersFulfillment,
  Order,
  OrderComponents,
  OrderParameters,
  OrderStatus,
  OrderUseCase,
  OrderWithCounter,
  SeaportConfig,
  SeaportContract,
  Signer,
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
  generateRandomSaltWithDomain,
  mapInputItemToOfferItem,
  totalItemsAmount,
} from "./utils/order";
import { executeAllActions, getTransactionMethods } from "./utils/usecase";

export class Seaport {
  // Provides the raw interface to the contract for flexibility
  public contract: SeaportContract;

  public domainRegistry: DomainRegistryContract;

  private provider: providers.Provider;

  private signer?: Signer;

  // Use the multicall provider for reads for batching and performance optimisations
  // NOTE: Do NOT await between sequential requests if you're intending to batch
  // instead, use Promise.all() and map to fetch data in parallel
  // https://www.npmjs.com/package/@0xsequence/multicall
  private multicallProvider: multicallProviders.MulticallProvider;

  private config: Required<Omit<SeaportConfig, "overrides">>;

  private defaultConduitKey: string;

  /**
   * @param providerOrSigner - The provider or signer to use for web3-related calls
   * @param considerationConfig - A config to provide flexibility in the usage of Seaport
   */
  public constructor(
    providerOrSigner: providers.JsonRpcProvider | Signer,
    {
      overrides,
      // Five minute buffer
      ascendingAmountFulfillmentBuffer = 300,
      balanceAndApprovalChecksOnOrderCreation = true,
      conduitKeyToConduit,
    }: SeaportConfig = {}
  ) {
    if (!overrides?.contractAddress) {
      throw new Error("Seaport Contract is required !");
    }
    const provider =
      providerOrSigner instanceof providers.Provider
        ? providerOrSigner
        : providerOrSigner.provider;
    this.signer = (providerOrSigner as Signer)._isSigner
      ? (providerOrSigner as Signer)
      : undefined;

    if (!provider) {
      throw new Error(
        "Either a provider or custom signer with provider must be provided"
      );
    }

    this.provider = provider;

    this.multicallProvider = new multicallProviders.MulticallProvider(
      this.provider
    );

    this.contract = new Contract(
      overrides?.contractAddress ?? CROSS_CHAIN_SEAPORT_ADDRESS,
      SeaportABI,
      this.multicallProvider
    ) as SeaportContract;

    this.domainRegistry = new Contract(
      overrides?.domainRegistryAddress ?? DOMAIN_REGISTRY_ADDRESS,
      DomainRegistryABI,
      this.multicallProvider
    ) as DomainRegistryContract;

    this.config = {
      ascendingAmountFulfillmentBuffer,
      balanceAndApprovalChecksOnOrderCreation,
      conduitKeyToConduit: {
        ...KNOWN_CONDUIT_KEYS_TO_CONDUIT,
        [NO_CONDUIT]: this.contract.address,
        ...conduitKeyToConduit,
      },
    };

    this.defaultConduitKey = overrides?.defaultConduitKey ?? NO_CONDUIT;
  }

  private _getSigner(accountAddress?: string): Signer {
    if (this.signer) {
      return this.signer;
    }

    if (!(this.provider instanceof providers.JsonRpcProvider)) {
      throw new Error("Either signer or a JsonRpcProvider must be provided");
    }

    return this.provider.getSigner(accountAddress);
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
   * @param input.counter The counter from which to create the order with. Automatically fetched from the contract if not provided
   * @param input.allowPartialFills Whether to allow the order to be partially filled
   * @param input.restrictedByZone Whether the order should be restricted by zone
   * @param input.fees Convenience array to apply fees onto the order. The fees will be deducted from the
   *                   existing consideration items and then tacked on as new consideration items
   * @param input.domain An optional domain to be hashed and included in the first four bytes of the random salt.
   * @param input.salt Arbitrary salt. If not passed in, a random salt will be generated with the first four bytes being the domain hash or empty.
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
      counter,
      allowPartialFills,
      restrictedByZone,
      fees,
      domain,
      salt,
      offerer,
    }: CreateOrderInput,
    accountAddress?: string
  ): Promise<OrderUseCase<CreateOrderAction>> {
    const signer = this._getSigner(accountAddress);
    const signerAddress = await signer.getAddress();
    const defaultOfferer = signerAddress;
    const actualOfferer = offerer || defaultOfferer;
    const offerItems = offer.map(mapInputItemToOfferItem);
    const considerationItems = [
      ...consideration.map((consideration) => ({
        ...mapInputItemToOfferItem(consideration),
        recipient: consideration.recipient ?? actualOfferer,
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

    const [resolvedCounter, balancesAndApprovals] = await Promise.all([
      counter ?? this.getCounter(actualOfferer),
      getBalancesAndApprovals({
        owner: actualOfferer,
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

    const saltFollowingConditional =
      salt ||
      (domain ? generateRandomSaltWithDomain(domain) : generateRandomSalt());

    const orderParameters: OrderParameters = {
      offerer: actualOfferer,
      zone,
      // TODO: Placeholder
      zoneHash: formatBytes32String(resolvedCounter.toString()),
      startTime,
      endTime,
      orderType,
      offer: offerItems,
      consideration: considerationItemsWithFees,
      totalOriginalConsiderationItems: considerationItemsWithFees.length,
      salt: saltFollowingConditional,
      conduitKey,
    };

    const checkBalancesAndApprovals =
      this.config.balanceAndApprovalChecksOnOrderCreation;

    const insufficientApprovals = checkBalancesAndApprovals
      ? validateOfferBalancesAndApprovals({
          offer: offerItems,
          criterias: [],
          balancesAndApprovals,
          throwOnInsufficientBalances: checkBalancesAndApprovals,
          operator,
        })
      : [];

    const approvalActions = checkBalancesAndApprovals
      ? await getApprovalActions(insufficientApprovals, signer)
      : [];

    const createOrderAction = {
      type: "create",
      getMessageToSign: () => {
        return this._getMessageToSign(orderParameters, resolvedCounter);
      },
      createOrder: async () => {
        const signature = await this.signOrder(
          orderParameters,
          resolvedCounter,
          signerAddress
        );

        return {
          parameters: { ...orderParameters, counter: resolvedCounter },
          signature,
        };
      },
    } as const;

    const actions = [...approvalActions, createOrderAction] as const;

    return {
      actions,
      executeAllActions: () =>
        executeAllActions(actions) as Promise<OrderWithCounter>,
    };
  }

  /**
   * Returns the domain data used when signing typed data
   * @returns domain data
   */
  private async _getDomainData() {
    const { chainId } = await this.provider.getNetwork();

    return {
      name: SEAPORT_CONTRACT_NAME,
      version: SEAPORT_CONTRACT_VERSION,
      chainId,
      verifyingContract: this.contract.address,
    };
  }

  /**
   * Returns a raw message to be signed using EIP-712
   * @param orderParameters order parameter struct
   * @param counter counter of the order
   * @returns JSON string of the message to be signed
   */
  private async _getMessageToSign(
    orderParameters: OrderParameters,
    counter: number
  ) {
    const domainData = await this._getDomainData();

    const orderComponents: OrderComponents = {
      ...orderParameters,
      counter,
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
   * @param counter counter of the offerer
   * @param signerAddress optional account address from which to sign the order with.
   * @returns the order signature
   */
  public async signOrder(
    orderParameters: OrderParameters,
    counter: number,
    signerAddress?: string
  ): Promise<string> {
    const signer = this._getSigner(signerAddress);

    const domainData = await this._getDomainData();

    const orderComponents: OrderComponents = {
      ...orderParameters,
      counter,
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
   * @param domain optional domain to be hashed and appended to calldata
   * @returns the set of transaction methods that can be used
   */
  public cancelOrders(
    orders: OrderComponents[],
    accountAddress?: string,
    domain?: string
  ): TransactionMethods<ContractMethodReturnType<SeaportContract, "cancel">> {
    const signer = this._getSigner(accountAddress);

    return getTransactionMethods(
      this.contract.connect(signer),
      "cancel",
      [orders],
      domain
    );
  }

  /**
   * Bulk cancels all existing orders for a given account
   * @param offerer the account to bulk cancel orders on
   * @param domain optional domain to be hashed and appended to calldata
   * @returns the set of transaction methods that can be used
   */
  public bulkCancelOrders(
    offerer?: string,
    domain?: string
  ): TransactionMethods<
    ContractMethodReturnType<SeaportContract, "incrementCounter">
  > {
    const signer = this._getSigner(offerer);

    return getTransactionMethods(
      this.contract.connect(signer),
      "incrementCounter",
      [],
      domain
    );
  }

  /**
   * Approves a list of orders on-chain. This allows accounts to fulfill the order without requiring
   * a signature. Can also check if an order is valid using `callStatic`
   * @param orders list of order structs
   * @param accountAddress optional account address to approve orders.
   * @param domain optional domain to be hashed and appended to calldata
   * @returns the set of transaction methods that can be used
   */
  public validate(
    orders: Order[],
    accountAddress?: string,
    domain?: string
  ): TransactionMethods<ContractMethodReturnType<SeaportContract, "validate">> {
    const signer = this._getSigner(accountAddress);

    return getTransactionMethods(
      this.contract.connect(signer),
      "validate",
      [orders],
      domain
    );
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
   * Gets the counter of a given offerer
   * @param offerer the offerer to get the counter of
   * @returns counter as a number
   */
  public getCounter(offerer: string): Promise<number> {
    return this.contract
      .getCounter(offerer)
      .then((counter) => counter.toNumber());
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
      "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)";
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
          ethers.BigNumber.from(orderComponents.counter)
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
   * @param input.recipientAddress optional recipient to forward the offer to as opposed to the fulfiller.
   *                               Defaults to the zero address which means the offer goes to the fulfiller
   * @param input.domain optional domain to be hashed and appended to calldata
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
    recipientAddress = ethers.constants.AddressZero,
    domain = "",
  }: {
    order: OrderWithCounter;
    unitsToFill?: BigNumberish;
    offerCriteria?: InputCriteria[];
    considerationCriteria?: InputCriteria[];
    tips?: TipInputItem[];
    extraData?: string;
    accountAddress?: string;
    conduitKey?: string;
    recipientAddress?: string;
    domain?: string;
  }): Promise<
    OrderUseCase<
      ExchangeAction<
        ContractMethodReturnType<
          SeaportContract,
          "fulfillBasicOrder" | "fulfillOrder" | "fulfillAdvancedOrder"
        >
      >
    >
  > {
    const { parameters: orderParameters } = order;
    const { offerer, offer, consideration } = orderParameters;

    const fulfiller = this._getSigner(accountAddress);

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

    const isRecipientSelf = recipientAddress === ethers.constants.AddressZero;

    // We use basic fulfills as they are more optimal for simple and "hot" use cases
    // We cannot use basic fulfill if user is trying to partially fill though.
    if (
      !unitsToFill &&
      isRecipientSelf &&
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
        domain,
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
      recipientAddress,
      domain,
    });
  }

  /**
   * Fulfills an order through best-effort fashion. Orders that fail will not revert the whole transaction
   * unless there's an issue with approvals or balance checks
   * @param input
   * @param input.fulfillOrderDetails list of helper order details
   * @param input.accountAddress the account to fulfill orders on
   * @param input.conduitKey the key from which to source approvals from
   * @param input.recipientAddress optional recipient to forward the offer to as opposed to the fulfiller.
   *                               Defaults to the zero address which means the offer goes to the fulfiller
   * @param input.domain optional domain to be hashed and appended to calldata
   * @returns a use case containing the set of approval actions and fulfillment action
   */
  public async fulfillOrders({
    fulfillOrderDetails,
    accountAddress,
    conduitKey = this.defaultConduitKey,
    recipientAddress = ethers.constants.AddressZero,
    domain = "",
  }: {
    fulfillOrderDetails: {
      order: OrderWithCounter;
      unitsToFill?: BigNumberish;
      offerCriteria?: InputCriteria[];
      considerationCriteria?: InputCriteria[];
      tips?: TipInputItem[];
      extraData?: string;
    }[];
    accountAddress?: string;
    conduitKey?: string;
    recipientAddress?: string;
    domain?: string;
  }) {
    const fulfiller = this._getSigner(accountAddress);

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
      recipientAddress,
      domain,
    });
  }

  /**
   * NOTE: Largely incomplete. Does NOT do any balance or approval checks.
   * Just exposes the bare bones matchOrders where clients will have to supply
   * their own overrides as needed.
   * @param input
   * @param input.orders the list of orders to match
   * @param input.fulfillments the list of fulfillments to match offer and considerations
   * @param input.overrides any overrides the client wants, will need to pass in value for matching orders with ETH.
   * @param input.accountAddress Optional address for which to match the order with
   * @param input.domain optional domain to be hashed and appended to calldata
   * @returns set of transaction methods for matching orders
   */
  public matchOrders({
    orders,
    fulfillments,
    overrides,
    accountAddress,
    domain = "",
  }: {
    orders: (OrderWithCounter | Order)[];
    fulfillments: MatchOrdersFulfillment[];
    overrides?: PayableOverrides;
    accountAddress?: string;
    domain?: string;
  }): TransactionMethods<
    ContractMethodReturnType<SeaportContract, "matchOrders">
  > {
    const signer = this._getSigner(accountAddress);

    return getTransactionMethods(
      this.contract.connect(signer),
      "matchOrders",
      [orders, fulfillments, overrides],
      domain
    );
  }

  public setDomain(
    domain: string,
    accountAddress?: string
  ): TransactionMethods<
    ContractMethodReturnType<DomainRegistryContract, "setDomain">
  > {
    const signer = this._getSigner(accountAddress);

    return getTransactionMethods(
      this.domainRegistry.connect(signer),
      "setDomain",
      [domain]
    );
  }

  public async getNumberOfDomains(tag: string): Promise<BigNumber> {
    return this.domainRegistry.getNumberOfDomains(tag);
  }

  public getDomain(tag: string, index: number): Promise<string> {
    return this.domainRegistry.getDomain(tag, index);
  }

  public async getDomains(
    tag: string,
    shouldThrow?: boolean
  ): Promise<string[]> {
    try {
      if (shouldThrow) {
        throw Error;
      }

      return this.domainRegistry.getDomains(tag);
    } catch (error) {
      const totalDomains = (
        await this.domainRegistry.getNumberOfDomains(tag)
      ).toNumber();

      const domainArray = Promise.all(
        [...Array(totalDomains).keys()].map((i) =>
          this.domainRegistry.getDomain(tag, i)
        )
      );

      return domainArray;
    }
  }
}
