import { expect } from "chai"
import { ItemType, OrderType } from "../../src/constants"
import type { ConsiderationItem, OrderComponents } from "../../src/types"
import { MerkleTree } from "../../src/utils/merkletree"
import {
  deductFees,
  freezeOrderComponents,
  mapInputItemToOfferItem,
} from "../../src/utils/order"

// deductFees subtracts the summed fee basisPoints from every currency item and
// is the point where an out-of-range fee first turns an order malformed: a total
// above 100% (10000 bp) makes the deduction larger than the item amount, leaving
// a negative consideration amount that later fails opaquely at ABI-encode time.
describe("deductFees fee-basisPoints bound", () => {
  const currencyItem = (amount: string): ConsiderationItem => ({
    itemType: ItemType.ERC20,
    token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    identifierOrCriteria: "0",
    startAmount: amount,
    endAmount: amount,
    recipient: "0x0000000000000000000000000000000000000000",
  })

  it("deducts a normal fee without altering the item below zero", () => {
    const [item] = deductFees(
      [currencyItem("100")],
      [
        {
          recipient: "0x0000000000000000000000000000000000000001",
          basisPoints: 250,
        },
      ],
    )
    expect(item.startAmount).to.eq("98")
    expect(item.endAmount).to.eq("98")
  })

  it("allows a total of exactly 100% (item amount becomes zero, not negative)", () => {
    const [item] = deductFees(
      [currencyItem("100")],
      [
        {
          recipient: "0x0000000000000000000000000000000000000001",
          basisPoints: 10000,
        },
      ],
    )
    expect(item.startAmount).to.eq("0")
    expect(item.endAmount).to.eq("0")
  })

  it("throws a clear error when total fee basisPoints exceed 100%", () => {
    expect(() =>
      deductFees(
        [currencyItem("100")],
        [
          {
            recipient: "0x0000000000000000000000000000000000000001",
            basisPoints: 7500,
          },
          {
            recipient: "0x0000000000000000000000000000000000000002",
            basisPoints: 7500,
          },
        ],
      ),
    ).to.throw("Total fee basisPoints (15000) cannot exceed 10000 (100%)")
  })

  it("throws for a single fee above 100% rather than emitting a negative amount", () => {
    expect(() =>
      deductFees(
        [currencyItem("100")],
        [
          {
            recipient: "0x0000000000000000000000000000000000000001",
            basisPoints: 10001,
          },
        ],
      ),
    ).to.throw("Total fee basisPoints (10001) cannot exceed 10000 (100%)")
  })
})

// freezeOrderComponents is what stops a caller from reading orderComponents off
// a create action, mutating it, and having the SDK sign different terms than
// what was exposed -- see the JSDoc on freezeOrderComponents for the full
// rationale. It's only otherwise exercised indirectly through the
// hardhat-network-backed execute-approvals.spec.ts, so it's worth covering as a
// fast, isolated unit here.
describe("freezeOrderComponents", () => {
  const orderComponents = (): OrderComponents => ({
    offerer: "0x0000000000000000000000000000000000000001",
    zone: "0x0000000000000000000000000000000000000000",
    offer: [
      {
        itemType: ItemType.ERC721,
        token: "0x0000000000000000000000000000000000000002",
        identifierOrCriteria: "1",
        startAmount: "1",
        endAmount: "1",
      },
    ],
    consideration: [
      {
        itemType: ItemType.NATIVE,
        token: "0x0000000000000000000000000000000000000000",
        identifierOrCriteria: "0",
        startAmount: "100",
        endAmount: "100",
        recipient: "0x0000000000000000000000000000000000000003",
      },
    ],
    orderType: OrderType.FULL_OPEN,
    startTime: "0",
    endTime: "999999",
    zoneHash: `0x${"00".repeat(32)}`,
    salt: "1",
    totalOriginalConsiderationItems: "1",
    conduitKey: `0x${"00".repeat(32)}`,
    counter: "0",
  })

  it("returns the same object reference rather than a clone", () => {
    const input = orderComponents()
    expect(freezeOrderComponents(input)).to.equal(input)
  })

  it("freezes the top-level order components", () => {
    const frozen = freezeOrderComponents(orderComponents())
    expect(Object.isFrozen(frozen)).to.be.true
    expect(() => {
      frozen.salt = "2"
    }).to.throw(TypeError)
  })

  it("deep-freezes offer items, not just the offer array", () => {
    const frozen = freezeOrderComponents(orderComponents())
    expect(Object.isFrozen(frozen.offer)).to.be.true
    expect(Object.isFrozen(frozen.offer[0])).to.be.true
    expect(() => {
      frozen.offer[0].startAmount = "999"
    }).to.throw(TypeError)
  })

  it("deep-freezes consideration items, not just the consideration array", () => {
    const frozen = freezeOrderComponents(orderComponents())
    expect(Object.isFrozen(frozen.consideration)).to.be.true
    expect(Object.isFrozen(frozen.consideration[0])).to.be.true
    expect(() => {
      frozen.consideration[0].recipient =
        "0x000000000000000000000000000000000000ff"
    }).to.throw(TypeError)
    expect(() => {
      frozen.offer.push(frozen.offer[0])
    }).to.throw(TypeError)
  })

  it("does not throw when a nested item is already frozen", () => {
    const input = orderComponents()
    Object.freeze(input.offer[0])
    expect(() => freezeOrderComponents(input)).to.not.throw()
    expect(Object.isFrozen(input)).to.be.true
  })
})

// mapInputItemToOfferItem is the single normalizer every createOrder input item
// passes through on its way to a Seaport OfferItem: it fans a CreateInputItem
// (basic ERC721/ERC1155, criteria items, and bare currency items) out into the
// fully-populated { itemType, token, identifierOrCriteria, startAmount, endAmount }
// shape the protocol signs over, applying the amount defaults each variant
// relies on. It is only otherwise exercised indirectly through the
// hardhat-network-backed create-order specs, so pin its branch-by-branch
// behavior here as fast, isolated units.
describe("mapInputItemToOfferItem", () => {
  const token = "0x0000000000000000000000000000000000000005"
  const ZERO = "0x0000000000000000000000000000000000000000"

  it("maps a basic ERC721 item, defaulting both amounts to 1", () => {
    expect(
      mapInputItemToOfferItem({
        itemType: ItemType.ERC721,
        token,
        identifier: "42",
      }),
    ).to.deep.equal({
      itemType: ItemType.ERC721,
      token,
      identifierOrCriteria: "42",
      startAmount: "1",
      endAmount: "1",
    })
  })

  it("maps a basic ERC1155 item, defaulting endAmount to the start amount", () => {
    expect(
      mapInputItemToOfferItem({
        itemType: ItemType.ERC1155,
        token,
        identifier: "7",
        amount: "5",
      }),
    ).to.deep.equal({
      itemType: ItemType.ERC1155,
      token,
      identifierOrCriteria: "7",
      startAmount: "5",
      endAmount: "5",
    })
  })

  it("preserves distinct start and end amounts for an ascending ERC1155 item", () => {
    const offerItem = mapInputItemToOfferItem({
      itemType: ItemType.ERC1155,
      token,
      identifier: "7",
      amount: "5",
      endAmount: "10",
    })
    expect(offerItem.startAmount).to.eq("5")
    expect(offerItem.endAmount).to.eq("10")
  })

  it("maps an ERC721 criteria item given an explicit merkle root", () => {
    expect(
      mapInputItemToOfferItem({
        itemType: ItemType.ERC721,
        token,
        criteria: "123",
      }),
    ).to.deep.equal({
      itemType: ItemType.ERC721_WITH_CRITERIA,
      token,
      identifierOrCriteria: "123",
      startAmount: "1",
      endAmount: "1",
    })
  })

  it("maps an ERC1155 criteria item, keeping its amount", () => {
    expect(
      mapInputItemToOfferItem({
        itemType: ItemType.ERC1155,
        token,
        amount: "2",
        criteria: "456",
      }),
    ).to.deep.equal({
      itemType: ItemType.ERC1155_WITH_CRITERIA,
      token,
      identifierOrCriteria: "456",
      startAmount: "2",
      endAmount: "2",
    })
  })

  it("derives the merkle root from identifiers for a criteria item", () => {
    const identifiers = ["1", "2", "3"]
    const offerItem = mapInputItemToOfferItem({
      itemType: ItemType.ERC721,
      token,
      identifiers,
    })
    expect(offerItem.itemType).to.eq(ItemType.ERC721_WITH_CRITERIA)
    expect(offerItem.identifierOrCriteria).to.eq(
      new MerkleTree(identifiers).getRoot(),
    )
  })

  it("maps a currency item with a token to ERC20", () => {
    expect(mapInputItemToOfferItem({ token, amount: "1000" })).to.deep.equal({
      itemType: ItemType.ERC20,
      token,
      identifierOrCriteria: "0",
      startAmount: "1000",
      endAmount: "1000",
    })
  })

  it("maps a currency item without a token to native", () => {
    expect(mapInputItemToOfferItem({ amount: "1000" })).to.deep.equal({
      itemType: ItemType.NATIVE,
      token: ZERO,
      identifierOrCriteria: "0",
      startAmount: "1000",
      endAmount: "1000",
    })
  })

  it("treats the zero-address token as native, not ERC20", () => {
    expect(
      mapInputItemToOfferItem({ token: ZERO, amount: "1000" }).itemType,
    ).to.eq(ItemType.NATIVE)
  })

  it("preserves a descending currency end amount", () => {
    const offerItem = mapInputItemToOfferItem({
      token,
      amount: "1000",
      endAmount: "900",
    })
    expect(offerItem.startAmount).to.eq("1000")
    expect(offerItem.endAmount).to.eq("900")
  })
})
