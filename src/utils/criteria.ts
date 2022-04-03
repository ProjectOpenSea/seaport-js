import MerkleTree from "merkletreejs";
import { ItemType, Side } from "../constants";
import { InputCriteria, Item, Order } from "../types";
import { isCriteriaItem } from "./item";
import keccak256 from "keccak256";

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
  const offerCriteriaItems = orders
    .map((order, orderIndex) =>
      order.parameters.offer
        .map(
          (item, index) =>
            ({
              orderIndex,
              item,
              index,
              side: Side.OFFER,
            } as const)
        )
        .filter(({ item }) => isCriteriaItem(item.itemType))
    )
    .flat();

  const considerationCriteriaItems = orders
    .map((order, orderIndex) =>
      order.parameters.consideration
        .map(
          (item, index) =>
            ({
              orderIndex,
              item,
              index,
              side: Side.CONSIDERATION,
            } as const)
        )
        .filter(({ item }) => isCriteriaItem(item.itemType))
    )
    .flat();

  const mapCriteriaItemsToResolver = (
    criteriaItems:
      | typeof offerCriteriaItems
      | typeof considerationCriteriaItems,
    criterias: InputCriteria[][]
  ) =>
    criteriaItems.map(({ orderIndex, item, index, side }, i) => {
      const merkleRoot = item.identifierOrCriteria || "0";
      const inputCriteria = criterias[orderIndex][i];
      const leaves = (inputCriteria.validIdentifiers ?? []).map(keccak256);
      const tree = new MerkleTree(leaves, keccak256, { sort: true });
      const criteriaProof = tree.getHexProof(
        keccak256(inputCriteria.identifier)
      );

      return {
        orderIndex,
        index,
        side,
        identifier: keccak256(inputCriteria.identifier),
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

export const getItemToCriteriaMap = (
  items: Item[],
  criterias: InputCriteria[]
) => {
  const criteriasCopy = [...criterias];

  return items.reduce((map, item) => {
    if (isCriteriaItem(item.itemType)) {
      map.set(item, criteriasCopy.shift() as InputCriteria);
    }
    return map;
  }, new Map<Item, InputCriteria>());
};
