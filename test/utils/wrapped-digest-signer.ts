import {
  type Provider,
  type TypedDataDomain,
  TypedDataEncoder,
  type TypedDataField,
  Wallet,
} from "ethers"

/**
 * A signer standing in for a contract wallet's owner key.
 *
 * A contract wallet does not sign the EIP-712 digest itself. Its owner signs a
 * hash the wallet derives from that digest, and the result is still a plain
 * 65 byte r, s, v signature, so it looks like an EOA signature by length alone
 * even though it does not recover to the offerer. `transform` lets a test
 * produce the other shapes such a wallet can return, like a Safe eth_sign
 * signature whose v is 31 or 32.
 */
export class WrappedDigestSigner extends Wallet {
  lastSignature?: string

  constructor(
    privateKey: string,
    provider: Provider | null,
    private readonly wrapDigest: (digest: string) => string,
    private readonly transform: (signature: string) => string = signature =>
      signature,
  ) {
    super(privateKey, provider)
  }

  override async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    const digest = TypedDataEncoder.hash(domain, types, value)
    this.lastSignature = this.transform(
      this.signingKey.sign(this.wrapDigest(digest)).serialized,
    )
    return this.lastSignature
  }
}
