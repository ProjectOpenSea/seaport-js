import { expect } from "chai"
import { ItemType, OrderType } from "../src/constants"
import type {
  ConsiderationItem,
  OfferItem,
  Order,
  OrderParameters,
  OrderStatus,
} from "../src/types"
import type { FulfillOrdersMetadata } from "../src/utils/fulfill"
import {
  generateFulfillOrdersFulfillments,
  isOrderFulfillable,
  shouldUseBasicFulfill,
  validateAndSanitizeFromOrderStatus,
} from "../src/utils/fulfill"

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

describe("shouldUseBasicFulfill", () => {
  const ERC20_TOKEN = "0x4444444444444444444444444444444444444444"

  const nativeItem = (amount = "1000"): ConsiderationItem => ({
    itemType: ItemType.NATIVE,
    token: ZERO_ADDR,
    identifierOrCriteria: "0",
    startAmount: amount,
    endAmount: amount,
    recipient: OFFERER,
  })

  const erc20Item = (amount = "10"): ConsiderationItem => ({
    itemType: ItemType.ERC20,
    token: ERC20_TOKEN,
    identifierOrCriteria: "0",
    startAmount: amount,
    endAmount: amount,
    recipient: RECIPIENT,
  })

  const listing = makeOrder({
    offer: [erc721Item()],
    consideration: [nativeItem()],
  })

  it("uses basic fulfill for a plain native listing", () => {
    expect(shouldUseBasicFulfill(listing.parameters, 0n)).to.equal(true)
  })

  it("still uses basic fulfill when a tip shares the order's currency", () => {
    expect(
      shouldUseBasicFulfill(listing.parameters, 0n, [nativeItem("5")]),
    ).to.equal(true)
  })

  it("falls back to standard fulfill when a tip uses a different currency", () => {
    // fulfillBasicOrder passes tips through additionalRecipients, which Seaport
    // pays out in considerationToken. An ERC20 tip on a native order would be
    // paid as native currency, so the basic route must be rejected here.
    expect(
      shouldUseBasicFulfill(listing.parameters, 0n, [erc20Item()]),
    ).to.equal(false)
  })
})

const orderStatus = (overrides: Partial<OrderStatus> = {}): OrderStatus => ({
  isValidated: false,
  isCancelled: false,
  totalFilled: 0n,
  totalSize: 0n,
  ...overrides,
})

// validateAndSanitizeFromOrderStatus gates a single-order fulfill on the order's
// onchain status: it throws on a filled or cancelled order (so the fulfill fails
// loudly rather than reverting deep in Seaport) and, for an already-validated
// order, wipes the signature to save the gas of re-supplying it.
describe("validateAndSanitizeFromOrderStatus", () => {
  const signedOrder = (): Order => ({
    ...makeOrder({ offer: [erc721Item()] }),
    signature: "0xdeadbeef",
  })

  it("returns the order untouched when it is open, unfilled, and unvalidated", () => {
    const order = signedOrder()
    const result = validateAndSanitizeFromOrderStatus(order, orderStatus())
    // The else branch returns the same reference, signature intact.
    expect(result).to.equal(order)
    expect(result.signature).to.equal("0xdeadbeef")
  })

  it("wipes the signature of an already-validated order", () => {
    const order = signedOrder()
    const result = validateAndSanitizeFromOrderStatus(
      order,
      orderStatus({ isValidated: true }),
    )
    expect(result.signature).to.equal("0x")
    // A fresh object, so the caller's order is left untouched.
    expect(result).to.not.equal(order)
    expect(order.signature).to.equal("0xdeadbeef")
    expect(result.parameters).to.deep.equal(order.parameters)
  })

  it("throws when the order is already fully filled", () => {
    expect(() =>
      validateAndSanitizeFromOrderStatus(
        signedOrder(),
        orderStatus({ totalFilled: 4n, totalSize: 4n }),
      ),
    ).to.throw("already filled")
  })

  it("does not treat a partial fill as fully filled", () => {
    const order = signedOrder()
    const result = validateAndSanitizeFromOrderStatus(
      order,
      orderStatus({ totalFilled: 2n, totalSize: 4n }),
    )
    expect(result).to.equal(order)
  })

  it("throws when the order is cancelled", () => {
    expect(() =>
      validateAndSanitizeFromOrderStatus(
        signedOrder(),
        orderStatus({ isCancelled: true }),
      ),
    ).to.throw("cancelled")
  })

  it("reports the filled order first when it is both filled and cancelled", () => {
    // The filled check runs before the cancelled check.
    expect(() =>
      validateAndSanitizeFromOrderStatus(
        signedOrder(),
        orderStatus({ isCancelled: true, totalFilled: 4n, totalSize: 4n }),
      ),
    ).to.throw("already filled")
  })
})

// isOrderFulfillable mirrors the two rejections above without throwing, so a
// batch fulfill can drop the stale orders and settle the rest instead of taking
// the whole call down.
describe("isOrderFulfillable", () => {
  it("is true for an open, unfilled order", () => {
    expect(isOrderFulfillable(orderStatus())).to.equal(true)
  })

  it("is true for a partially filled order", () => {
    expect(
      isOrderFulfillable(orderStatus({ totalFilled: 2n, totalSize: 4n })),
    ).to.equal(true)
  })

  it("is false for a fully filled order", () => {
    expect(
      isOrderFulfillable(orderStatus({ totalFilled: 4n, totalSize: 4n })),
    ).to.equal(false)
  })

  it("is false for a cancelled order", () => {
    expect(isOrderFulfillable(orderStatus({ isCancelled: true }))).to.equal(
      false,
    )
  })

  it("treats a zero totalSize as fulfillable rather than dividing by zero", () => {
    // Seaport reports totalSize 0 for an order that has never been filled.
    expect(
      isOrderFulfillable(orderStatus({ totalFilled: 0n, totalSize: 0n })),
    ).to.equal(true)
  })
})
