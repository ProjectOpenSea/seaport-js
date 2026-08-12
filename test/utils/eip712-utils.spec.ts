import { expect } from "chai"
import { bufferToHex, hexToBuffer } from "../../src/utils/eip712/utils"

describe("eip712 utils", () => {
  describe("bufferToHex", () => {
    it("prefixes the hex encoding with 0x without interpreting it as a BigNumberish", () => {
      const buf = Buffer.from("abcd", "hex")

      expect(bufferToHex(buf)).to.eq("0xabcd")
    })

    it("preserves full-width zero buffers", () => {
      const buf = Buffer.alloc(32)

      expect(bufferToHex(buf)).to.eq(`0x${"00".repeat(32)}`)
    })

    it("round-trips with hexToBuffer", () => {
      const buf = Buffer.from("deadbeef", "hex")

      expect(hexToBuffer(bufferToHex(buf))).to.deep.eq(buf)
    })
  })
})
