import { BigNumberish } from "ethers";

export const gcd = (a: BigNumberish, b: BigNumberish): bigint => {
  const bnA = BigInt(a);
  const bnB = BigInt(b);

  if (bnA === 0n) {
    return bnB;
  }

  return gcd(bnB % bnA, bnA);
};

export const findGcd = (elements: BigNumberish[]) => {
  let result = BigInt(elements[0]);

  for (let i = 1; i < elements.length; i++) {
    result = gcd(elements[i], result);

    if (result === 1n) {
      return result;
    }
  }

  return result;
};
