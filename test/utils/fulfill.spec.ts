import { expect } from "chai"
import { ItemType, OrderType } from "../../src/constants"
import { generateFulfillOrdersFulfillments } from "../../src/utils/fulfill"
import type { FulfillOrdersMetadata } from "../../src/utils/fulfill"

const ZERO_ADDR = "0x0000000000000000000000000000000000000000"
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000"

const makeErc721Order = (
  offerer = "0x1111111111111111111111111111111111111111",
  token = "0xNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFT",
  tokenId = "1",
) => ({
  parameters: {
    offerer,
    offer: [
      {
        itemType: ItemType.ERC721,
        token,
        identifierOrCriteria: tokenId,
        startAmount: "1",
        endAmount: "1",
      },
    ],
    consideration: [],
    startTime: "0",
    endTime: "99999999999",
    orderType: OrderType.FULL_OPEN,
    zone: ZERO_ADDR,
    zoneHash: ZERO_HASH,
    salt: "0",
    conduitKey: ZERO_HASH,
    totalOriginalConsiderationItems: 0,
    counter: 0n,
  },
  signature: "0x",
})

const makeMeta = (order: ReturnType<typeof makeErc721Order>) =>
  ({
    order,
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
    offererBalancesAndApprovals: { balances: [], approvals: [] } as any,
    offererOperator: ZERO_ADDR,
  }) satisfies FulfillOrdersMetadata[number]

describe("generateFulfillOrdersFulfillments", () => {
  describe("ERC721 cross-order aggregation", () => {
    it("keeps ERC721s from different orders in separate fulfillment groups", () => {
      // Two orders from the same offerer for the same ERC721 token/id
      // Without the fix both land in the same group (amount=2 → InvalidERC721TransferAmount)
      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeErc721Order()),
        makeMeta(makeErc721Order()),
      ]

      const { offerFulfillments } =
        generateFulfillOrdersFulfillments(metadata)

      // Must produce TWO separate groups, each with exactly ONE component
      expect(offerFulfillments).to.have.length(2)
      expect(offerFulfillments[0]).to.deep.equal([
        { orderIndex: 0, itemIndex: 0 },
      ])
      expect(offerFulfillments[1]).to.deep.equal([
        { orderIndex: 1, itemIndex: 0 },
      ])
    })

    it("still aggregates ERC1155 items from different orders with same token/id", () => {
      const makeErc1155Order = () => ({
        ...makeErc721Order(),
        parameters: {
          ...makeErc721Order().parameters,
          offer: [
            {
              itemType: ItemType.ERC1155,
              token: "0xNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFT",
              identifierOrCriteria: "1",
              startAmount: "5",
              endAmount: "5",
            },
          ],
        },
      })

      const metadata: FulfillOrdersMetadata = [
        makeMeta(makeErc1155Order()),
        makeMeta(makeErc1155Order()),
      ]

      const { offerFulfillments } =
        generateFulfillOrdersFulfillments(metadata)

      // ERC1155s with same token/id CAN be aggregated (amount=10 is valid)
      expect(offerFulfillments).to.have.length(1)
      expect(offerFulfillments[0]).to.deep.equal([
        { orderIndex: 0, itemIndex: 0 },
        { orderIndex: 1, itemIndex: 0 },
      ])
    })
  })
})
