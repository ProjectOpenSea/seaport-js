import { BigNumberish, ContractTransaction } from "ethers";
import { ItemType, OrderType } from "./constants";
import type { TestERC20, TestERC721 } from "./typechain-types";
import { TransactionMethods } from "./utils/usecase";
import { Seaport as SeaportContract } from "./typechain-types/seaport/contracts/Seaport";

export type { SeaportContract };

export type SeaportConfig = {
  // Used because fulfillments may be invalid if confirmations take too long. Default buffer is 5 minutes
  ascendingAmountFulfillmentBuffer?: number;

  // Allow users to optionally skip balance and approval checks on order creation
  balanceAndApprovalChecksOnOrderCreation?: boolean;

  // A mapping of conduit key to conduit
  conduitKeyToConduit?: Record<string, string>;

  overrides?: {
    // The Seaport version to use
    seaportVersion?: string;
    // The Seaport contract address to use
    contractAddress?: string;
    // The domain registry address to use
    domainRegistryAddress?: string;
    // The default conduit key to use when creating and fulfilling orders
    defaultConduitKey?: string;
  };
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
  numerator: bigint;
  denominator: bigint;
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
  zoneHash?: string;
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
  totalFilled: bigint;
  totalSize: bigint;
};

export type OrderWithCounter = {
  parameters: OrderComponents;
  signature: string;
};

export type ApprovalAction = {
  type: "approval";
  token: string;
  identifierOrCriteria: string;
  itemType: ItemType;
  operator: string;
  transactionMethods: TransactionMethods<
    TestERC721["setApprovalForAll"] | TestERC20["approve"]
  >;
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
  CreateOrderAction,
];

export type CreateBulkOrdersActions = readonly [
  ...ApprovalAction[],
  CreateBulkOrdersAction,
];

export type OrderExchangeActions<T> = readonly [
  ...ApprovalAction[],
  ExchangeAction<T>,
];

export type OrderUseCase<
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction,
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
