import { expect } from "chai"
import { ItemType } from "../../src/constants"
import type { ConsiderationItem } from "../../src/types"
import { deductFees } from "../../src/utils/order"

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
