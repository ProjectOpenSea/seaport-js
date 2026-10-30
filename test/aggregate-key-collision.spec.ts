import { expect } from "chai"
import { ItemType, OrderType } from "../src/constants"
import type { ConsiderationItem, Order, OrderParameters } from "../src/types"
import type { FulfillOrdersMetadata } from "../src/utils/fulfill"
import { generateFulfillOrdersFulfillments } from "../src/utils/fulfill"

const OFFERER = "0x1111111111111111111111111111111111111111"
const RECIPIENT = "0x2222222222222222222222222222222222222222"
const NFT = "0x3333333333333333333333333333333333333333"
const ZERO_ADDR = "0x0000000000000000000000000000000000000000"
const ZERO_HASH = `0x${"0".repeat(64)}`

const erc721Item = (tokenId: string) => ({
  itemType: ItemType.ERC721,
  token: NFT,
  identifierOrCriteria: tokenId,
  startAmount: "1",
  endAmount: "1",
})

const makeMeta = ({
  offer = [] as Order["parameters"]["offer"],
  consideration = [] as ConsiderationItem[],
}): FulfillOrdersMetadata[number] => ({
  order: {
    parameters: {
      offerer: OFFERER,
      zone: ZERO_ADDR,
      orderType: OrderType.FULL_OPEN,
      startTime: "0",
      endTime: "99999999999",
      zoneHash: ZERO_HASH,
      salt: "0",
      offer,
      consideration,
      totalOriginalConsiderationItems: consideration.length,
      conduitKey: ZERO_HASH,
    } satisfies OrderParameters,
    signature: "0x",
  },
  orderStatus: {
    isValidated: false,
    isCancelled: false,
    totalFilled: 0n,
    totalSize: 1n,
  },
  offerCriteria: [],
  considerationCriteria: [],
  tips: [],
  extraData: "0x",
  offererBalancesAndApprovals: [],
  offererOperator: ZERO_ADDR,
})

describe("ERC721 aggregate key collision", () => {
  it("does not merge offer ERC721s when id and order index concatenate identically", () => {
    const metadata: FulfillOrdersMetadata = Array.from(
      { length: 12 },
      (_, i) =>
        i === 1
          ? makeMeta({ offer: [erc721Item("11")] })
          : i === 11
            ? makeMeta({ offer: [erc721Item("1")] })
            : makeMeta({}),
    )
    const { offerFulfillments } = generateFulfillOrdersFulfillments(metadata)
    expect(offerFulfillments).to.deep.equal([
      [{ orderIndex: 1, itemIndex: 0 }],
      [{ orderIndex: 11, itemIndex: 0 }],
    ])
  })

  it("does not merge consideration ERC721s when id and order index concatenate identically", () => {
    const c = (id: string): ConsiderationItem => ({
      ...erc721Item(id),
      recipient: RECIPIENT,
    })
    const metadata: FulfillOrdersMetadata = Array.from(
      { length: 12 },
      (_, i) =>
        i === 1
          ? makeMeta({ consideration: [c("11")] })
          : i === 11
            ? makeMeta({ consideration: [c("1")] })
            : makeMeta({}),
    )
    const { considerationFulfillments } =
      generateFulfillOrdersFulfillments(metadata)
    expect(considerationFulfillments).to.deep.equal([
      [{ orderIndex: 1, itemIndex: 0 }],
      [{ orderIndex: 11, itemIndex: 0 }],
    ])
  })
})
