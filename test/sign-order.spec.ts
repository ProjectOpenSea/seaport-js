import { expect } from "chai"
import {
  AbiCoder,
  concat,
  dataLength,
  keccak256,
  parseEther,
  Wallet,
  ZeroAddress,
  ZeroHash,
} from "ethers"
import { ItemType, MAX_INT, NO_CONDUIT, OrderType } from "../src/constants"
import { Seaport } from "../src/seaport"
import type {
  ConsiderationItem,
  CreateOrderInput,
  OfferItem,
  OrderComponents,
} from "../src/types"
import { generateRandomSalt } from "../src/utils/order"
import { describeWithFixture } from "./utils/setup"
import { WrappedDigestSigner } from "./utils/wrapped-digest-signer"

describeWithFixture("As a user I want to sign an order", fixture => {
  it("should be a valid order", async () => {
    const { seaportContract, seaport, testErc721, ethers } = fixture
    const [offerer, zone, randomSigner] = await ethers.getSigners()

    const startTime = 0
    const endTime = MAX_INT
    const salt = generateRandomSalt()
    const nftId = "0"

    const offer: OfferItem[] = [
      {
        itemType: ItemType.ERC721,
        token: await testErc721.getAddress(),
        identifierOrCriteria: nftId,
        startAmount: "1",
        endAmount: "1",
      },
    ]

    const considerationData: ConsiderationItem[] = [
      {
        itemType: ItemType.NATIVE,
        token: ZeroAddress,
        startAmount: parseEther("10").toString(),
        endAmount: parseEther("10").toString(),
        recipient: await offerer.getAddress(),
        identifierOrCriteria: "0",
      },
      {
        itemType: ItemType.NATIVE,
        token: ZeroAddress,
        startAmount: parseEther("1").toString(),
        endAmount: parseEther("1").toString(),
        recipient: await zone.getAddress(),
        identifierOrCriteria: "0",
      },
    ]

    const counter = await seaportContract.getCounter(await offerer.getAddress())

    const orderComponents = {
      offerer: await offerer.getAddress(),
      zone: ZeroAddress,
      offer,
      consideration: considerationData,
      orderType: OrderType.FULL_OPEN,
      totalOriginalConsiderationItems: considerationData.length,
      salt,
      startTime,
      endTime,
      zoneHash: ZeroHash,
      conduitKey: NO_CONDUIT,
      counter,
    }

    const signature = await seaport.signOrder(orderComponents)

    const order = {
      parameters: {
        ...orderComponents,
        totalOriginalConsiderationItems: orderComponents.consideration.length,
      },
      signature,
    }

    // Use a random address to verify that the signature is valid
    const isValid = await seaportContract
      .connect(randomSigner)
      .validate.staticCall([order])

    expect(isValid).to.be.true
  })
})

describeWithFixture(
  "As a contract wallet I want my signature kept as my wallet produced it",
  fixture => {
    const orderComponentsFor = async (
      offerer: string,
    ): Promise<OrderComponents> => {
      const { seaportContract, testErc721 } = fixture

      return {
        offerer,
        zone: ZeroAddress,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifierOrCriteria: "0",
            startAmount: "1",
            endAmount: "1",
          },
        ],
        consideration: [
          {
            itemType: ItemType.NATIVE,
            token: ZeroAddress,
            identifierOrCriteria: "0",
            startAmount: parseEther("10").toString(),
            endAmount: parseEther("10").toString(),
            recipient: offerer,
          },
        ],
        orderType: OrderType.FULL_OPEN,
        totalOriginalConsiderationItems: 1,
        salt: generateRandomSalt(),
        startTime: "0",
        endTime: MAX_INT.toString(),
        zoneHash: ZeroHash,
        conduitKey: NO_CONDUIT,
        counter: (await seaportContract.getCounter(offerer)).toString(),
      }
    }

    const seaportSigningWith = async (signer: WrappedDigestSigner) =>
      new Seaport(signer as any, {
        overrides: {
          contractAddress: await fixture.seaportContract.getAddress(),
        },
      })

    // Any wallet-specific hash will do: what matters is that the owner did not
    // sign the order digest itself, so the signature does not recover to the
    // offerer.
    const wrapDigest = (digest: string) => keccak256(digest)

    it("leaves a 65 byte signature that is not the offerer's ECDSA signature untouched", async () => {
      const { ethers } = fixture
      const offerer = Wallet.createRandom().address
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
      )

      const signature = await (await seaportSigningWith(signer)).signOrder(
        await orderComponentsFor(offerer),
      )

      expect(dataLength(signature)).to.eq(65)
      expect(signature).to.eq(signer.lastSignature)
    })

    it("returns a signature whose v the ECDSA path does not use instead of throwing", async () => {
      const { ethers } = fixture
      const offerer = Wallet.createRandom().address
      // A Safe eth_sign owner signature carries v + 4, so 31 or 32.
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
        signature => `${signature.slice(0, -2)}1f`,
      )

      const signature = await (await seaportSigningWith(signer)).signOrder(
        await orderComponentsFor(offerer),
      )

      expect(signature).to.eq(signer.lastSignature)
      expect(signature.slice(-2)).to.eq("1f")
    })

    it("leaves a signature longer than 65 bytes untouched, as before", async () => {
      const { ethers } = fixture
      const offerer = Wallet.createRandom().address
      // A multi-owner Safe concatenates one 65 byte signature per owner (#323).
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
        signature => `${signature}${signature.slice(2)}`,
      )

      const signature = await (await seaportSigningWith(signer)).signOrder(
        await orderComponentsFor(offerer),
      )

      expect(dataLength(signature)).to.eq(130)
      expect(signature).to.eq(signer.lastSignature)
    })

    it("leaves a contract wallet's bulk signature untouched", async () => {
      const { ethers } = fixture
      const offerer = Wallet.createRandom().address
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
      )

      const orders = await (await seaportSigningWith(signer)).signBulkOrder([
        await orderComponentsFor(offerer),
        await orderComponentsFor(offerer),
      ])

      // Two orders make a tree of height 1: signature, 3 byte key, one proof
      // element. 65 + 3 + 32 when the signature is kept as produced.
      for (const order of orders) {
        expect(dataLength(order.signature)).to.eq(100)
        expect(order.signature.startsWith(signer.lastSignature ?? "")).to.be
          .true
      }
    })

    it("still compacts the offerer's own ECDSA signature", async () => {
      const { ethers } = fixture
      const owner = Wallet.createRandom()
      // Signs the order digest directly, as an EOA does.
      const signer = new WrappedDigestSigner(
        owner.privateKey,
        ethers.provider as any,
        digest => digest,
      )

      const seaport = await seaportSigningWith(signer)
      const signature = await seaport.signOrder(
        await orderComponentsFor(owner.address),
      )
      const [bulkOrder] = await seaport.signBulkOrder([
        await orderComponentsFor(owner.address),
        await orderComponentsFor(owner.address),
      ])

      expect(dataLength(signature)).to.eq(64)
      // 64 + 3 + 32: the compact signature, the key, one proof element.
      expect(dataLength(bulkOrder.signature)).to.eq(99)
    })

    it("rejects a bulk signature longer than 65 bytes instead of returning orders Seaport cannot verify", async () => {
      const { ethers } = fixture
      const offerer = Wallet.createRandom().address
      // A multi-owner Safe concatenates one 65 byte signature per owner (#323).
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
        signature => `${signature}${signature.slice(2)}`,
      )

      await expect(
        (await seaportSigningWith(signer)).signBulkOrder([
          await orderComponentsFor(offerer),
          await orderComponentsFor(offerer),
        ]),
      ).to.be.rejectedWith(
        "Seaport only reads a 64 or 65 byte signature as a bulk order signature, but the signer returned 130 bytes",
      )
    })

    it("rejects the same signature when the bulk orders come from createBulkOrders", async () => {
      const { seaportContract, testErc721, ethers } = fixture
      const signer = new WrappedDigestSigner(
        Wallet.createRandom().privateKey,
        ethers.provider as any,
        wrapDigest,
        signature => `${signature}${signature.slice(2)}`,
      )
      const seaport = new Seaport(signer as any, {
        balanceAndApprovalChecksOnOrderCreation: false,
        overrides: { contractAddress: await seaportContract.getAddress() },
      })
      const input: CreateOrderInput = {
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: "1",
          },
        ],
        consideration: [
          { amount: parseEther("1").toString(), recipient: signer.address },
        ],
      }

      const { executeAllActions } = await seaport.createBulkOrders([
        input,
        input,
      ])

      await expect(executeAllActions()).to.be.rejectedWith(
        "Seaport only reads a 64 or 65 byte signature as a bulk order signature, but the signer returned 130 bytes",
      )
    })

    it("fills a two owner wallet's 130 byte signature as a single order and rejects it as a bulk order", async () => {
      const { seaport, seaportContract, testErc20, testErc721, ethers } =
        fixture
      const [, , nftOwner] = await ethers.getSigners()

      const firstOwner = Wallet.createRandom()
      const secondOwner = Wallet.createRandom()
      const TestERC1271TwoOwnerWallet = await ethers.getContractFactory(
        "TestERC1271TwoOwnerWallet",
      )
      const wallet = await TestERC1271TwoOwnerWallet.deploy(
        firstOwner.address,
        secondOwner.address,
      )
      await wallet.waitForDeployment()
      const walletAddress = await wallet.getAddress()

      // Both owners sign the wallet's own hash of the digest, as the owners of
      // a 2-of-2 Safe do, so the wallet's signature is 130 bytes.
      const signer = new WrappedDigestSigner(
        firstOwner.privateKey,
        ethers.provider as any,
        digest =>
          keccak256(
            AbiCoder.defaultAbiCoder().encode(
              ["address", "bytes32"],
              [walletAddress, digest],
            ),
          ),
        (signature, wrappedDigest) =>
          concat([
            signature,
            secondOwner.signingKey.sign(wrappedDigest).serialized,
          ]),
      )
      const walletSeaport = await seaportSigningWith(signer)

      await testErc20.mint(walletAddress, parseEther("10"))
      await wallet.approveToken(
        await testErc20.getAddress(),
        await seaportContract.getAddress(),
        parseEther("10"),
      )

      // The wallet bids 10 ERC20 for an NFT.
      const bidFor = async (nftId: string): Promise<OrderComponents> => ({
        offerer: walletAddress,
        zone: ZeroAddress,
        offer: [
          {
            itemType: ItemType.ERC20,
            token: await testErc20.getAddress(),
            identifierOrCriteria: "0",
            startAmount: parseEther("10").toString(),
            endAmount: parseEther("10").toString(),
          },
        ],
        consideration: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifierOrCriteria: nftId,
            startAmount: "1",
            endAmount: "1",
            recipient: walletAddress,
          },
        ],
        orderType: OrderType.FULL_OPEN,
        totalOriginalConsiderationItems: 1,
        salt: generateRandomSalt(),
        startTime: "0",
        endTime: MAX_INT.toString(),
        zoneHash: ZeroHash,
        conduitKey: NO_CONDUIT,
        counter: (await seaportContract.getCounter(walletAddress)).toString(),
      })

      const nftId = "1"
      await testErc721.mint(await nftOwner.getAddress(), nftId)
      const parameters = await bidFor(nftId)
      const signature = await walletSeaport.signOrder(parameters)
      expect(dataLength(signature)).to.eq(130)

      const { executeAllActions } = await seaport.fulfillOrder({
        order: { parameters, signature },
        accountAddress: await nftOwner.getAddress(),
      })
      await (await executeAllActions()).wait()
      expect(await testErc721.ownerOf(nftId)).to.equal(walletAddress)

      await expect(
        walletSeaport.signBulkOrder([await bidFor("2"), await bidFor("3")]),
      ).to.be.rejectedWith(
        "Seaport only reads a 64 or 65 byte signature as a bulk order signature, but the signer returned 130 bytes",
      )
    })
  },
)
