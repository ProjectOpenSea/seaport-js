import { BigNumberish, BytesLike } from "ethers";
import { ItemType } from "./constants";

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
  orderType: BigNumberish;
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
