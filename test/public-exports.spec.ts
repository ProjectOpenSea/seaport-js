import { expect } from "chai"
import * as seaportJs from "../src/index"

// The entry point is all a consumer can reach without a deep import, so
// anything the docs hand them has to be reachable from here.
describe("public exports", () => {
  it("exports the client", () => {
    expect(seaportJs).to.have.property("Seaport")
  })

  it("exports ItemType, which the README's order examples are written with", () => {
    expect(seaportJs).to.have.property("ItemType")
    expect(seaportJs.ItemType.ERC721).to.eq(2)
  })

  it("exports getMaximumSizeForOrder, which fulfillOrder's docs point at", () => {
    expect(seaportJs).to.have.property("getMaximumSizeForOrder")
    expect(seaportJs.getMaximumSizeForOrder).to.be.a("function")
  })
})
