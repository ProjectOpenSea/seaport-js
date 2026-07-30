import { Side } from "../constants"
import type { InputCriteria, Item, Order } from "../types"
import { isCriteriaItem } from "./item"

export const generateCriteriaResolvers = ({
  orders,
  offerCriterias = [[]],
  considerationCriterias = [[]],
}: {
  orders: Order[]
  offerCriterias?: InputCriteria[][]
  considerationCriterias?: InputCriteria[][]
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
  )

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
  )

  const mapCriteriaItemsToResolver = (
    criteriaItems:
      | typeof offerCriteriaItems
      | typeof considerationCriteriaItems,
    criterias: InputCriteria[][],
  ) =>
    criteriaItems.map(({ orderIndex, item, index, side }) => {
      const merkleRoot = item.identifierOrCriteria || "0"
      const items =
        side === Side.OFFER
          ? orders[orderIndex].parameters.offer
          : orders[orderIndex].parameters.consideration
      const inputCriteria = getItemToCriteriaMap(
        items,
        criterias[orderIndex] ?? [],
      ).get(item)

      if (!inputCriteria) {
        throw new Error(
          "You must supply the appropriate criterias for criteria based items",
        )
      }

      return {
        orderIndex,
        index,
        side,
        identifier: inputCriteria.identifier,
        criteriaProof: merkleRoot === "0" ? [] : inputCriteria.proof,
      }
    })

  const criteriaResolvers = [
    ...mapCriteriaItemsToResolver(offerCriteriaItems, offerCriterias),
    ...mapCriteriaItemsToResolver(
      considerationCriteriaItems,
      considerationCriterias,
    ),
  ]

  return criteriaResolvers
}

export const getItemToCriteriaMap = (
  items: Item[],
  criterias: InputCriteria[],
) => {
  const criteriasCopy = [...criterias]

  return items.reduce((map, item) => {
    if (isCriteriaItem(item.itemType)) {
      map.set(item, criteriasCopy.shift() as InputCriteria)
    }
    return map
  }, new Map<Item, InputCriteria>())
}
