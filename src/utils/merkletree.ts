import { BigNumber } from "ethers";
import { keccak256 } from "ethers/lib/utils";
import MerkleTreeJS from "merkletreejs";

const hashIdentifier = (identifier: string) =>
  keccak256(
    Buffer.from(
      BigNumber.from(identifier).toHexString().slice(2).padStart(64, "0"),
      "hex"
    )
  );

/**
 * Simple wrapper over the MerkleTree in merkletreejs.
 * Handles hashing identifiers to be compatible with Seaport.
 */
export class MerkleTree {
  tree: MerkleTreeJS;

  constructor(identifiers: string[]) {
    this.tree = new MerkleTreeJS(identifiers.map(hashIdentifier), keccak256, {
      sort: true,
    });
  }

  getProof(identifier: string): string[] {
    return this.tree.getHexProof(hashIdentifier(identifier));
  }

  getRoot() {
    return this.tree.getRoot().toString("hex") ? this.tree.getHexRoot() : "0";
  }
}
