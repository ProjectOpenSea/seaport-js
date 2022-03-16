import { BigNumber } from "ethers";
import { BasicFulfillOrder, ItemType } from "../constants";
import type { Consideration } from "../typechain/Consideration";
import { OfferItem, Order } from "../types";

/**
 * We should use basic fulfill order if the order adheres to the following criteria:
 *
 * 1. The order only contains a single offer item and contains at least one consideration item
 * 2. The order only contains a single ERC721 or ERC1155 item and that item is not criteria-based
 * 3. All other items have the same Ether or ERC20 item type and token
 * 4. All items have the same startAmount and endAmount
 * 5. First consideration item must contain the offerer as the recipient
 */
export const shouldUseBasicFulfill = ({
  parameters: { offer, consideration, offerer },
}: Order) => {
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

  const areCurrenciesDifferent = currencies.some(
    ({ itemType, token }) =>
      itemType !== currencies[0].itemType ||
      token.toLowerCase() !== currencies[0].token.toLowerCase()
  );

  // All currencies need to have the same address and item type (Native, ERC20)
  if (areCurrenciesDifferent) {
    return false;
  }

  // All individual items need to have the same startAmount and endAmount
  const differentStartAndEndAmount = allItems.some(
    ({ startAmount, endAmount }) => startAmount !== endAmount
  );

  if (differentStartAndEndAmount) {
    return false;
  }

  // First consideration item must contain the offerer as the recipient
  return consideration[0].recipient.toLowerCase() === offerer.toLowerCase();
};

const offerAndConsiderationFulfillmentMapping: {
  [_key in ItemType]?: { [_key in ItemType]?: BasicFulfillOrder };
} = {
  [ItemType.NATIVE]: {
    [ItemType.ERC721]: BasicFulfillOrder.ETH_FOR_ERC721,
    [ItemType.ERC1155]: BasicFulfillOrder.ETH_FOR_ERC1155,
  },
  [ItemType.ERC20]: {
    [ItemType.ERC721]: BasicFulfillOrder.ERC20_FOR_ERC721,
    [ItemType.ERC1155]: BasicFulfillOrder.ERC20_FOR_ERC1155,
  },
  [ItemType.ERC721]: {
    [ItemType.ERC20]: BasicFulfillOrder.ERC721_FOR_ERC20,
  },
  [ItemType.ERC1155]: {
    [ItemType.ERC20]: BasicFulfillOrder.ERC1155_FOR_ERC20,
  },
} as const;

/**
 * Executes one of the six basic fulfillment methods
 *
 * 1. fulfillBasicEthForERC721Order
 * 2. fulfillBasicEthForERC1155Order
 * 3. fulfillBasicERC1155ForERC20Order
 * 4. fulfillBasicERC20ForERC1155Order
 * 5. fulfillBasicERC20ForERC721Order
 * 6. fulfillBasicERC721ForERC20Order
 *
 * @param order - Standard order object
 * @param contract - Consideration ethers contract
 */
export const fulfillBasicOrder = (
  { parameters: orderParameters, signature }: Order,
  contract: Consideration,
  { useFulfillerProxy }: { useFulfillerProxy: boolean } = {
    useFulfillerProxy: false,
  }
) => {
  const { offer, consideration } = orderParameters;

  const offerItem = offer[0];
  const [forOfferer, ...forAdditionalRecipients] = consideration;

  const basicFulfillOrder =
    offerAndConsiderationFulfillmentMapping[offerItem.itemType]?.[
      forOfferer.itemType
    ];

  if (basicFulfillOrder === undefined) {
    throw new Error(
      "Order parameters did not result in a valid basic fulfillment"
    );
  }

  const additionalRecipients = forAdditionalRecipients.map(
    ({ startAmount, recipient }) => ({ amount: startAmount, recipient })
  );

  const totalEthAmount = totalItemsAmount(consideration).endAmount;

  const basicOrderParameters = {
    offerer: orderParameters.offerer,
    zone: orderParameters.zone,
    orderType: orderParameters.orderType,
    token: offerItem.token,
    identifier: offerItem.identifierOrCriteria,
    startTime: orderParameters.startTime,
    endTime: orderParameters.endTime,
    salt: orderParameters.salt,
    useFulfillerProxy,
    signature,
    additionalRecipients,
  };

  const payableOverrides = { value: totalEthAmount };

  // TODO: Check approvals here

  switch (basicFulfillOrder) {
    case BasicFulfillOrder.ETH_FOR_ERC721: {
      return contract.fulfillBasicEthForERC721Order(
        totalEthAmount,
        basicOrderParameters,
        payableOverrides
      );
    }
    case BasicFulfillOrder.ETH_FOR_ERC1155:
      return contract.fulfillBasicEthForERC1155Order(
        totalEthAmount,
        // The order offer is ERC1155
        offerItem.endAmount,
        basicOrderParameters,
        payableOverrides
      );
    case BasicFulfillOrder.ERC20_FOR_ERC721:
      return contract.fulfillBasicERC20ForERC721Order(
        // The order consideration is ERC20
        forOfferer.token,
        forOfferer.endAmount,
        basicOrderParameters
      );
    case BasicFulfillOrder.ERC20_FOR_ERC1155:
      return contract.fulfillBasicERC20ForERC1155Order(
        // The order consideration is ERC20
        forOfferer.token,
        forOfferer.endAmount,
        offerItem.endAmount,
        basicOrderParameters
      );
    case BasicFulfillOrder.ERC721_FOR_ERC20:
      return contract.fulfillBasicERC721ForERC20Order(
        // The order offer is ERC20
        offerItem.token,
        offerItem.endAmount,
        basicOrderParameters
      );
    case BasicFulfillOrder.ERC1155_FOR_ERC20:
      return contract.fulfillBasicERC1155ForERC20Order(
        // The order offer is ERC20
        offerItem.token,
        offerItem.endAmount,
        // The order consideration is ERC1155
        forOfferer.endAmount,
        basicOrderParameters
      );
  }
};

const totalItemsAmount = <T extends OfferItem>(items: T[]) => {
  const initialValues = {
    startAmount: BigNumber.from(0),
    endAmount: BigNumber.from(0),
  };

  return items
    .map(({ startAmount, endAmount }) => ({
      startAmount,
      endAmount,
    }))
    .reduce<typeof initialValues>(
      (
        { startAmount: totalStartAmount, endAmount: totalEndAmount },
        { startAmount, endAmount }
      ) => ({
        startAmount: totalStartAmount.add(startAmount),
        endAmount: totalEndAmount.add(endAmount),
      }),
      {
        startAmount: BigNumber.from(0),
        endAmount: BigNumber.from(0),
      }
    );
};
