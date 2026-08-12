import { expect } from "chai"
import { ItemType } from "../../src/constants"
import type { Item } from "../../src/types"
import {
  getPresentItemAmount,
  getSummedTokenAndIdentifierAmounts,
} from "../../src/utils/item"

describe("getPresentItemAmount", () => {
  describe("zero-duration order (startTime === endTime)", () => {
    it("returns endAmount without throwing RangeError for ascending amounts", () => {
      const result = getPresentItemAmount({
        startAmount: "1000",
        endAmount: "2000",
        timeBasedItemParams: {
          startTime: "1000",
          endTime: "1000",
          currentBlockTimestamp: 1001,
          ascendingAmountTimestampBuffer: 0,
          isConsiderationItem: false,
        },
      })
      expect(result).to.equal(2000n)
    })

    it("returns endAmount without throwing RangeError for descending amounts", () => {
      const result = getPresentItemAmount({
        startAmount: "2000",
        endAmount: "1000",
        timeBasedItemParams: {
          startTime: "1000",
          endTime: "1000",
          currentBlockTimestamp: 1001,
          ascendingAmountTimestampBuffer: 0,
          isConsiderationItem: false,
        },
      })
      expect(result).to.equal(1000n)
    })

    it("returns endAmount for consideration items", () => {
      const result = getPresentItemAmount({
        startAmount: "1000",
        endAmount: "3000",
        timeBasedItemParams: {
          startTime: "500",
          endTime: "500",
          currentBlockTimestamp: 600,
          ascendingAmountTimestampBuffer: 300,
          isConsiderationItem: true,
        },
      })
      expect(result).to.equal(3000n)
    })

    it("still returns startAmount when the order has not started yet", () => {
      // This case never threw: the not-yet-started branch returns before the
      // division. The zero-duration guard sits below that branch so this keeps
      // returning startAmount rather than endAmount.
      const result = getPresentItemAmount({
        startAmount: "1000",
        endAmount: "2000",
        timeBasedItemParams: {
          startTime: "2000",
          endTime: "2000",
          currentBlockTimestamp: 1000,
          ascendingAmountTimestampBuffer: 0,
          isConsiderationItem: false,
        },
      })
      expect(result).to.equal(1000n)
    })
  })
})

describe("getSummedTokenAndIdentifierAmounts", () => {
  const erc20Item = (token: string, amount: string): Item => ({
    itemType: ItemType.ERC20,
    token,
    identifierOrCriteria: "0",
    startAmount: amount,
    endAmount: amount,
  })

  it("sums amounts for the same token regardless of address casing", () => {
    const checksummed = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    const lowercased = checksummed.toLowerCase()

    const result = getSummedTokenAndIdentifierAmounts({
      items: [erc20Item(checksummed, "100"), erc20Item(lowercased, "200")],
      criterias: [],
    })

    expect(Object.keys(result)).to.deep.equal([lowercased])
    expect(result[lowercased]["0"]).to.equal(300n)
  })
})
