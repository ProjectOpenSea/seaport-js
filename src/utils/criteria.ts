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
            ({ orderIndex, item, index, side: Side.OFFER } as const)
        ),
        ...order.parameters.consideration.map(
          (item, index) =>
            ({ orderIndex, item, index, side: Side.CONSIDERATION } as const)
        ),
      ].filter(
        ({ item }) =>
          item.itemType === ItemType.ERC721_WITH_CRITERIA ||
          item.itemType === ItemType.ERC1155_WITH_CRITERIA
      ),
    ])
    .flat() as (
    | {
        orderIndex: number;
        item:
          | FulfillInputErc721ItemWithCriteria<OfferItem>
          | FulfillInputErc1155ItemWithCriteria<OfferItem>;
        index: number;
        side: Side.OFFER;
      }
    | {
        orderIndex: number;
        item:
          | FulfillInputErc721ItemWithCriteria<ConsiderationItem>
          | FulfillInputErc1155ItemWithCriteria<ConsiderationItem>;
        index: number;
        side: Side.CONSIDERATION;
      }
  )[];

  return itemsWithCriteria.map(({ orderIndex, item, index, side }) => {
    const merkleRoot = item.identifierOrCriteria || "0";
    const tree = new MerkleTree(item.criteria.identifiers);
    const criteriaProof = tree.getProof(item.criteria.identifier);

    return {
      orderIndex,
      index,
      side,
      criteriaProof: merkleRoot === "0" ? [] : criteriaProof,
    };
  });
};
