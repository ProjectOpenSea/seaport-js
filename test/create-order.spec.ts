import { expect } from "chai";
import { parseEther } from "ethers";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, NO_CONDUIT, OrderType } from "../src/constants";
import {
  ApprovalAction,
  CreateOrderAction,
  CreateOrderInput,
} from "../src/types";
import { generateRandomSalt } from "../src/utils/order";
import { describeWithFixture } from "./utils/setup";
import { OPENSEA_DOMAIN, OPENSEA_DOMAIN_TAG } from "./utils/constants";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: await testErc721.getAddress(),
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: await seaportContract.getAddress(),
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.true;

    const createOrderAction = actions[1] as CreateOrderAction;
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    expect(order).to.deep.equal({
      parameters: {
        consideration: [
          {
            // Fees were deducted
            endAmount: ethers.parseEther("9.75").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: await offerer.getAddress(),
            startAmount: ethers.parseEther("9.75").toString(),
            token: ethers.ZeroAddress,
          },
          {
            endAmount: ethers.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: await zone.getAddress(),
            startAmount: ethers.parseEther(".25").toString(),
            token: ethers.ZeroAddress,
          },
        ],
        endTime,
        offer: [
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            startAmount: "1",
            token: await testErc721.getAddress(),
          },
        ],
        offerer: await offerer.getAddress(),
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.ZeroAddress,
        zoneHash: ethers.ZeroHash,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .validate.staticCall([
        {
          parameters: {
            ...order.parameters,
            totalOriginalConsiderationItems:
              order.parameters.consideration.length,
          },
          signature: order.signature,
        },
      ]);

    expect(isValid).to.be.true;
  });

  it("should create an order that offers ERC20 for ERC721", async () => {
    const { seaportContract, seaport, testErc20, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc20.mint(
      await offerer.getAddress(),
      parseEther("10").toString(),
    );
    await testErc721.mint(await randomSigner.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          token: await testErc20.getAddress(),
          amount: parseEther("10").toString(),
        },
      ],
      consideration: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: await testErc20.getAddress(),
      identifierOrCriteria: "0",
      itemType: ItemType.ERC20,
      transactionMethods: approvalAction.transactionMethods,
      operator: await seaportContract.getAddress(),
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc20.allowance(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.equal(MAX_INT);

    const createOrderAction = actions[1] as CreateOrderAction;
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    expect(order).to.deep.equal({
      parameters: {
        consideration: [
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            startAmount: "1",
            token: await testErc721.getAddress(),
            recipient: await offerer.getAddress(),
          },
          {
            endAmount: ethers.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            recipient: await zone.getAddress(),
            startAmount: ethers.parseEther(".25").toString(),
            token: await testErc20.getAddress(),
          },
        ],
        endTime,
        offer: [
          {
            // Fees were deducted
            endAmount: ethers.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            startAmount: ethers.parseEther("10").toString(),
            token: await testErc20.getAddress(),
          },
        ],
        offerer: await offerer.getAddress(),
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.ZeroAddress,
        zoneHash: ethers.ZeroHash,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .validate.staticCall([
        {
          parameters: {
            ...order.parameters,
            totalOriginalConsiderationItems:
              order.parameters.consideration.length,
          },
          signature: order.signature,
        },
      ]);

    expect(isValid).to.be.true;
  });

  it("should create an order with multiple item types after setting needed approvals", async () => {
    const { seaportContract, seaport, testErc721, testErc1155 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    await testErc1155.mint(await offerer.getAddress(), nftId, 1);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
        {
          itemType: ItemType.ERC1155,
          token: await testErc1155.getAddress(),
          identifier: nftId,
          amount: "1",
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    expect(
      await testErc721.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.false;
    expect(
      await testErc1155.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.false;

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: await testErc721.getAddress(),
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: await seaportContract.getAddress(),
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.true;

    const erc1155ApprovalAction = actions[1] as ApprovalAction;

    expect(erc1155ApprovalAction).to.be.deep.equal({
      type: "approval",
      token: await testErc1155.getAddress(),
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC1155,
      transactionMethods: erc1155ApprovalAction.transactionMethods,
      operator: await seaportContract.getAddress(),
    });

    await erc1155ApprovalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc1155.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.true;

    const createOrderAction = actions[2] as CreateOrderAction;
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    expect(order).to.deep.equal({
      parameters: {
        consideration: [
          {
            // Fees were deducted
            endAmount: ethers.parseEther("9.75").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: await offerer.getAddress(),
            startAmount: ethers.parseEther("9.75").toString(),
            token: ethers.ZeroAddress,
          },
          {
            endAmount: ethers.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: await zone.getAddress(),
            startAmount: ethers.parseEther(".25").toString(),
            token: ethers.ZeroAddress,
          },
        ],
        endTime,
        offer: [
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            startAmount: "1",
            token: await testErc721.getAddress(),
          },
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            startAmount: "1",
            token: await testErc1155.getAddress(),
          },
        ],
        offerer: await offerer.getAddress(),
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.ZeroAddress,
        zoneHash: ethers.ZeroHash,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .validate.staticCall([
        {
          parameters: {
            ...order.parameters,
            totalOriginalConsiderationItems:
              order.parameters.consideration.length,
          },
          signature: order.signature,
        },
      ]);

    expect(isValid).to.be.true;
  });

  describe("check validations", () => {
    it("throws if currencies are different when applying fees", async () => {
      const { seaport, testErc721, testErc20 } = fixture;

      const [offerer, zone] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(await offerer.getAddress(), nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      await testErc20.mint(await offerer.getAddress(), 1);

      const input: CreateOrderInput = {
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.parseEther("10").toString(),
            recipient: await offerer.getAddress(),
          },
          {
            token: await testErc20.getAddress(),
            amount: ethers.parseEther("1").toString(),
            recipient: await zone.getAddress(),
          },
        ],
        fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
      };

      await expect(seaport.createOrder(input)).to.be.rejectedWith(
        "All currency tokens in the order must be the same token when applying fees",
      );

      delete input.fees;

      await expect(seaport.createOrder(input)).to.be.not.rejectedWith(
        "All currency tokens in the order must be the same token when applying fees",
      );
    });

    it("throws if offerer does not have sufficient balances", async () => {
      const { seaport, testErc721, testErc20 } = fixture;

      const [offerer, zone] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(await zone.getAddress(), nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();

      const createOrderInput = {
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.parseEther("10").toString(),
            recipient: await offerer.getAddress(),
          },
        ],
        fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
      } as const;

      await expect(seaport.createOrder(createOrderInput)).to.be.rejectedWith(
        "The offerer does not have the amount needed to create or fulfill.",
      );

      await testErc721
        .connect(zone)
        .transferFrom(
          await zone.getAddress(),
          await offerer.getAddress(),
          nftId,
        );

      // It should not throw now as the offerer has sufficient balance
      await seaport.createOrder(createOrderInput);

      // Now it should as the offerer does not have any ERC20
      await expect(
        seaport.createOrder({
          ...createOrderInput,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
            {
              token: await testErc20.getAddress(),
              amount: "1",
            },
          ],
          consideration: [
            {
              token: await testErc20.getAddress(),
              amount: ethers.parseEther("10").toString(),
              recipient: await offerer.getAddress(),
            },
          ],
        }),
      ).to.be.rejectedWith(
        "The offerer does not have the amount needed to create or fulfill.",
      );
    });

    it("skips balance and approval validation if consideration config is set to skip on order creation", async () => {
      const { seaport, seaportContract, testErc721 } = fixture;

      (seaport as any).config.balanceAndApprovalChecksOnOrderCreation = false;

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      await testErc721.mint(await randomSigner.getAddress(), nftId);

      const { actions } = await seaport.createOrder({
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: await testErc721.getAddress(),
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.parseEther("10").toString(),
            recipient: await offerer.getAddress(),
          },
        ],
        // 2.5% fee
        fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
      });

      const createOrderAction = actions[0] as CreateOrderAction;

      const order = await createOrderAction.createOrder();

      expect(createOrderAction.type).to.equal("create");
      expect(order).to.deep.equal({
        parameters: {
          consideration: [
            {
              endAmount: ethers.parseEther("9.75").toString(),
              identifierOrCriteria: "0",
              itemType: ItemType.NATIVE,
              recipient: await offerer.getAddress(),
              startAmount: ethers.parseEther("9.75").toString(),
              token: ethers.ZeroAddress,
            },
            {
              endAmount: ethers.parseEther(".25").toString(),
              identifierOrCriteria: "0",
              itemType: ItemType.NATIVE,
              recipient: await zone.getAddress(),
              startAmount: ethers.parseEther(".25").toString(),
              token: ethers.ZeroAddress,
            },
          ],
          endTime,
          offer: [
            {
              endAmount: "1",
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721,
              startAmount: "1",
              token: await testErc721.getAddress(),
            },
          ],
          offerer: await offerer.getAddress(),
          orderType: OrderType.FULL_OPEN,
          salt,
          startTime,
          totalOriginalConsiderationItems: 2,
          zone: ethers.ZeroAddress,
          zoneHash: ethers.ZeroHash,
          conduitKey: NO_CONDUIT,
          counter: "0",
        },
        signature: order.signature,
      });

      const isValid = await seaportContract
        .connect(randomSigner)
        .validate.staticCall([
          {
            parameters: {
              ...order.parameters,
              totalOriginalConsiderationItems:
                order.parameters.consideration.length,
            },
            signature: order.signature,
          },
        ]);

      expect(isValid).to.be.true;
    });
  });

  it("returns a valid message to sign", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: await testErc721.getAddress(),
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: await seaportContract.getAddress(),
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        await offerer.getAddress(),
        await seaportContract.getAddress(),
      ),
    ).to.be.true;

    const createOrderAction = actions[1] as CreateOrderAction;
    const messageToSign = await createOrderAction.getMessageToSign();
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    const rawSignTypedMessage = await ethers.provider.send(
      "eth_signTypedData_v4",
      [await offerer.getAddress(), messageToSign],
    );
    expect(ethers.Signature.from(rawSignTypedMessage).compact).eq(
      order.signature,
    );

    const isValid = await seaportContract
      .connect(randomSigner)
      .validate.staticCall([
        {
          parameters: {
            ...order.parameters,
            totalOriginalConsiderationItems:
              order.parameters.consideration.length,
          },
          signature: rawSignTypedMessage,
        },
      ]);

    expect(isValid).to.be.true;
  });

  it("should have the same order hash as on the contract", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters,
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
  });

  it("should create an order with a salt including a hash of the supplied domain", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const domain = "opensea.io";
    const openseaMagicValue = "0x360c6ebe";

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      domain,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters,
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt.slice(0, 10)).eq(openseaMagicValue);
  });

  it("should create an order with a salt with the first four bytes being empty if no domain is given", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters,
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt.slice(0, 10)).eq("0x00000000");
  });

  it("should create an order with the passed in salt", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = "0xabcd";

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters,
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt).eq(`0x${"0".repeat(60)}abcd`);
  });

  it("should create an order with the passed in zone and zoneHash", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, recipient] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(await offerer.getAddress(), nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const zone = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const zoneHash = ethers.keccak256("0xf00b");
    const salt = "0xabcd";

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      zone,
      zoneHash,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: await testErc721.getAddress(),
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.parseEther("10").toString(),
          recipient: await offerer.getAddress(),
        },
      ],
      // 2.5% fee
      fees: [{ recipient: await recipient.getAddress(), basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters,
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.zone).eq(zone);
    expect(order.parameters.zoneHash).eq(zoneHash);
  });
});

describeWithFixture(
  "As a user I want to create and fulfill an order using contract wallet",
  (fixture) => {
    it("should create the order after setting needed approvals and then fulfill", async () => {
      const {
        seaportContract,
        seaport,
        seaportWithSigner,
        testErc721,
        testERC1271Wallet,
        testErc20,
      } = fixture;
      const [orderSigner, zone, nftOwner] = await ethers.getSigners();
      expect(await testERC1271Wallet.orderSigner()).to.equal(
        await orderSigner.getAddress(),
      );
      const nftId = "1";
      await testErc721.mint(await nftOwner.getAddress(), nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      // Mint 10 tokens to the wallet contract
      await testErc20.mint(
        await testERC1271Wallet.getAddress(),
        parseEther("10"),
      );
      // Give allowance to the seaport contract
      await testERC1271Wallet.approveToken(
        await testErc20.getAddress(),
        await seaportContract.getAddress(),
        parseEther("10"),
      );

      const accountAddress = await testERC1271Wallet.getAddress();
      const orderUsaCase = await seaportWithSigner.createOrder(
        {
          startTime,
          endTime,
          salt,
          offer: [
            {
              amount: ethers.parseEther("10").toString(),
              token: await testErc20.getAddress(),
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: await testErc721.getAddress(),
              identifier: nftId,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
        },
        accountAddress,
      );

      const offerActions = orderUsaCase.actions;
      expect(offerActions).to.have.lengthOf(1);

      const createOrderAction = offerActions[0] as CreateOrderAction;
      expect(createOrderAction.type).to.equal("create");

      const order = await orderUsaCase.executeAllActions();

      const fulfillUsaCase = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order }],
        accountAddress: await nftOwner.getAddress(),
        domain: OPENSEA_DOMAIN,
      });

      const fulfillActions = fulfillUsaCase.actions;

      const fulfillAction1 = fulfillActions[0];
      await fulfillAction1.transactionMethods.transact();
      const fulfillAction2 = fulfillActions[1];
      await fulfillAction2.transactionMethods.transact();

      const exchange = fulfillActions[2];
      expect(exchange.type).to.equal("exchange");

      const exchangeTransaction =
        await exchange.transactionMethods.buildTransaction();
      expect(exchangeTransaction.data?.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

      const transaction = await exchange.transactionMethods.transact();
      expect(transaction.data.slice(-8)).to.eq(OPENSEA_DOMAIN_TAG);

      expect(await testErc721.ownerOf(nftId)).to.equal(
        await testERC1271Wallet.getAddress(),
      );
      expect(await testErc20.balanceOf(await nftOwner.getAddress())).to.equal(
        ethers.parseEther("9.75"),
      );
    });
  },
);
