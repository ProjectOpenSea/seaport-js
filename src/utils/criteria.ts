import MerkleTree from "merkletreejs";
import { ItemType, Side } from "../constants";
import { CriteriaResolverStruct } from "../typechain/Consideration";
import { IdentifiersToMatch, IdentifierWithCriteria, Order } from "../types";

export const generateCriteriaResolvers = (
  orders: Order[],
  identifiersWithCriteria: IdentifierWithCriteria[]
) => {
  const itemIndicesAndSides = orders
    .map((order, orderIndex) => [
      ...[
        ...order.parameters.offer.map(
          (item, index) => [orderIndex, item, index, Side.OFFER] as const
        ),
        ...order.parameters.consideration.map(
          (item, index) =>
            [orderIndex, item, index, Side.CONSIDERATION] as const
        ),
      ].filter(
        ([_, item]) =>
          item.itemType === ItemType.ERC721_WITH_CRITERIA ||
          item.itemType === ItemType.ERC1155_WITH_CRITERIA
      ),
    ])
    .flat();

  return itemIndicesAndSides.map(([orderIndex, item, index, side]) => {
    const merkleRoot = item.identifierOrCriteria || "0";

    for (let i = 0; i < identifiersWithCriteria.length; i++) {
      const { token, identifier, validIdentifiersForMerkleRoot } =
        identifiersWithCriteria[i];

      const tree = new MerkleTree(validIdentifiersForMerkleRoot);
      const criteriaProof = tree.getProof(identifier);

      if (
        (item.token.toLowerCase() === token.toLowerCase() &&
          merkleRoot === tree.getRoot().toString("hex")) ||
        merkleRoot === "0"
      ) {
        //
        return {
          orderIndex,
          side,
          index,
          identifier,
          criteriaProof,
        };
      }
    }
  });
};
