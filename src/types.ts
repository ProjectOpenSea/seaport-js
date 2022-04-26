import {
  BigNumber,
  BigNumberish,
  ContractTransaction,
  Overrides,
  PopulatedTransaction,
} from "ethers";
import { ItemType, Network, OrderType } from "./constants";

export type ConsiderationConfig = {
  // Used because fulfillments may be invalid if confirmations take too long. Default buffer is 30 minutes
  ascendingAmountFulfillmentBuffer?: number;

  // Defaults to false (thus, approving the max amount)
  approveExactAmount?: boolean;

  // allow users to optionally skip balance and approval checks
  balanceAndApprovalChecksOnOrderCreation?: boolean;

  overrides?: {
    contractAddress?: string;
    legacyProxyRegistryAddress?: string;
    legacyTokenTransferProxy?: string;
  };

  network?: Network;
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
  conduit: string;
};

export type OrderComponents = OrderParameters & { nonce: number };

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
  conduit?: string;
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

export type InputCriteria = {
  identifier: string;
  validIdentifiers: string[];
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

export type TransactionMethods = {
  buildTransaction: (overrides?: Overrides) => Promise<PopulatedTransaction>;
  callStatic: <T>(overrides?: Overrides) => Promise<T>;
  estimateGas: (overrides?: Overrides) => Promise<BigNumber>;
  transact: (overrides?: Overrides) => Promise<ContractTransaction>;
};

export type ApprovalAction = {
  type: "approval";
  token: string;
  identifierOrCriteria: string;
  itemType: ItemType;
  operator: string;
  transactionMethods: TransactionMethods;
};

export type ExchangeAction = {
  type: "exchange";
  transactionMethods: TransactionMethods;
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

export type ApprovalOperators = {
  operator: string;
  erc20Operator: string;
};
