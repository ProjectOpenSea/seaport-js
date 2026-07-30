import { expect } from "chai"
import { ZeroAddress, ZeroHash } from "ethers"
import { ItemType, OrderType, Side } from "../../src/constants"
import type {
  ConsiderationItem,
  InputCriteria,
  OfferItem,
  Order,
} from "../../src/types"
import { generateCriteriaResolvers } from "../../src/utils/criteria"

const offerItem = (
  itemType: ItemType,
  identifierOrCriteria = "0",
): OfferItem => ({
  itemType,
  token: ZeroAddress,
  identifierOrCriteria,
  startAmount: "1",
  endAmount: "1",
})

const considerationItem = (
  itemType: ItemType,
  identifierOrCriteria = "0",
): ConsiderationItem => ({
  ...offerItem(itemType, identifierOrCriteria),
  recipient: ZeroAddress,
})

const order = (
  offer: OfferItem[],
  consideration: ConsiderationItem[] = [],
): Order => ({
  parameters: {
    offerer: ZeroAddress,
    zone: ZeroAddress,
    orderType: OrderType.FULL_OPEN,
    startTime: "0",
    endTime: "0",
    zoneHash: ZeroHash,
    salt: "0",
    offer,
    consideration,
    totalOriginalConsiderationItems: consideration.length,
    conduitKey: ZeroHash,
  },
  signature: "0x",
})

describe("generateCriteriaResolvers", () => {
  it("resolves criteria by criteria-item order, not by position in the offer array", () => {
    // The ERC20 at index 0 is not a criteria item, so offerCriterias holds a
    // single entry while the criteria item sits at index 1. Indexing the flat
    // criteria array by the item's offer position looked up criterias[0][1],
    // which is undefined.
    const criteria: InputCriteria = { identifier: "42", proof: [] }

    const resolvers = generateCriteriaResolvers({
      orders: [
        order([
          offerItem(ItemType.ERC20),
          offerItem(ItemType.ERC721_WITH_CRITERIA),
        ]),
      ],
      offerCriterias: [[criteria]],
    })

    expect(resolvers).to.have.lengthOf(1)
    expect(resolvers[0].identifier).to.equal("42")
    // index stays the position in the full offer array, which is what Seaport's
    // criteria resolvers expect.
    expect(resolvers[0].index).to.equal(1)
    expect(resolvers[0].orderIndex).to.equal(0)
    expect(resolvers[0].side).to.equal(Side.OFFER)
  })

  it("pairs multiple criteria items with their criteria in order", () => {
    const resolvers = generateCriteriaResolvers({
      orders: [
        order([
          offerItem(ItemType.ERC20),
          offerItem(ItemType.ERC721_WITH_CRITERIA),
          offerItem(ItemType.ERC1155),
          offerItem(ItemType.ERC1155_WITH_CRITERIA),
        ]),
      ],
      offerCriterias: [
        [
          { identifier: "11", proof: [] },
          { identifier: "22", proof: [] },
        ],
      ],
    })

    expect(
      resolvers.map(({ index, identifier }) => ({ index, identifier })),
    ).to.deep.equal([
      { index: 1, identifier: "11" },
      { index: 3, identifier: "22" },
    ])
  })

  it("resolves consideration criteria independently of offer criteria", () => {
    const resolvers = generateCriteriaResolvers({
      orders: [
        order(
          [offerItem(ItemType.ERC721_WITH_CRITERIA)],
          [
            considerationItem(ItemType.NATIVE),
            considerationItem(ItemType.ERC1155_WITH_CRITERIA),
          ],
        ),
      ],
      offerCriterias: [[{ identifier: "7", proof: [] }]],
      considerationCriterias: [[{ identifier: "9", proof: [] }]],
    })

    expect(
      resolvers.map(({ side, index, identifier }) => ({
        side,
        index,
        identifier,
      })),
    ).to.deep.equal([
      { side: Side.OFFER, index: 0, identifier: "7" },
      { side: Side.CONSIDERATION, index: 1, identifier: "9" },
    ])
  })

  it("resolves criteria per order across multiple orders", () => {
    const resolvers = generateCriteriaResolvers({
      orders: [
        order([offerItem(ItemType.ERC721_WITH_CRITERIA)]),
        order([
          offerItem(ItemType.ERC20),
          offerItem(ItemType.ERC721_WITH_CRITERIA),
        ]),
      ],
      offerCriterias: [
        [{ identifier: "100", proof: [] }],
        [{ identifier: "200", proof: [] }],
      ],
    })

    expect(
      resolvers.map(({ orderIndex, index, identifier }) => ({
        orderIndex,
        index,
        identifier,
      })),
    ).to.deep.equal([
      { orderIndex: 0, index: 0, identifier: "100" },
      { orderIndex: 1, index: 1, identifier: "200" },
    ])
  })

  it("throws a clear error when criteria are missing for a criteria item", () => {
    // Previously this threw "Cannot read properties of undefined" from the
    // criterias[orderIndex] lookup rather than a meaningful message.
    expect(() =>
      generateCriteriaResolvers({
        orders: [
          order([offerItem(ItemType.ERC721_WITH_CRITERIA)]),
          order([offerItem(ItemType.ERC721_WITH_CRITERIA)]),
        ],
        offerCriterias: [[{ identifier: "1", proof: [] }]],
      }),
    ).to.throw(
      "You must supply the appropriate criterias for criteria based items",
    )
  })

  it("returns no resolvers when no items are criteria based", () => {
    expect(
      generateCriteriaResolvers({
        orders: [order([offerItem(ItemType.ERC20)])],
      }),
    ).to.deep.equal([])
  })
})
