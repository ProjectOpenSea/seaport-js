import { BigNumberish, BytesLike } from "ethers";
import { ItemType, OrderType } from "./constants";

export type ConsiderationConfig = {
  overrides?: {
    contractAddress: string;
    legacyProxyRegistryAddress: string;
  };
};

export type OfferItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: string;
  endAmount: string;
};

export type ReceivedItem = {
  itemType: ItemType;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: string;
  endAmount: string;
  recipient: string;
};

export type Item = OfferItem | ReceivedItem;

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
export type ReceivedInputItem = InputItem & { recipient?: string };

export type Fee = {
  recipient: string;
  basisPoints: BigNumberish;
};

export type CreateOrderInput = {
  zone?: string;
  startTime: BigNumberish;
  endTime: BigNumberish;
  offer: InputItem[];
  consideration: ReceivedInputItem[];
  nonce?: BigNumberish;
  fees?: Fee[];
  allowPartialFills?: boolean;
  restrictedByZone?: boolean;
  useProxy?: boolean;
  salt?: BigNumberish;
};
