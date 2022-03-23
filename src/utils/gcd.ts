import { BigNumber, BigNumberish } from "ethers";

export const gcd = (a: BigNumberish, b: BigNumberish): BigNumber => {
  const bnA = BigNumber.from(a);
  const bnB = BigNumber.from(b);

  if (bnA.eq(0)) {
    return bnB;
  }

  return gcd(bnB.mod(a), bnA);
};

export const findGcd = (elements: BigNumberish[]) => {
  let result = BigNumber.from(elements[0]);

  for (let i = 1; i < elements.length; i++) {
    result = gcd(elements[i], result);

    if (result.eq(1)) {
      return result;
    }
  }

  return result;
};
