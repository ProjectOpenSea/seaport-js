import { ItemType } from "../constants";
import { OrderParameters } from "../types";

/**
 * We should use basic fulfill order if the order adheres to the following criteria:
 *
 * 1. The order only contains a single offer item and contains at least one consideration item
 * 2. The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
 * 3. All other items have the same Ether or ERC20 item type and token
 * 4. All items have the same startAmount and endAmount
 */
export const shouldUseBasicFulfill = ({
  offer,
  consideration,
}: Pick<OrderParameters, "offer" | "consideration">) => {
  // Must be single offer and at least one consideration
  if (offer.length > 1 || consideration.length === 0) {
    return false;
  }

  const allItems = [...offer, ...consideration];

  const numNfts = allItems.filter(({ itemType }) =>
    [ItemType.ERC721, ItemType.ERC1155].includes(itemType)
  ).length;

  const numNftsWithCriteria = allItems.filter(({ itemType }) =>
    [ItemType.ERC721_WITH_CRITERIA, ItemType.ERC1155_WITH_CRITERIA].includes(
      itemType
    )
  ).length;

  // The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
  if (numNfts !== 1 && numNftsWithCriteria !== 0) {
    return false;
  }

  const currencies = allItems.filter(({ itemType }) =>
    [ItemType.NATIVE, ItemType.ERC20].includes(itemType)
  );

  const areCurrenciesTheSame = currencies.every(
    ({ itemType, token }) =>
      itemType === currencies[0].itemType && token === currencies[0].token
  );

  // All currencies need to have the same address and item type (Native, ERC20)
  if (!areCurrenciesTheSame) {
    return false;
  }

  // All individual items need to have the same startAmount and endAmount
  return allItems.every(
    ({ startAmount, endAmount }) => startAmount === endAmount
  );
};

export const fulfillBasicOrder = ({
  offer,
  consideration,
}: Pick<OrderParameters, "offer" | "consideration">) => {};
