import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import { ItemType, NftItemType } from "../constants";
import { OfferItem, ReceivedItem } from "../types";

type ConstructItemParams = {
  itemType: BigNumberish;
  token: string;
  amount: BigNumberish;
  identifierOrCriteria: BigNumberish;
  endAmount?: BigNumberish;
  recipient?: string;
};

type ConstructedItem<T> = T extends { recipient: string }
  ? ReceivedItem
  : OfferItem;

const constructItem = <T extends ConstructItemParams>({
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
    } as ConstructedItem<T>;
  }

  return item as ConstructedItem<T>;
};

export const constructNftItem = <
  T extends Omit<ConstructItemParams, "endAmount" | "itemType"> & {
    itemType?: NftItemType;
  }
>({
  itemType = ItemType.ERC721,
  token,
  amount,
  identifierOrCriteria,
  recipient,
}: T): ConstructedItem<T> => {
  return constructItem({
    itemType,
    token,
    amount,
    identifierOrCriteria,
    recipient,
  }) as ConstructedItem<T>;
};

export const constructCurrencyItem = <
  T extends Pick<ConstructItemParams, "amount" | "endAmount" | "recipient"> &
    Partial<Pick<ConstructItemParams, "token">>
>({
  token = ethers.constants.AddressZero,
  amount,
  endAmount,
  recipient,
}: T): ConstructedItem<T> => {
  return constructItem({
    itemType:
      token === ethers.constants.AddressZero ? ItemType.NATIVE : ItemType.ERC20,
    token,
    amount,
    identifierOrCriteria: 0,
    endAmount,
    recipient,
  }) as ConstructedItem<T>;
};

export const isCurrencyItem = (item: OfferItem | ReceivedItem) =>
  [ItemType.NATIVE, ItemType.ERC20].includes(item.itemType);
