import {
  BigNumber,
  BigNumberish,
  BytesLike,
  ContractTransaction,
} from "ethers";
import { ItemType, OrderType, ProxyStrategy } from "./constants";
import { InsufficientApprovals } from "./utils/balancesAndApprovals";

export type ConsiderationConfig = {
  // Used because fulfillments may be invalid if confirmations take too long. Default buffer is 30 minutes
  ascendingAmountFulfillmentBuffer?: number;

  // Defaults to false (thus, approving the max amount)
  approveExactAmount?: boolean;

  // allow users to optionally skip balance and approval checks
  balanceAndApprovalChecksOnOrderCreation?: boolean;
  balanceAndApprovalChecksOnOrderFulfillment?: boolean;

  // Defaults to use proxy if it would result in less approvals. Otherwise, users can specify the proxy strategy
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
  salt: BytesLike;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
};

export type OrderComponents = OrderParameters & { nonce: number };

export type Order = {
  parameters: OrderParameters;
  signature: BytesLike;
};

export type AdvancedOrder = Order & {
  numerator: BigNumber;
  denominator: BigNumber;
};

export type Erc721Item = {
  itemType: ItemType.ERC721 | ItemType.ERC721_WITH_CRITERIA;
  token: string;
  identifierOrCriteria: string;
  // Used for criteria based items i.e. offering to buy 5 NFTs for a collection
  amount?: string;
  endAmount?: string;
};

export type Erc1155Item = {
  itemType: ItemType.ERC1155 | ItemType.ERC1155_WITH_CRITERIA;
  token: string;
  identifierOrCriteria: string;
  amount: string;
  endAmount?: string;
};

export type CurrencyItem = {
  token?: string;
  amount: string;
  endAmount?: string;
};

export type InputItem = Erc721Item | Erc1155Item | CurrencyItem;
export type ConsiderationInputItem = InputItem & { recipient?: string };

export type Fee = {
  recipient: string;
  basisPoints: number;
};

export type CreateOrderInput = {
  zone?: string;
  startTime?: string;
  endTime?: string;
  offer: readonly InputItem[];
  consideration: readonly ConsiderationInputItem[];
  nonce?: number;
  fees?: readonly Fee[];
  allowPartialFills?: boolean;
  restrictedByZone?: boolean;
  useProxy?: boolean;
  salt?: BytesLike;
};

export type OrderStatus = {
  isValidated: boolean;
  isCancelled: boolean;
  totalFilled: BigNumber;
  totalSize: BigNumber;
};

export type CreatedOrder = OrderComponents & { signature: BytesLike };

export type ApprovalAction = {
  type: "approval";
  token: string;
  identifierOrCriteria: string;
  itemType: ItemType;
  transaction: ContractTransaction;
};

export type ExchangeAction = {
  type: "exchange";
  transaction: ContractTransaction;
};

export type CreateOrderAction = {
  type: "create";
  order: CreatedOrder;
};

export type TransactionAction = ApprovalAction | ExchangeAction;

export type CreateOrderActions = ApprovalAction | CreateOrderAction;

export type OrderExchangeActions = ApprovalAction | ExchangeAction;

export type OrderUseCase<T = CreateOrderActions | OrderExchangeActions> = {
  insufficientApprovals: InsufficientApprovals;
  numActions: number;
  genActions: () => AsyncGenerator<
    ApprovalAction,
    T extends CreateOrderActions ? CreateOrderAction : ExchangeAction
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
