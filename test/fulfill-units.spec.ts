import { expect } from "chai"
import type { Order } from "../src/types"
import { getAdvancedOrderNumeratorDenominator } from "../src/utils/fulfill"
import { getMaximumSizeForOrder } from "../src/utils/item"

// Builds a minimal Order shaped just enough for the amount-based helpers under
// test (getMaximumSizeForOrder / getAdvancedOrderNumeratorDenominator only read
// offer/consideration start & end amounts).
const orderWithAmounts = (
  offerAmounts: string[],
  considerationAmounts: string[],
): Order =>
  ({
    parameters: {
      offer: offerAmounts.map(amount => ({
        startAmount: amount,
        endAmount: amount,
      })),
      consideration: considerationAmounts.map(amount => ({
        startAmount: amount,
        endAmount: amount,
      })),
    },
    signature: "0x",
  }) as unknown as Order

describe("units-to-fill validation (getAdvancedOrderNumeratorDenominator)", () => {
  // An ERC721 (amount 1) listed for 10 ETH with a 2.5% fee: the amounts share
  // no common divisor, so maxUnits collapses to 1. This is the scenario from
  // https://github.com/ProjectOpenSea/seaport-js/issues/904
  const feedErc721 = orderWithAmounts(
    ["1"],
    ["9750000000000000000", "250000000000000000"],
  )

  it("reports maxUnits of 1 for a fee'd ERC721 (non-partially-fillable)", () => {
    expect(getMaximumSizeForOrder(feedErc721)).to.eq(1n)
  })

  it("full fills a fee'd ERC721 as 1/1 regardless of maxUnits", () => {
    // No unitsToFill => full fill. This is why fulfillOrder(s) works today for
    // ERC721s with fees, despite maxUnits being 1.
    expect(getAdvancedOrderNumeratorDenominator(feedErc721)).to.deep.eq({
      numerator: 1n,
      denominator: 1n,
    })
    // Explicitly filling the single available unit is also a full fill.
    expect(getAdvancedOrderNumeratorDenominator(feedErc721, 1)).to.deep.eq({
      numerator: 1n,
      denominator: 1n,
    })
  })

  it("computes an exact fraction for a valid partial fill", () => {
    // ERC1155 amount 6 with cleanly divisible amounts => maxUnits 6.
    const partiallyFillable = orderWithAmounts(["6"], ["12", "6"])
    expect(getMaximumSizeForOrder(partiallyFillable)).to.eq(6n)
    expect(
      getAdvancedOrderNumeratorDenominator(partiallyFillable, 4),
    ).to.deep.eq({ numerator: 2n, denominator: 3n })
  })

  it("throws a clear error when unitsToFill exceeds the order's divisibility", () => {
    // Requesting 2 units of an order that can only be filled as a whole would
    // previously produce numerator/denominator 2/1 (an over-fill) and revert
    // on-chain with an opaque NoSpecifiedOrdersAvailable error.
    expect(() => getAdvancedOrderNumeratorDenominator(feedErc721, 2)).to.throw(
      "Cannot fill 2 units: this order is only divisible into 1 unit(s)",
    )
  })
})
