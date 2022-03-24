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
  identifierOrCriteria: BigNumberish;
  startAmount: string;
  endAmount: string;
};

export type ConsiderationItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: BigNumberish;
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
  salt: BigNumberish;
  offer: OfferItem[];
  consideration: ConsiderationItem[];
};

export type OrderComponents = OrderParameters & { nonce: BigNumberish };

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
  identifierOrCriteria: BigNumberish;
  // Used for criteria based items i.e. offering to buy 5 NFTs for a collection
  amount?: string;
  endAmount?: string;
};

export type Erc1155Item = {
  itemType: ItemType.ERC1155 | ItemType.ERC1155_WITH_CRITERIA;
  token: string;
  identifierOrCriteria: BigNumberish;
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
  basisPoints: BigNumberish;
};

export type CreateOrderInput = {
  zone?: string;
  startTime?: BigNumberish;
  endTime?: BigNumberish;
  offer: InputItem[];
  consideration: ConsiderationInputItem[];
  nonce?: BigNumberish;
  fees?: Fee[];
  allowPartialFills?: boolean;
  restrictedByZone?: boolean;
  useProxy?: boolean;
  salt?: BigNumberish;
};

export type OrderStatus = {
  isValidated: boolean;
  isCancelled: boolean;
  totalFilled: BigNumber;
  totalSize: BigNumber;
};

export type CreatedOrder = OrderComponents & { signature: BytesLike };

export type YieldedApproval = {
  type: "approval";
  token: string;
  identifierOrCriteria: BigNumberish;
  itemType: ItemType;
  transaction: ContractTransaction;
};

export type YieldedExchange = {
  type: "exchange";
  transaction: ContractTransaction;
};

export type YieldedCreatedOrder = {
  type: "create";
  order: CreatedOrder;
};

export type YieldedTransaction = YieldedApproval | YieldedExchange;

export type OrderCreateYields = YieldedApproval | YieldedCreatedOrder;

export type OrderExchangeYields = YieldedApproval | YieldedExchange;

export type OrderUseCase<T = OrderCreateYields | OrderExchangeYields> = {
  insufficientApprovals: InsufficientApprovals;
  numExecutions: number;
  execute: () => AsyncGenerator<T>;
};

export type FulfillmentComponent = {
  orderIndex: number;
  itemIndex: number;
};

export type Fulfillment = {
  offerComponents: FulfillmentComponent[];
  considerationComponents: FulfillmentComponent[];
};
