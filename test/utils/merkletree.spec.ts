import { expect } from "chai"
import { MerkleTree } from "../../src/utils/merkletree"
import { withoutGlobalBuffer } from "./without-global-buffer"

// This is the criteria path. `mapInputItemToOfferItem` turns an item's
// `identifiers` into a merkle root through this class, so every collection and
// trait offer built through `createOrder` runs through it. It is covered
// end-to-end by criteria-based.spec.ts against a real Seaport deployment, but
// only there, which leaves two properties unpinned: the exact leaf preimage, and
// whether it works anywhere other than Node.
describe("criteria MerkleTree", () => {
  const maxUint256 =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  const identifiers = ["1", "2", "3", "0", "255", maxUint256]

  // Captured from the Buffer-based implementation. Seaport verifies criteria
  // proofs onchain against `keccak256` of the identifier left-padded to a full
  // 32 byte word, so these values are consensus-critical: changing the preimage
  // silently invalidates every criteria order already signed against a root.
  const root =
    "0x72279d7180f70428b270f70e7db86c6109f30ba6bb3701d6f05467508a4d09c7"

  it("hashes an identifier as a full 32 byte word", () => {
    // A one-leaf tree's root is the leaf, so this pins the preimage directly:
    // keccak256(0x00..01), not keccak256(0x01) and not keccak256("1").
    expect(new MerkleTree(["1"]).getRoot()).to.eq(
      "0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6",
    )
  })

  it("builds the expected root over an odd number of identifiers", () => {
    expect(new MerkleTree(identifiers).getRoot()).to.eq(root)
  })

  it("builds the expected proof for a mid-tree identifier", () => {
    expect(new MerkleTree(identifiers).getProof("2")).to.deep.eq([
      "0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563",
      "0x4c5abe0e7a614c3823af05b9adc2c09c065a9f60b1e95721d337f7ae47b71a21",
      "0x95d8e4ad618b6fc07daabb3e0e2ba86cb9d26270df3280ce425f1e491cb75356",
    ])
  })

  it("builds the expected proof for the maximum uint256 identifier", () => {
    expect(new MerkleTree(identifiers).getProof(maxUint256)).to.deep.eq([
      "0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6",
      "0xb55518d7cf87ba2deb7ded26fc6150b73b33fac753629045863fded7c75158bd",
      "0x95d8e4ad618b6fc07daabb3e0e2ba86cb9d26270df3280ce425f1e491cb75356",
    ])
  })

  it("returns the '0' sentinel for an empty tree", () => {
    expect(new MerkleTree([]).getRoot()).to.eq("0")
  })

  it("builds a root without the Node-only Buffer global", () => {
    expect(
      withoutGlobalBuffer(() => new MerkleTree(identifiers).getRoot()),
    ).to.eq(root)
  })

  it("builds a proof without the Node-only Buffer global", () => {
    expect(
      withoutGlobalBuffer(() => new MerkleTree(identifiers).getProof("3")),
    ).to.deep.eq([
      "0xe08ec2af2cfc251225e1968fd6ca21e4044f129bffa95bac3503be8bdb30a367",
      "0xbef008cc1c3168b77620ea11b970aafc3ee4fcd8598bd65dd2eee43862d9c6ac",
    ])
  })
})
