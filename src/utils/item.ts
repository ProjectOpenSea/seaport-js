import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import { ItemType } from "src/constants";
import { OfferItem, ReceivedItem } from "src/types";

type PaymentItem<T> = T extends { recipient: string }
  ? ReceivedItem
  : OfferItem;

export const createPaymentItem = <
  T extends {
    token?: string;
    amount: BigNumberish;
    endAmount?: BigNumberish;
    recipient?: string;
  }
>({
  token = ethers.constants.AddressZero,
  amount,
  endAmount,
  recipient,
}: T): T extends { recipient: string } ? ReceivedItem : OfferItem => {
  const item = {
    itemType:
      token === ethers.constants.AddressZero ? ItemType.ETH : ItemType.ERC20,
    token,
    identifierOrCriteria: 0,
    startAmount: amount,
    endAmount: endAmount ?? amount,
  };

  if (recipient !== undefined) {
    return {
      ...item,
      recipient,
    } as PaymentItem<T>;
  }

  return item as PaymentItem<T>;
};
