import { ItemType } from "../constants";
import type { InputCriteria, Item, Order, OrderParameters } from "../types";
import { getItemToCriteriaMap } from "./criteria";
import { findGcd } from "./gcd";

export const isCurrencyItem = ({ itemType }: Item) =>
  [ItemType.NATIVE, ItemType.ERC20].includes(itemType);

export const isNativeCurrencyItem = ({ itemType }: Item) =>
  itemType === ItemType.NATIVE;

export const isErc20Item = (itemType: Item["itemType"]) =>
  itemType === ItemType.ERC20;

export const isErc721Item = (itemType: Item["itemType"]) =>
  [ItemType.ERC721, ItemType.ERC721_WITH_CRITERIA].includes(itemType);

export const isErc1155Item = (itemType: Item["itemType"]) =>
  [ItemType.ERC1155, ItemType.ERC1155_WITH_CRITERIA].includes(itemType);

export const isCriteriaItem = (itemType: Item["itemType"]) =>
  [ItemType.ERC721_WITH_CRITERIA, ItemType.ERC1155_WITH_CRITERIA].includes(
    itemType,
  );

export type TimeBasedItemParams = {
  isConsiderationItem?: boolean;
  currentBlockTimestamp: number;
  ascendingAmountTimestampBuffer: number;
} & Pick<OrderParameters, "startTime" | "endTime">;

export const getPresentItemAmount = ({
  startAmount,
  endAmount,
  timeBasedItemParams,
}: Pick<Item, "startAmount" | "endAmount"> & {
  timeBasedItemParams?: TimeBasedItemParams;
}): bigint => {
  const startAmountBn = BigInt(startAmount);
  const endAmountBn = BigInt(endAmount);

  if (!timeBasedItemParams) {
    return startAmountBn > endAmountBn ? startAmountBn : endAmountBn;
  }

  const {
    isConsiderationItem,
    currentBlockTimestamp,
    ascendingAmountTimestampBuffer,
    startTime,
    endTime,
  } = timeBasedItemParams;

  const startTimeBn = BigInt(startTime);
  const endTimeBn = BigInt(endTime);

  const duration = endTimeBn - startTimeBn;
  const isAscending = endAmountBn > startAmountBn;
  const adjustedBlockTimestamp = BigInt(
    isAscending
      ? currentBlockTimestamp + ascendingAmountTimestampBuffer
      : currentBlockTimestamp,
  );

  if (adjustedBlockTimestamp < startTimeBn) {
    return startAmountBn;
  }

  const elapsed =
    (adjustedBlockTimestamp > endTimeBn ? endTimeBn : adjustedBlockTimestamp) -
    startTimeBn;

  const remaining = duration - elapsed;

  // Adjust amounts based on current time
  // For offer items, we round down
  // For consideration items, we round up
  return (
    (startAmountBn * remaining +
      endAmountBn * elapsed +
      (isConsiderationItem ? duration - 1n : 0n)) /
    duration
  );
};

export const getSummedTokenAndIdentifierAmounts = ({
  items,
  criterias,
  timeBasedItemParams,
}: {
  items: Item[];
  criterias: InputCriteria[];
  timeBasedItemParams?: TimeBasedItemParams;
}) => {
  const itemToCriteria = getItemToCriteriaMap(items, criterias);

  const tokenAndIdentifierToSummedAmount = items.reduce<
    Record<string, Record<string, bigint>>
  >((map, item) => {
    const identifierOrCriteria =
      itemToCriteria.get(item)?.identifier ?? item.identifierOrCriteria;

    return {
      ...map,
      [item.token]: {
        ...map[item.token],
        // Being explicit about the undefined type as it's possible for it to be undefined at first iteration
        [identifierOrCriteria]:
          ((map[item.token]?.[identifierOrCriteria] as bigint | undefined) ??
            0n) +
          getPresentItemAmount({
            startAmount: item.startAmount,
            endAmount: item.endAmount,
            timeBasedItemParams,
          }),
      },
    };
  }, {});

  return tokenAndIdentifierToSummedAmount;
};

/**
 * Returns the maximum size of units possible for the order
 * If any of the items on a partially fillable order specify a different "startAmount" and "endAmount
 * (e.g. they are ascending-amount or descending-amount items), the fraction will be applied to both amounts
 * prior to determining the current price. This ensures that cleanly divisible amounts can be chosen when
 * constructing the order without a dependency on the time when the order is ultimately fulfilled.
 */
export const getMaximumSizeForOrder = ({
  parameters: { offer, consideration },
}: Order) => {
  const allItems = [...offer, ...consideration];

  const amounts = allItems.flatMap(({ startAmount, endAmount }) => [
    startAmount,
    endAmount,
  ]);

  return findGcd(amounts);
};
