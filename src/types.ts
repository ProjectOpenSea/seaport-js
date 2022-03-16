import { BigNumberish, BytesLike } from "ethers";
import { ItemType, NftItemType, OrderType } from "./constants";

export type ConsiderationConfig = {
  overrides?: {
    contractAddress: string;
  };
};

export type OfferItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: BigNumberish;
  endAmount: BigNumberish;
};

export type ReceivedItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: BigNumberish;
  endAmount: BigNumberish;
  recipient: string;
};

export type OrderParameters = {
  offerer: string;
  zone: string;
  orderType: OrderType;
  startTime: BigNumberish;
  endTime: BigNumberish;
  salt: BigNumberish;
  offer: OfferItem[];
  consideration: ReceivedItem[];
};

export type OrderComponents = OrderParameters & { nonce: BigNumberish };

export type Order = {
  parameters: OrderParameters;
  signature: BytesLike;
};

export type Erc721Item = {
  token: string;
  identifierOrCriteria: BigNumberish;
};

export type Erc1155Item = {
  token: string;
  identifierOrCriteria: BigNumberish;
  amount: string;
};

export type CurrencyItem = {
  token: string;
  amount: string;
  endAmount?: string;
};

export type CreateOrderInput = {
  offerer: string;
  zone: string;
  startTime: BigNumberish;
  endTime: BigNumberish;
  offer: OfferItem[];
  consideration: ReceivedItem[];
};
