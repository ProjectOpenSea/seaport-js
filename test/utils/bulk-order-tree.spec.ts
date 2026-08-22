import { expect } from "chai"
import { ItemType, OrderType } from "../../src/constants"
import type { OrderComponents } from "../../src/types"
import { getBulkOrderTree } from "../../src/utils/eip712/bulk-orders"
import { withoutGlobalBuffer } from "./without-global-buffer"

// getBulkOrderTree backs Seaport.signBulkOrder and Seaport._getBulkMessageToSign.
// create-bulk-orders.spec.ts covers it end-to-end against a real deployment,
// which does check the root implicitly (the contract verifies the proof), but
// only in Node and only for the sizes that spec happens to use. The roots below
// were captured before the tree switched from Buffer leaves to hex leaves; the
// encoded proof is what lands in an order's `signature`, so drift here breaks
// every bulk order signed against the old shape.
describe("getBulkOrderTree", () => {
  const orderComponents = (salt: string): OrderComponents => ({
    offerer: `0x${"11".repeat(20)}`,
    zone: `0x${"22".repeat(20)}`,
    offer: [
      {
        itemType: ItemType.ERC721,
        token: `0x${"33".repeat(20)}`,
        identifierOrCriteria: "7",
        startAmount: "1",
        endAmount: "1",
      },
    ],
    consideration: [
      {
        itemType: ItemType.NATIVE,
        token: `0x${"00".repeat(20)}`,
        identifierOrCriteria: "0",
        startAmount: "1000",
        endAmount: "1000",
        recipient: `0x${"44".repeat(20)}`,
      },
    ],
    orderType: OrderType.FULL_OPEN,
    startTime: "1",
    endTime: "2",
    zoneHash: `0x${"00".repeat(32)}`,
    salt,
    totalOriginalConsiderationItems: "1",
    conduitKey: `0x${"00".repeat(32)}`,
    counter: "0",
  })

  const orders = (count: number) =>
    Array.from({ length: count }, (_, i) => orderComponents(String(i + 1)))

  const signature = `0x${"ab".repeat(64)}`

  // One order and three orders both pad the tree with default leaves, which is
  // the `fillDefaultHash` option whose type changed.
  const roots: Record<number, string> = {
    1: "0xdd5989e38e6f58b2830a0eabdab5d1c43caa7c93a3aa0b5684634b0e9248f9e6",
    2: "0xe3ead7f64efb41362480141b0eb55141431ef29d986885cfb07d26b552a84e3d",
    3: "0xaf59e4d3d5a334bc0e1bf01c54cdc129224bbdd19c15fa0e58192b83e01bf0ab",
    5: "0xb1659c3088ec9176dc46f72f92f1e0c6b7df863ec18b7a3d25f72a294fdb3e9b",
  }

  for (const count of [1, 2, 3, 5]) {
    it(`builds the expected root for ${count} order(s)`, () => {
      expect(getBulkOrderTree(orders(count)).root).to.eq(roots[count])
    })
  }

  it("builds the expected proof for a padded tree", () => {
    expect(getBulkOrderTree(orders(3)).getProof(0).proof).to.deep.eq([
      "0x4d31f413ed438ef9c8dce741c610a9f664a8844f9f5f7b17c8034b7d543c2620",
      "0x501081ff3ecfd8e6345c1d62df939fa10fdf8c469b009bc2f0c3d3001813468d",
    ])
  })

  it("encodes the proof and signature into the bulk order signature", () => {
    expect(
      getBulkOrderTree(orders(3)).getEncodedProofAndSignature(0, signature),
    ).to.eq(
      `${signature}000000` +
        "4d31f413ed438ef9c8dce741c610a9f664a8844f9f5f7b17c8034b7d543c2620" +
        "501081ff3ecfd8e6345c1d62df939fa10fdf8c469b009bc2f0c3d3001813468d",
    )
  })

  it("builds the tree without the Node-only Buffer global", () => {
    expect(withoutGlobalBuffer(() => getBulkOrderTree(orders(3)).root)).to.eq(
      roots[3],
    )
  })

  it("encodes a bulk order signature without the Node-only Buffer global", () => {
    const encoded = withoutGlobalBuffer(() =>
      getBulkOrderTree(orders(3)).getEncodedProofAndSignature(0, signature),
    )

    expect(encoded).to.eq(
      `${signature}000000` +
        "4d31f413ed438ef9c8dce741c610a9f664a8844f9f5f7b17c8034b7d543c2620" +
        "501081ff3ecfd8e6345c1d62df939fa10fdf8c469b009bc2f0c3d3001813468d",
    )
  })

  it("builds the data to sign without the Node-only Buffer global", () => {
    // getDataToSign is what Seaport.signBulkOrder hands to signTypedData, and
    // it runs through the same tree construction.
    const chunks = withoutGlobalBuffer(
      () => getBulkOrderTree(orders(2)).getDataToSign() as OrderComponents[],
    )

    expect(chunks).to.have.lengthOf(2)
    expect(chunks[0].salt).to.eq("1")
    expect(chunks[1].salt).to.eq("2")
  })
})
