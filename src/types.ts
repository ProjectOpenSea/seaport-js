import type { DomainRegistry as TypeChainDomainRegistryContract } from "./typechain-types";
import type {
  OrderStruct,
  Seaport as TypeChainSeaportContract,
} from "./typechain-types/seaport_v1_4/contracts/Seaport";
import {
  BigNumber,
  BigNumberish,
  BytesLike,
  Contract,
  ContractTransaction,
  ethers,
  Overrides,
  PayableOverrides,
  PopulatedTransaction,
} from "ethers";
import { ItemType, OrderType } from "./constants";
import type { TestERC20, TestERC721 } from "./typechain-types";

export type SeaportConfig = {
  // Used because fulfillments may be invalid if confirmations take too long. Default buffer is 5 minutes
  ascendingAmountFulfillmentBuffer?: number;

  // Allow users to optionally skip balance and approval checks on order creation
  balanceAndApprovalChecksOnOrderCreation?: boolean;

  // A mapping of conduit key to conduit
  conduitKeyToConduit?: Record<string, string>;

  // The Seaport version to use
  seaportVersion?: "1.4" | "1.5";

  overrides?: {
    contractAddress?: string;
    domainRegistryAddress?: string;
    // A default conduit key to use when creating and fulfilling orders
    defaultConduitKey?: string;
  };
};

type TypedDataDomain = {
  name?: string;
  version?: string;
  chainId?: BigNumberish;
  verifyingContract?: string;
  salt?: BytesLike;
};

type TypedDataField = {
  name: string;
  type: string;
};

// Temporary until TypedDataSigner is added in ethers (in v6)
export type Signer = ethers.Signer & {
  _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>
  ): Promise<string>;
};

export type OfferItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
};

export type ConsiderationItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
  recipient: string;
};

export type Item = OfferItem | ConsiderationItem;

export type OrderParameters = {
  offerer: string;
  zone: string;
  orderType: OrderType;
  startTime: BigNumberish;
  endTime: BigNumberish;
  zoneHash: string;
  salt: string;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
  totalOriginalConsiderationItems: BigNumberish;
  conduitKey: string;
};

export type OrderComponents = OrderParameters & { counter: BigNumberish };

export type Order = {
  parameters: OrderParameters;
  signature: string;
};

export type AdvancedOrder = Order & {
  numerator: BigNumber;
  denominator: BigNumber;
  extraData: string;
};

export type BasicErc721Item = {
  itemType: ItemType.ERC721;
  token: string;
  identifier: string;
};

export type Erc721ItemWithCriteria = {
  itemType: ItemType.ERC721;
  token: string;
  amount?: string;
  endAmount?: string;
  // Used for criteria based items i.e. offering to buy 5 NFTs for a collection
} & ({ identifiers: string[] } | { criteria: string });

type Erc721Item = BasicErc721Item | Erc721ItemWithCriteria;

export type BasicErc1155Item = {
  itemType: ItemType.ERC1155;
  token: string;
  identifier: string;
  amount: string;
  endAmount?: string;
};

export type Erc1155ItemWithCriteria = {
  itemType: ItemType.ERC1155;
  token: string;
  amount: string;
  endAmount?: string;
} & ({ identifiers: string[] } | { criteria: string });

type Erc1155Item = BasicErc1155Item | Erc1155ItemWithCriteria;

export type CurrencyItem = {
  token?: string;
  amount: string;
  endAmount?: string;
};

export type CreateInputItem = Erc721Item | Erc1155Item | CurrencyItem;

export type ConsiderationInputItem = CreateInputItem & { recipient?: string };

export type TipInputItem = CreateInputItem & { recipient: string };

export type Fee = {
  recipient: string;
  basisPoints: number;
};

export type CreateOrderInput = {
  conduitKey?: string;
  zone?: string;
  startTime?: BigNumberish;
  endTime?: BigNumberish;
  offer: readonly CreateInputItem[];
  consideration: readonly ConsiderationInputItem[];
  counter?: BigNumberish;
  fees?: readonly Fee[];
  allowPartialFills?: boolean;
  restrictedByZone?: boolean;
  domain?: string;
  salt?: BigNumberish;
};

export type InputCriteria = {
  identifier: string;
  proof: string[];
};

export type OrderStatus = {
  isValidated: boolean;
  isCancelled: boolean;
  totalFilled: BigNumber;
  totalSize: BigNumber;
};

export type OrderWithCounter = {
  parameters: OrderComponents;
  signature: string;
};

export type ContractMethodReturnType<
  T extends Contract,
  U extends keyof T["callStatic"]
  // eslint-disable-next-line no-undef
> = Awaited<ReturnType<T["callStatic"][U]>>;

export type TransactionMethods<T = unknown> = {
  buildTransaction: (overrides?: Overrides) => Promise<PopulatedTransaction>;
  callStatic: (overrides?: Overrides) => Promise<T>;
  estimateGas: (overrides?: Overrides) => Promise<BigNumber>;
  transact: (overrides?: Overrides) => Promise<ContractTransaction>;
};

export type ApprovalAction = {
  type: "approval";
  token: string;
  identifierOrCriteria: string;
  itemType: ItemType;
  operator: string;
  transactionMethods:
    | TransactionMethods<
        ContractMethodReturnType<TestERC721, "setApprovalForAll">
      >
    | TransactionMethods<ContractMethodReturnType<TestERC20, "approve">>;
};

export type ExchangeAction<T = unknown> = {
  type: "exchange";
  transactionMethods: TransactionMethods<T>;
};

export type CreateOrderAction = {
  type: "create";
  getMessageToSign: () => Promise<string>;
  createOrder: () => Promise<OrderWithCounter>;
};

export type CreateBulkOrdersAction = {
  type: "createBulk";
  getMessageToSign: () => Promise<string>;
  createBulkOrders: () => Promise<OrderWithCounter[]>;
};

export type TransactionAction = ApprovalAction | ExchangeAction;

export type CreateOrderActions = readonly [
  ...ApprovalAction[],
  CreateOrderAction
];

export type CreateBulkOrdersActions = readonly [
  ...ApprovalAction[],
  CreateBulkOrdersAction
];

export type OrderExchangeActions<T> = readonly [
  ...ApprovalAction[],
  ExchangeAction<T>
];

export type OrderUseCase<
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction
> = {
  actions: T extends CreateOrderAction
    ? CreateOrderActions
    : T extends CreateBulkOrdersAction
    ? CreateBulkOrdersActions
    : OrderExchangeActions<T extends ExchangeAction<infer U> ? U : never>;
  executeAllActions: () => Promise<
    T extends CreateOrderAction
      ? OrderWithCounter
      : T extends CreateBulkOrdersAction
      ? OrderWithCounter[]
      : ContractTransaction
  >;
};

export type FulfillmentComponent = {
  orderIndex: number;
  itemIndex: number;
}[];

export type Fulfillment = {
  offerComponents: FulfillmentComponent[];
  considerationComponents: FulfillmentComponent[];
};

type MatchOrdersFulfillmentComponent = {
  orderIndex: number;
  itemIndex: number;
};

export type MatchOrdersFulfillment = {
  offerComponents: MatchOrdersFulfillmentComponent[];
  considerationComponents: MatchOrdersFulfillmentComponent[];
};

// Overrides matchOrders types to fix fulfillments type which is generated
// by TypeChain incorrectly
export type SeaportContract = TypeChainSeaportContract & {
  encodeFunctionData(
    functionFragment: "matchOrders",
    values: [OrderStruct[], MatchOrdersFulfillment[]]
  ): string;

  matchOrders(
    orders: OrderStruct[],
    fulfillments: MatchOrdersFulfillment[],
    overrides?: PayableOverrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  functions: TypeChainSeaportContract["functions"] & {
    matchOrders(
      orders: OrderStruct[],
      fulfillments: MatchOrdersFulfillment[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;
  };

  callStatic: TypeChainSeaportContract["callStatic"] & {
    matchOrders(
      orders: OrderStruct[],
      fulfillments: MatchOrdersFulfillment[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;
  };

  estimateGas: TypeChainSeaportContract["estimateGas"] & {
    matchOrders(
      orders: OrderStruct[],
      fulfillments: MatchOrdersFulfillment[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: TypeChainSeaportContract["populateTransaction"] & {
    matchOrders(
      orders: OrderStruct[],
      fulfillments: MatchOrdersFulfillment[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;
  };
};

export type DomainRegistryContract = TypeChainDomainRegistryContract;
