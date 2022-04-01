import { BigNumber, BigNumberish, ContractTransaction } from "ethers";
import { TransactionRequest as EthersTransactionRequest } from "@ethersproject/abstract-provider";
import { ItemType, OrderType, ProxyStrategy } from "./constants";

export type ConsiderationConfig = {
  // Used because fulfillments may be invalid if confirmations take too long. Default buffer is 30 minutes
  ascendingAmountFulfillmentBuffer?: number;

  // Defaults to false (thus, approving the max amount)
  approveExactAmount?: boolean;

  // allow users to optionally skip balance and approval checks
  balanceAndApprovalChecksOnOrderCreation?: boolean;

  // Defaults to use proxy if it would result in zero approvals needed. Otherwise, users can specify the proxy strategy
  // they want to use, relevant for creating orders or fulfilling orders
  proxyStrategy?: ProxyStrategy;

  overrides?: {
    contractAddress?: string;
    legacyProxyRegistryAddress?: string;
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
  salt: string;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
};

export type OrderComponents = OrderParameters & { nonce: number };

export type Order = {
  parameters: OrderParameters;
  signature: string;
};

export type AdvancedOrder = Order & {
  numerator: BigNumber;
  denominator: BigNumber;
};

export type BasicErc721Item = {
  itemType: ItemType.ERC721;
  token: string;
  identifier: string;
};

export type Erc721ItemWithCriteria = {
  itemType: ItemType.ERC721;
  token: string;
  identifiers: string[];
  // Used for criteria based items i.e. offering to buy 5 NFTs for a collection
  amount?: string;
  endAmount?: string;
};

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
  identifiers: string[];
  amount: string;
  endAmount?: string;
};

type InputCriteria = {
  criteria: { identifier: string; identifiers: string[] };
};

type Erc1155Item = BasicErc1155Item | Erc1155ItemWithCriteria;

export type CurrencyItem = {
  token?: string;
  amount: string;
  endAmount?: string;
};

export type CreateInputItem = Erc721Item | Erc1155Item | CurrencyItem;

export type FulfillInputErc721ItemWithCriteria<T extends Item> = T & {
  itemType: ItemType.ERC721_WITH_CRITERIA;
} & InputCriteria;

export type FulfillInputErc1155ItemWithCriteria<T extends Item> = T & {
  itemType: ItemType.ERC1155_WITH_CRITERIA;
} & InputCriteria;

export type CriteriaInputItem<T extends Item> =
  | Item
  | FulfillInputErc1155ItemWithCriteria<T>
  | FulfillInputErc721ItemWithCriteria<T>;

export type ConsiderationInputItem = CreateInputItem & { recipient?: string };

export type Fee = {
  recipient: string;
  basisPoints: number;
};

export type CreateOrderInput = {
  zone?: string;
  startTime?: string;
  endTime?: string;
  offer: readonly CreateInputItem[];
  consideration: readonly ConsiderationInputItem[];
  nonce?: number;
  fees?: readonly Fee[];
  allowPartialFills?: boolean;
  restrictedByZone?: boolean;
  useProxy?: boolean;
  salt?: string;
};

export type OrderWithCriteria = Order & {
  parameters: OrderParameters & {
    offer: CriteriaInputItem<OfferItem>[];
    consideration: CriteriaInputItem<ConsiderationItem>[];
  };
};

export type OrderStatus = {
  isValidated: boolean;
  isCancelled: boolean;
  totalFilled: BigNumber;
  totalSize: BigNumber;
};

export type CreatedOrder = Order & {
  nonce: number;
};

type TransactionRequestDetails = EthersTransactionRequest;

type TransactionRequest = {
  send: () => Promise<ContractTransaction>;
  details: TransactionRequestDetails;
};

export type ApprovalAction = {
  type: "approval";
  token: string;
  identifierOrCriteria: string;
  itemType: ItemType;
  operator: string;
  transactionRequest: TransactionRequest;
};

export type ExchangeAction = {
  type: "exchange";
  transactionRequest: TransactionRequest;
};

export type CreateOrderAction = {
  type: "create";
  createOrder: () => Promise<CreatedOrder>;
};

export type TransactionAction = ApprovalAction | ExchangeAction;

export type CreateOrderActions = readonly [
  ...ApprovalAction[],
  CreateOrderAction
];

export type OrderExchangeActions = readonly [
  ...ApprovalAction[],
  ExchangeAction
];

export type OrderUseCase<T extends CreateOrderAction | ExchangeAction> = {
  actions: T extends CreateOrderAction
    ? CreateOrderActions
    : OrderExchangeActions;
  executeAllActions: () => Promise<
    T extends CreateOrderAction ? CreatedOrder : ContractTransaction
  >;
};

export type FulfillmentComponent = {
  orderIndex: number;
  itemIndex: number;
};

export type Fulfillment = {
  offerComponents: FulfillmentComponent[];
  considerationComponents: FulfillmentComponent[];
};

export type IdentifierWithCriteria = {
  token: string;
  identifier: string;
  validIdentifiersForMerkleRoot: string[];
};
