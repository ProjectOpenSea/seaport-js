import MerkleTree from "merkletreejs";
import { ItemType, Side } from "../constants";
import {
  ConsiderationItem,
  FulfillInputErc1155ItemWithCriteria,
  FulfillInputErc721ItemWithCriteria,
  OfferItem,
  OrderWithCriteria,
} from "../types";

export const generateCriteriaResolvers = (orders: OrderWithCriteria[]) => {
  const itemsWithCriteria = orders
    .map((order, orderIndex) => [
      ...[
        ...order.parameters.offer.map(
          (item, index) =>
            ({
              orderIndex,
              item: item as
                | FulfillInputErc721ItemWithCriteria<OfferItem>
                | FulfillInputErc1155ItemWithCriteria<OfferItem>,
              index,
              side: Side.OFFER,
            } as const)
        ),
        ...order.parameters.consideration.map(
          (item, index) =>
            ({
              orderIndex,
              item: item as
                | FulfillInputErc721ItemWithCriteria<ConsiderationItem>
                | FulfillInputErc1155ItemWithCriteria<ConsiderationItem>,
              index,
              side: Side.CONSIDERATION,
            } as const)
        ),
      ].filter(
        ({ item }) =>
          item.itemType === ItemType.ERC721_WITH_CRITERIA ||
          item.itemType === ItemType.ERC1155_WITH_CRITERIA
      ),
    ])
    .flat();

  return itemsWithCriteria.map(({ orderIndex, item, index, side }) => {
    const merkleRoot = item.identifierOrCriteria || "0";
    const tree = new MerkleTree(item.criteria.identifiers);
    const criteriaProof = tree.getProof(item.criteria.identifier);

    return {
      orderIndex,
      index,
      side,
      identifier: item.criteria.identifier,
      criteriaProof: merkleRoot === "0" ? [] : criteriaProof,
    };
  });
};
