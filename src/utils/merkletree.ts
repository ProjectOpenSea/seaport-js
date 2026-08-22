import { keccak256, toBeHex } from "ethers"
import { MerkleTree as MerkleTreeJS } from "merkletreejs"

// Left-pads the identifier to a full 32 byte word before hashing, which is the
// preimage Seaport verifies criteria proofs against. The padded value stays a
// hex string rather than becoming a Buffer, so criteria orders can be built in
// a browser bundle, where the Node-only `Buffer` global is not defined.
const hashIdentifier = (identifier: string) =>
  keccak256(`0x${toBeHex(identifier).slice(2).padStart(64, "0")}`)

/**
 * Simple wrapper over the MerkleTree in merkletreejs.
 * Handles hashing identifiers to be compatible with Seaport.
 */
export class MerkleTree {
  tree: MerkleTreeJS

  constructor(identifiers: string[]) {
    this.tree = new MerkleTreeJS(identifiers.map(hashIdentifier), keccak256, {
      sort: true,
    })
  }

  getProof(identifier: string): string[] {
    return this.tree.getHexProof(hashIdentifier(identifier))
  }

  getRoot() {
    return this.tree.getRoot().toString("hex") ? this.tree.getHexRoot() : "0"
  }
}
