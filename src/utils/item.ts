import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import { ItemType, NftItemType } from "../constants";
import { OfferItem, ReceivedItem } from "../types";

type CreateItemParams = {
  itemType: BigNumberish;
  token: string;
  amount: BigNumberish;
  identifierOrCriteria: BigNumberish;
  endAmount?: BigNumberish;
  recipient?: string;
};

type CreatedItem<T> = T extends { recipient: string }
  ? ReceivedItem
  : OfferItem;

const createItem = <T extends CreateItemParams>({
  itemType,
  token = ethers.constants.AddressZero,
  amount,
  identifierOrCriteria,
  endAmount,
  recipient,
}: T): T extends { recipient: string } ? ReceivedItem : OfferItem => {
  const item = {
    itemType,
    token,
    identifierOrCriteria,
    startAmount: amount,
    endAmount: endAmount ?? amount,
  };

  if (recipient !== undefined) {
    return {
      ...item,
      recipient,
    } as CreatedItem<T>;
  }

  return item as CreatedItem<T>;
};

export const createNftItem = <
  T extends Omit<CreateItemParams, "endAmount" | "itemType"> & {
    itemType?: NftItemType;
  }
>({
  itemType = ItemType.ERC721,
  token,
  amount,
  identifierOrCriteria,
  recipient,
}: T): CreatedItem<T> => {
  return createItem({
    itemType,
    token,
    amount,
    identifierOrCriteria,
    recipient,
  }) as CreatedItem<T>;
};

export const createPaymentItem = <
  T extends Pick<CreateItemParams, "amount" | "endAmount" | "recipient"> &
    Partial<Pick<CreateItemParams, "token">>
>({
  token = ethers.constants.AddressZero,
  amount,
  endAmount,
  recipient,
}: T): CreatedItem<T> => {
  return createItem({
    itemType:
      token === ethers.constants.AddressZero ? ItemType.ETH : ItemType.ERC20,
    token,
    amount,
    identifierOrCriteria: 0,
    endAmount,
    recipient,
  }) as CreatedItem<T>;
};
