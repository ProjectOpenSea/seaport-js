import { Side } from "../constants";
import { InputCriteria, Item, Order } from "../types";
import { isCriteriaItem } from "./item";

export const generateCriteriaResolvers = ({
  orders,
  offerCriterias = [[]],
  considerationCriterias = [[]],
}: {
  orders: Order[];
  offerCriterias?: InputCriteria[][];
  considerationCriterias?: InputCriteria[][];
}) => {
  const offerCriteriaItems = orders.flatMap((order, orderIndex) =>
    order.parameters.offer
      .map(
        (item, index) =>
          ({
            orderIndex,
            item,
            index,
            side: Side.OFFER,
          }) as const,
      )
      .filter(({ item }) => isCriteriaItem(item.itemType)),
  );

  const considerationCriteriaItems = orders.flatMap((order, orderIndex) =>
    order.parameters.consideration
      .map(
        (item, index) =>
          ({
            orderIndex,
            item,
            index,
            side: Side.CONSIDERATION,
          }) as const,
      )
      .filter(({ item }) => isCriteriaItem(item.itemType)),
  );

  const mapCriteriaItemsToResolver = (
    criteriaItems:
      | typeof offerCriteriaItems
      | typeof considerationCriteriaItems,
    criterias: InputCriteria[][],
  ) =>
    criteriaItems.map(({ orderIndex, item, index, side }) => {
      const merkleRoot = item.identifierOrCriteria || "0";
      const inputCriteria: InputCriteria = criterias[orderIndex][index];
      return {
        orderIndex,
        index,
        side,
        identifier: inputCriteria.identifier,
        criteriaProof: merkleRoot === "0" ? [] : inputCriteria.proof,
      };
    });

  const criteriaResolvers = [
    ...mapCriteriaItemsToResolver(offerCriteriaItems, offerCriterias),
    ...mapCriteriaItemsToResolver(
      considerationCriteriaItems,
      considerationCriterias,
    ),
  ];

  return criteriaResolvers;
};

export const getItemToCriteriaMap = (
  items: Item[],
  criterias: InputCriteria[],
) => {
  const criteriasCopy = [...criterias];

  return items.reduce((map, item) => {
    if (isCriteriaItem(item.itemType)) {
      map.set(item, criteriasCopy.shift() as InputCriteria);
    }
    return map;
  }, new Map<Item, InputCriteria>());
};
