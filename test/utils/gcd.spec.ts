import { expect } from "chai"
import { findGcd, gcd } from "../../src/utils/gcd"

describe("gcd utils", () => {
  describe("gcd", () => {
    it("calculates correct GCD for positive numbers", () => {
      expect(gcd(12, 18)).to.equal(6n)
      expect(gcd("100", "25")).to.equal(25n)
    })

    it("handles zero correctly", () => {
      expect(gcd(0, 5)).to.equal(5n)
      expect(gcd(7, 0)).to.equal(7n)
    })

    it("normalizes negative values to positive GCD", () => {
      expect(gcd(-12, 18)).to.equal(6n)
      expect(gcd(12, -18)).to.equal(6n)
      expect(gcd(-12, -18)).to.equal(6n)
      expect(gcd(0, -5)).to.equal(5n)
    })
  })

  describe("findGcd", () => {
    it("finds GCD of multiple elements", () => {
      expect(findGcd([24, 36, 60])).to.equal(12n)
      expect(findGcd(["10", "20", "30"])).to.equal(10n)
    })

    it("returns 0n for empty array without throwing TypeError", () => {
      expect(findGcd([])).to.equal(0n)
    })

    it("handles negative array elements", () => {
      expect(findGcd([-24, 36, -60])).to.equal(12n)
    })
  })
})
