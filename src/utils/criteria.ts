import MerkleTree from "merkletreejs";
import { ItemType, Side } from "../constants";
import { InputCriteria, Order } from "../types";

export const generateCriteriaResolvers = (
  orders: Order[],
  {
    offerCriterias = [[]],
    considerationCriterias = [[]],
  }: {
    offerCriterias?: InputCriteria[][];
    considerationCriterias?: InputCriteria[][];
  }
) => {
  const itemsWithCriteria = orders.map((order, orderIndex) => [
    ...[
      ...order.parameters.offer.map(
        (item, index) =>
          ({
            orderIndex,
            item,
            index,
            side: Side.OFFER,
          } as const)
      ),
      ...order.parameters.consideration.map(
        (item, index) =>
          ({
            orderIndex,
            item,
            index,
            side: Side.CONSIDERATION,
          } as const)
      ),
    ].filter(
      ({ item }) =>
        item.itemType === ItemType.ERC721_WITH_CRITERIA ||
        item.itemType === ItemType.ERC1155_WITH_CRITERIA
    ),
  ]);

  const [offerCriteriaItems = [], considerationCriteriaItems = []] =
    itemsWithCriteria;

  const mapCriteriaItemsToResolver = (
    criteriaItems: typeof itemsWithCriteria[number],
    criterias: InputCriteria[][]
  ) =>
    criteriaItems.map(({ orderIndex, item, index, side }, i) => {
      const merkleRoot = item.identifierOrCriteria || "0";
      const inputCriteria = criterias[orderIndex][i];
      const tree = new MerkleTree(inputCriteria.validIdentifiers ?? []);
      const criteriaProof = tree.getProof(inputCriteria.identifier);

      return {
        orderIndex,
        index,
        side,
        identifier: inputCriteria.identifier,
        criteriaProof: merkleRoot === "0" ? [] : criteriaProof,
      };
    });

  const criteriaResolvers = [
    ...mapCriteriaItemsToResolver(offerCriteriaItems, offerCriterias),
    ...mapCriteriaItemsToResolver(
      considerationCriteriaItems,
      considerationCriterias
    ),
  ];

  return criteriaResolvers;
};
