import { keccak256, TypedDataEncoder, toUtf8Bytes } from "ethers"
import { EIP_712_BULK_ORDER_TYPE } from "../../constants.js"
import type { OrderComponents } from "../../types.js"
import type { EIP712TypeDefinitions } from "./defaults.js"
import { DefaultGetter } from "./defaults.js"
import { Eip712MerkleTree } from "./Eip712MerkleTree.js"
import { fillArray } from "./utils.js"

function getBulkOrderTypes(height: number): EIP712TypeDefinitions {
  const types = { ...EIP_712_BULK_ORDER_TYPE }
  types.BulkOrder = [
    { name: "tree", type: `OrderComponents${`[2]`.repeat(height)}` },
  ]
  return types
}

export function getBulkOrderTreeHeight(length: number): number {
  return Math.max(Math.ceil(Math.log2(length)), 1)
}

export function getBulkOrderTree(
  orderComponents: OrderComponents[],
  startIndex = 0,
  height = getBulkOrderTreeHeight(orderComponents.length + startIndex),
) {
  const types = getBulkOrderTypes(height)
  const defaultNode = DefaultGetter.from(types, "OrderComponents")
  let elements = [...orderComponents]

  if (startIndex > 0) {
    elements = [
      ...fillArray([] as OrderComponents[], startIndex, defaultNode),
      ...orderComponents,
    ]
  }
  const tree = new Eip712MerkleTree(
    types,
    "BulkOrder",
    "OrderComponents",
    elements,
    height,
  )
  return tree
}

export function getBulkOrderTypeHash(height: number): string {
  const types = getBulkOrderTypes(height)
  const encoder = TypedDataEncoder.from(types)
  const typeString = toUtf8Bytes(encoder.types.BulkOrder[0].type)
  return keccak256(typeString)
}

export function getBulkOrderTypeHashes(maxHeight: number): string[] {
  const typeHashes: string[] = []
  for (let i = 0; i < maxHeight; i++) {
    typeHashes.push(getBulkOrderTypeHash(i + 1))
  }
  return typeHashes
}
