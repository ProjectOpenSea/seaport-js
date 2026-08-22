import {
  type BigNumberish,
  concat,
  ethers,
  hexlify,
  keccak256,
  randomBytes,
  toBeHex,
  toUtf8Bytes,
} from "ethers"
import { ItemType, ONE_HUNDRED_PERCENT_BP } from "../constants"
import type {
  ConsiderationItem,
  CreateInputItem,
  Fee,
  Item,
  OfferItem,
  Order,
  OrderComponents,
  OrderParameters,
} from "../types"
import { getMaximumSizeForOrder, isCurrencyItem } from "./item"
import { MerkleTree } from "./merkletree"

const multiplyBasisPoints = (amount: BigNumberish, basisPoints: BigNumberish) =>
  (BigInt(amount) * BigInt(basisPoints)) / ONE_HUNDRED_PERCENT_BP

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }

  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }

  return Object.freeze(value)
}

/**
 * Freezes an order's components before they are handed to a caller.
 *
 * `createOrder` and `createBulkOrders` expose the built `orderComponents` on
 * their create action, and the same object is what `getMessageToSign()` and
 * `createOrder()` sign. Without this, a caller could read the components,
 * mutate them, and then sign terms that differ from the ones the SDK built and
 * validated -- and in an app where one layer inspects the order and another
 * signs it, those two layers would disagree silently.
 *
 * Freezing rather than copying keeps a single object, so a mutation attempt
 * fails loudly under ESM's strict mode instead of being quietly dropped on a
 * clone the signer never sees. Every consumer of these components (`signOrder`,
 * `signBulkOrder`, `_getMessageToSign`, `getBulkOrderTree`) only reads them, and
 * `getBulkOrderTree` copies before padding, so nothing needs them mutable.
 */
export const freezeOrderComponents = <T extends OrderComponents>(
  orderComponents: T,
): T => deepFreeze(orderComponents)

export const feeToConsiderationItem = ({
  fee,
  token,
  baseAmount,
  baseEndAmount = baseAmount,
}: {
  fee: Fee
  token: string
  baseAmount: BigNumberish
  baseEndAmount?: BigNumberish
}): ConsiderationItem => {
  return {
    itemType: token === ethers.ZeroAddress ? ItemType.NATIVE : ItemType.ERC20,
    token,
    identifierOrCriteria: "0",
    startAmount: multiplyBasisPoints(baseAmount, fee.basisPoints).toString(),
    endAmount: multiplyBasisPoints(baseEndAmount, fee.basisPoints).toString(),
    recipient: fee.recipient,
  }
}

export const deductFees = <T extends Item>(
  items: T[],
  fees?: readonly Fee[],
): T[] => {
  if (!fees) {
    return items
  }

  for (const { basisPoints } of fees) {
    if (
      !Number.isSafeInteger(basisPoints) ||
      basisPoints < 0 ||
      basisPoints > Number(ONE_HUNDRED_PERCENT_BP)
    ) {
      throw new Error(
        `Fee basisPoints (${basisPoints}) must be a safe integer between 0 and ${ONE_HUNDRED_PERCENT_BP} (100%).`,
      )
    }
  }

  const totalBasisPoints = fees.reduce(
    (accBasisPoints, fee) => accBasisPoints + fee.basisPoints,
    0,
  )

  // Fees are deducted from the order's currency consideration items. A total
  // above 100% (ONE_HUNDRED_PERCENT_BP) would deduct more than the item amount,
  // producing a negative consideration amount and a malformed order that later
  // reverts opaquely at ABI-encode time, so surface a clear error here instead.
  if (totalBasisPoints > Number(ONE_HUNDRED_PERCENT_BP)) {
    throw new Error(
      `Total fee basisPoints (${totalBasisPoints}) cannot exceed ${ONE_HUNDRED_PERCENT_BP} (100%). ` +
        "Fees are deducted from the order's consideration items, so a higher total would produce negative item amounts.",
    )
  }

  return items.map(item => ({
    ...item,
    startAmount: isCurrencyItem(item)
      ? (
          BigInt(item.startAmount) -
          multiplyBasisPoints(item.startAmount, totalBasisPoints)
        ).toString()
      : item.startAmount,
    endAmount: isCurrencyItem(item)
      ? (
          BigInt(item.endAmount) -
          multiplyBasisPoints(item.endAmount, totalBasisPoints)
        ).toString()
      : item.endAmount,
  }))
}

export const mapInputItemToOfferItem = (item: CreateInputItem): OfferItem => {
  if ("itemType" in item) {
    // Convert this to a criteria based item
    if ("identifiers" in item || "criteria" in item) {
      const root =
        "criteria" in item
          ? item.criteria
          : new MerkleTree(item.identifiers).getRoot()

      return {
        itemType:
          item.itemType === ItemType.ERC721
            ? ItemType.ERC721_WITH_CRITERIA
            : ItemType.ERC1155_WITH_CRITERIA,
        token: item.token,
        identifierOrCriteria: root,
        startAmount: item.amount ?? "1",
        endAmount: item.endAmount ?? item.amount ?? "1",
      }
    }

    if ("amount" in item || "endAmount" in item) {
      return {
        itemType: item.itemType,
        token: item.token,
        // prevent undefined for fungible items
        identifierOrCriteria: item.identifier ?? "0",
        // @ts-expect-error - amount exists on fungible items
        startAmount: item.amount,
        // @ts-expect-error - amount/endAmount exists on fungible items
        endAmount: item.endAmount ?? item.amount ?? "1",
      }
    }

    return {
      itemType: item.itemType,
      token: item.token,
      identifierOrCriteria: item.identifier,
      startAmount: "1",
      endAmount: "1",
    }
  }

  // Item is a currency
  return {
    itemType:
      item.token && item.token !== ethers.ZeroAddress
        ? ItemType.ERC20
        : ItemType.NATIVE,
    token: item.token ?? ethers.ZeroAddress,
    identifierOrCriteria: "0",
    startAmount: item.amount,
    endAmount: item.endAmount ?? item.amount,
  }
}

export const areAllCurrenciesSame = ({
  offer,
  consideration,
}: Pick<OrderParameters, "offer" | "consideration">) => {
  const allItems = [...offer, ...consideration]
  const currencies = allItems.filter(isCurrencyItem)

  return currencies.every(
    ({ itemType, token }) =>
      itemType === currencies[0].itemType &&
      token.toLowerCase() === currencies[0].token.toLowerCase(),
  )
}

export const totalItemsAmount = <T extends OfferItem>(items: T[]) => {
  return items
    .map(({ startAmount, endAmount }) => ({
      startAmount,
      endAmount,
    }))
    .reduce<{ startAmount: bigint; endAmount: bigint }>(
      (
        { startAmount: totalStartAmount, endAmount: totalEndAmount },
        { startAmount, endAmount },
      ) => ({
        startAmount: totalStartAmount + BigInt(startAmount),
        endAmount: totalEndAmount + BigInt(endAmount),
      }),
      {
        startAmount: 0n,
        endAmount: 0n,
      },
    )
}

/**
 * Maps order offer and consideration item amounts based on the order's filled status
 * After applying the fraction, we can view this order as the "canonical" order for which we
 * check approvals and balances
 */
export const mapOrderAmountsFromFilledStatus = (
  order: Order,
  { totalFilled, totalSize }: { totalFilled: bigint; totalSize: bigint },
): Order => {
  if (totalFilled === 0n || totalSize === 0n) {
    return order
  }

  // i.e if totalFilled is 3 and totalSize is 4, there are 1 / 4 order amounts left to fill.
  const basisPoints =
    ((totalSize - totalFilled) * ONE_HUNDRED_PERCENT_BP) / totalSize

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map(item => ({
        ...item,
        startAmount: multiplyBasisPoints(
          item.startAmount,
          basisPoints,
        ).toString(),
        endAmount: multiplyBasisPoints(item.endAmount, basisPoints).toString(),
      })),
      consideration: order.parameters.consideration.map(item => ({
        ...item,
        startAmount: multiplyBasisPoints(
          item.startAmount,
          basisPoints,
        ).toString(),
        endAmount: multiplyBasisPoints(item.endAmount, basisPoints).toString(),
      })),
    },
    signature: order.signature,
  }
}

const multiplyDivision = (
  amount: BigNumberish,
  numerator: BigNumberish,
  denominator: BigNumberish,
) => (BigInt(amount) * BigInt(numerator)) / BigInt(denominator)

/**
 * Maps order offer and consideration item amounts based on the units needed to fulfill
 * After applying the fraction, we can view this order as the "canonical" order for which we
 * check approvals and balances
 * Returns the numerator and denominator as well, converting this to an AdvancedOrder
 */
export const mapOrderAmountsFromUnitsToFill = (
  order: Order,
  { unitsToFill, totalSize }: { unitsToFill: BigNumberish; totalSize: bigint },
): Order => {
  const unitsToFillBn = BigInt(unitsToFill)

  if (unitsToFillBn <= 0n) {
    throw new Error("Units to fill must be greater than 0")
  }

  const maxUnits = getMaximumSizeForOrder(order)

  if (totalSize === 0n) {
    totalSize = maxUnits
  }

  return {
    parameters: {
      ...order.parameters,
      offer: order.parameters.offer.map(item => ({
        ...item,
        startAmount: multiplyDivision(
          item.startAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
        endAmount: multiplyDivision(
          item.endAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
      })),
      consideration: order.parameters.consideration.map(item => ({
        ...item,
        startAmount: multiplyDivision(
          item.startAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
        endAmount: multiplyDivision(
          item.endAmount,
          unitsToFillBn,
          totalSize,
        ).toString(),
      })),
    },
    signature: order.signature,
  }
}

export function mapTipAmountsFromUnitsToFill(
  tips: ConsiderationItem[],
  unitsToFill: BigNumberish,
  totalSize: bigint,
): ConsiderationItem[] {
  const unitsToFillBn = BigInt(unitsToFill)

  if (unitsToFillBn <= 0n) {
    throw new Error("Units to fill must be greater than 0")
  }

  return tips.map(tip => ({
    ...tip,
    startAmount: multiplyDivision(
      tip.startAmount,
      unitsToFillBn,
      totalSize,
    ).toString(),
    endAmount: multiplyDivision(
      tip.endAmount,
      unitsToFillBn,
      totalSize,
    ).toString(),
  }))
}

export function mapTipAmountsFromFilledStatus(
  tips: ConsiderationItem[],
  totalFilled: bigint,
  totalSize: bigint,
): ConsiderationItem[] {
  if (totalFilled === 0n || totalSize === 0n) {
    return tips
  }

  // i.e if totalFilled is 3 and totalSize is 4, there are 1 / 4 order amounts left to fill.
  const basisPoints =
    ((totalSize - totalFilled) * ONE_HUNDRED_PERCENT_BP) / totalSize

  return tips.map(tip => ({
    ...tip,
    startAmount: multiplyBasisPoints(tip.startAmount, basisPoints).toString(),
    endAmount: multiplyBasisPoints(tip.endAmount, basisPoints).toString(),
  }))
}

export const generateRandomSalt = (domain?: string) => {
  if (domain) {
    // Width the hex to a full 32 bytes. `concat` already produces 32 bytes, but
    // an unwidthed `toBeHex` re-encodes the value as a number and drops leading
    // zero bytes, so a domain whose hash starts with 0x00 -- roughly one in 256
    // -- would yield a 31-byte salt whose first four bytes read as the tag
    // shifted a byte left, leaving the domain unrecoverable from the salt.
    return toBeHex(
      concat([
        keccak256(toUtf8Bytes(domain)).slice(0, 10),
        Uint8Array.from(Array(20).fill(0)),
        randomBytes(8),
      ]),
      32,
    )
  }
  // `Buffer` is a Node global that browser bundlers do not polyfill by default,
  // and this branch is on the hot path: opensea-sdk calls generateRandomSalt()
  // with no domain when it builds a private-listing counter order. Build the
  // same 24 zero bytes plus 8 random bytes out of ethers primitives instead.
  return hexlify(concat([new Uint8Array(24), randomBytes(8)]))
}

export const shouldUseMatchForFulfill = () => true
