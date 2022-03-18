import { BigNumber, BigNumberish, ethers } from "ethers";
import { ItemType, NftItemType } from "../constants";
import { Item, OfferItem, OrderParameters, ReceivedItem } from "../types";

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

export const isCurrencyItem = ({ itemType }: Item) =>
  [ItemType.NATIVE, ItemType.ERC20].includes(itemType);

export const isErc721Item = ({ itemType }: Item) =>
  [ItemType.ERC721, ItemType.ERC721_WITH_CRITERIA].includes(itemType);

export const isErc1155Item = ({ itemType }: Item) =>
  [ItemType.ERC1155, ItemType.ERC1155_WITH_CRITERIA].includes(itemType);

export type TimeBasedItemParams = {
  isConsiderationItem?: boolean;
  currentBlockTimestamp: number;
  ascendingAmountTimestampBuffer: number;
} & Pick<OrderParameters, "startTime" | "endTime">;

export const getPresentItemAmount = ({
  startAmount,
  endAmount,
  isConsiderationItem,
  currentBlockTimestamp,
  ascendingAmountTimestampBuffer,
  startTime,
  endTime,
}: Pick<Item, "startAmount" | "endAmount"> &
  TimeBasedItemParams): BigNumber => {
  const startAmountBn = BigNumber.from(startAmount);
  const endAmountBn = BigNumber.from(endAmount);
  const duration = BigNumber.from(endTime).sub(startTime);
  const isAscending = endAmountBn.gt(startAmount);
  const adjustedBlockTimestamp = BigNumber.from(
    isAscending
      ? currentBlockTimestamp + ascendingAmountTimestampBuffer
      : currentBlockTimestamp
  );

  if (adjustedBlockTimestamp.lt(startTime)) {
    return startAmountBn;
  }

  const elapsed = (
    adjustedBlockTimestamp.gt(endTime)
      ? BigNumber.from(endTime)
      : adjustedBlockTimestamp
  ).sub(startTime);

  const remaining = duration.sub(elapsed);

  // Adjust amounts based on current time
  // For offer items, we round down
  // For consideration items, we round up
  return startAmountBn
    .mul(remaining)
    .add(endAmountBn.mul(elapsed))
    .add(isConsiderationItem ? duration.sub(1) : 0)
    .div(duration);
};

export const getSummedTokenAndIdentifierAmounts = (
  items: Item[],
  timeBasedItemParams?: TimeBasedItemParams
) => {
  const tokenAndIdentifierToAmountNeeded = items.reduce<
    Record<string, Record<string, BigNumber>>
  >((map, item) => {
    const identifierOrCriteria = BigNumber.from(
      item.identifierOrCriteria
    ).toString();

    const startAmount = BigNumber.from(item.startAmount);
    const endAmount = BigNumber.from(item.endAmount);
    const maxAmount = startAmount.gt(endAmount) ? startAmount : endAmount;

    const amount = timeBasedItemParams
      ? getPresentItemAmount({
          startAmount: startAmount.toString(),
          endAmount: endAmount.toString(),
          isConsiderationItem: timeBasedItemParams.isConsiderationItem,
          currentBlockTimestamp: timeBasedItemParams.currentBlockTimestamp,
          ascendingAmountTimestampBuffer:
            timeBasedItemParams.ascendingAmountTimestampBuffer,
          startTime: timeBasedItemParams.startTime,
          endTime: timeBasedItemParams.endTime,
        })
      : maxAmount;

    return {
      ...map,
      [item.token]: {
        // Being explicit about the undefined type as it's possible for it to be undefined at first iteration
        [identifierOrCriteria]: (
          (map[item.token][identifierOrCriteria] as BigNumber | undefined) ??
          BigNumber.from(0)
        ).add(amount),
      },
    };
  }, {});

  return tokenAndIdentifierToAmountNeeded;
};
