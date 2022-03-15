import { BigNumberish } from "ethers";

export type ConsiderationConfig = {
  overrides?: {
    contractAddress: string;
  };
};

export type OrderParameters = {
  offerer: string;
  zone: string;
  orderType: BigNumberish;
  startTime: BigNumberish;
  endTime: BigNumberish;
  salt: BigNumberish;
  offer: {
    itemType: BigNumberish;
    token: string;
    identifierOrCriteria: BigNumberish;
    startAmount: BigNumberish;
    endAmount: BigNumberish;
  }[];
  consideration: {
    itemType: BigNumberish;
    token: string;
    identifierOrCriteria: BigNumberish;
    startAmount: BigNumberish;
    endAmount: BigNumberish;
    recipient: string;
  }[];
};

export type OfferItem = OrderParameters["offer"][0];

export type ReceivedItem = OrderParameters["consideration"][0];

export type OrderComponents = OrderParameters & { nonce: BigNumberish };
