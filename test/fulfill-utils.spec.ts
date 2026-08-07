import { expect } from "chai"
import { ItemType, OrderType } from "../src/constants"
import type {
  ConsiderationItem,
  OfferItem,
  Order,
  OrderParameters,
} from "../src/types"
import type { FulfillOrdersMetadata } from "../src/utils/fulfill"
import { generateFulfillOrdersFulfillments } from "../src/utils/fulfill"

const OFFERER = "0x1111111111111111111111111111111111111111"
const RECIPIENT = "0x2222222222222222222222222222222222222222"
const NFT = "0x3333333333333333333333333333333333333333"
const ZERO_ADDR = "0x0000000000000000000000000000000000000000"
const ZERO_HASH = `0x${"0".repeat(64)}`

const erc721Item = (tokenId = "1") => ({
  itemType: ItemType.ERC721,
  token: NFT,
  identifierOrCriteria: tokenId,
  startAmount: "1",
  endAmount: "1",
})

const erc1155Item = (tokenId = "1", amount = "5") => ({
  itemType: ItemType.ERC1155,
  token: NFT,
  identifierOrCriteria: tokenId,
  startAmount: amount,
  endAmount: amount,
})

const makeOrder = ({
  offer = [] as OfferItem[],
  consideration = [] as ConsiderationItem[],
}): Order => ({
  parameters: {
    offerer: OFFERER,
    zone: ZERO_ADDR,
    orderType: OrderType.FULL_OPEN,
    startTime: "0",
    endTime: "99999999999",
    zoneHash: ZERO_HASH,
    salt: "0",
    offer,
    consideration,
    totalOriginalConsiderationItems: consideration.length,
    conduitKey: ZERO_HASH,
  } satisfies OrderParameters,
  signature: "0x",
})

const makeMeta = (order: Order): FulfillOrdersMetadata[number] => ({
  order,
  orderStatus: {
    isValidated: false,
    isCancelled: false,
    totalFilled: 0n,
    totalSize: 1n,
  },
  offerCriteria: [],
  considerationCriteria: [],
  tips: [],
  extraData: "0x",
  offererBalancesAndApprovals: [],
  offererOperator: ZERO_ADDR,
})

describe("generateFulfillOrdersFulfillments", () => {
  describe("ERC721 cross-order aggregation", () => {
    it("keeps offer ERC721s from different orders in separate fulfillment groups", () => {
      // Two orders from the same offerer for the same ERC721 token/id, both at
      // offer[0]. When these collapse into one group Seaport aggregates them
      // into a single transfer with amount = 2 and reverts with
      // InvalidERC721TransferAmount.
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeOrder({ offer: [erc721Item()] })),
        makeMeta(makeOrder({ offer: [erc721Item()] })),
      ]

      const { offerFulfillments } = generateFulfillOrdersFulfillments(metadata)

      expect(offerFulfillments).to.deep.equal([
        [{ orderIndex: 0, itemIndex: 0 }],
        [{ orderIndex: 1, itemIndex: 0 }],
      ])
    })

    it("keeps consideration ERC721s from different orders in separate fulfillment groups", () => {
      const item: ConsiderationItem = { ...erc721Item(), recipient: RECIPIENT }
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeOrder({ consideration: [item] })),
        makeMeta(makeOrder({ consideration: [item] })),
      ]

      const { considerationFulfillments } =
        generateFulfillOrdersFulfillments(metadata)

      expect(considerationFulfillments).to.deep.equal([
        [{ orderIndex: 0, itemIndex: 0 }],
        [{ orderIndex: 1, itemIndex: 0 }],
      ])
    })

    it("keeps ERC721s within a single order in separate fulfillment groups", () => {
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeOrder({ offer: [erc721Item("1"), erc721Item("1")] })),
      ]

      const { offerFulfillments } = generateFulfillOrdersFulfillments(metadata)

      expect(offerFulfillments).to.deep.equal([
        [{ orderIndex: 0, itemIndex: 0 }],
        [{ orderIndex: 0, itemIndex: 1 }],
      ])
    })
  })

  describe("fungible aggregation is preserved", () => {
    it("still aggregates offer ERC1155s from different orders with the same token/id", () => {
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeOrder({ offer: [erc1155Item()] })),
        makeMeta(makeOrder({ offer: [erc1155Item()] })),
      ]

      const { offerFulfillments } = generateFulfillOrdersFulfillments(metadata)

      // ERC1155s are fungible per id, so a single transfer of amount 10 is valid.
      expect(offerFulfillments).to.deep.equal([
        [
          { orderIndex: 0, itemIndex: 0 },
          { orderIndex: 1, itemIndex: 0 },
        ],
      ])
    })

    it("still aggregates consideration ERC20s from different orders to the same recipient", () => {
      const item: ConsiderationItem = {
        itemType: ItemType.ERC20,
        token: NFT,
        identifierOrCriteria: "0",
        startAmount: "100",
        endAmount: "100",
        recipient: RECIPIENT,
      }
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeOrder({ consideration: [item] })),
        makeMeta(makeOrder({ consideration: [item] })),
      ]

      const { considerationFulfillments } =
        generateFulfillOrdersFulfillments(metadata)

      expect(considerationFulfillments).to.deep.equal([
        [
          { orderIndex: 0, itemIndex: 0 },
          { orderIndex: 1, itemIndex: 0 },
        ],
      ])
    })
  })
})
