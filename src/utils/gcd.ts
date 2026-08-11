import type { BigNumberish } from "ethers"

export const gcd = (a: BigNumberish, b: BigNumberish): bigint => {
  let bnA = BigInt(a)
  let bnB = BigInt(b)

  bnA = bnA < 0n ? -bnA : bnA
  bnB = bnB < 0n ? -bnB : bnB

  if (bnA === 0n) {
    return bnB
  }

  return gcd(bnB % bnA, bnA)
}

export const findGcd = (elements: BigNumberish[]): bigint => {
  if (elements.length === 0) {
    return 0n
  }

  let result = BigInt(elements[0])
  result = result < 0n ? -result : result

  for (let i = 1; i < elements.length; i++) {
    result = gcd(elements[i], result)

    if (result === 1n) {
      return result
    }
  }

  return result
}
