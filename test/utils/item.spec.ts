import { expect } from "chai"
import { getPresentItemAmount } from "../../src/utils/item"

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
  })
})
