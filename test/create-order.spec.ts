import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, NO_CONDUIT, OrderType } from "../src/constants";
import {
  ApprovalAction,
  CreateOrderAction,
  CreateOrderInput,
} from "../src/types";
import { generateRandomSalt } from "../src/utils/order";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
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
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: seaportContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.true;

    const createOrderAction = actions[1] as CreateOrderAction;
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    expect(order).to.deep.equal({
      parameters: {
        consideration: [
          {
            // Fees were deducted
            endAmount: ethers.utils.parseEther("9.75").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("9.75").toString(),
            token: ethers.constants.AddressZero,
          },
          {
            endAmount: ethers.utils.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: zone.address,
            startAmount: ethers.utils.parseEther(".25").toString(),
            token: ethers.constants.AddressZero,
          },
        ],
        endTime,
        offer: [
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            startAmount: "1",
            token: testErc721.address,
          },
        ],
        offerer: offerer.address,
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.constants.AddressZero,
        zoneHash: ethers.constants.HashZero,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .callStatic.validate([
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
    await testErc20.mint(offerer.address, parseEther("10").toString());
    await testErc721.mint(randomSigner.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await seaport.createOrder({
      startTime,
      endTime,
      salt,
      offer: [
        {
          token: testErc20.address,
          amount: parseEther("10").toString(),
        },
      ],
      consideration: [
        {
          itemType: ItemType.ERC721,
          token: testErc721.address,
          identifier: nftId,
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: testErc20.address,
      identifierOrCriteria: "0",
      itemType: ItemType.ERC20,
      transactionMethods: approvalAction.transactionMethods,
      operator: seaportContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc20.allowance(offerer.address, seaportContract.address)
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
            token: testErc721.address,
            recipient: offerer.address,
          },
          {
            endAmount: ethers.utils.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            recipient: zone.address,
            startAmount: ethers.utils.parseEther(".25").toString(),
            token: testErc20.address,
          },
        ],
        endTime,
        offer: [
          {
            // Fees were deducted
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.ERC20,
            startAmount: ethers.utils.parseEther("10").toString(),
            token: testErc20.address,
          },
        ],
        offerer: offerer.address,
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.constants.AddressZero,
        zoneHash: ethers.constants.HashZero,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .callStatic.validate([
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
    await testErc721.mint(offerer.address, nftId);
    await testErc1155.mint(offerer.address, nftId, 1);
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
          token: testErc721.address,
          identifier: nftId,
        },
        {
          itemType: ItemType.ERC1155,
          token: testErc1155.address,
          identifier: nftId,
          amount: "1",
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.false;
    expect(
      await testErc1155.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.false;

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: seaportContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.true;

    const erc1155ApprovalAction = actions[1] as ApprovalAction;

    expect(erc1155ApprovalAction).to.be.deep.equal({
      type: "approval",
      token: testErc1155.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC1155,
      transactionMethods: erc1155ApprovalAction.transactionMethods,
      operator: seaportContract.address,
    });

    await erc1155ApprovalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc1155.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.true;

    const createOrderAction = actions[2] as CreateOrderAction;
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    expect(order).to.deep.equal({
      parameters: {
        consideration: [
          {
            // Fees were deducted
            endAmount: ethers.utils.parseEther("9.75").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("9.75").toString(),
            token: ethers.constants.AddressZero,
          },
          {
            endAmount: ethers.utils.parseEther(".25").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: zone.address,
            startAmount: ethers.utils.parseEther(".25").toString(),
            token: ethers.constants.AddressZero,
          },
        ],
        endTime,
        offer: [
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC721,
            startAmount: "1",
            token: testErc721.address,
          },
          {
            endAmount: "1",
            identifierOrCriteria: nftId,
            itemType: ItemType.ERC1155,
            startAmount: "1",
            token: testErc1155.address,
          },
        ],
        offerer: offerer.address,
        orderType: OrderType.FULL_OPEN,
        salt,
        startTime,
        totalOriginalConsiderationItems: 2,
        zone: ethers.constants.AddressZero,
        zoneHash: ethers.constants.HashZero,
        conduitKey: NO_CONDUIT,
        counter: "0",
      },
      signature: order.signature,
    });

    const isValid = await seaportContract
      .connect(randomSigner)
      .callStatic.validate([
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
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      await testErc20.mint(offerer.address, 1);

      const input: CreateOrderInput = {
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: offerer.address,
          },
          {
            token: testErc20.address,
            amount: ethers.utils.parseEther("1").toString(),
            recipient: zone.address,
          },
        ],
        fees: [{ recipient: zone.address, basisPoints: 250 }],
      };

      await expect(seaport.createOrder(input)).to.be.rejectedWith(
        "All currency tokens in the order must be the same token when applying fees"
      );

      delete input.fees;

      await expect(seaport.createOrder(input)).to.be.not.rejectedWith(
        "All currency tokens in the order must be the same token when applying fees"
      );
    });

    it("throws if offerer does not have sufficient balances", async () => {
      const { seaport, testErc721, testErc20 } = fixture;

      const [offerer, zone] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(zone.address, nftId);
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
            token: testErc721.address,
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: offerer.address,
          },
        ],
        fees: [{ recipient: zone.address, basisPoints: 250 }],
      } as const;

      await expect(seaport.createOrder(createOrderInput)).to.be.rejectedWith(
        "The offerer does not have the amount needed to create or fulfill."
      );

      await testErc721
        .connect(zone)
        .transferFrom(zone.address, offerer.address, nftId);

      // It should not throw now as the offerer has sufficient balance
      await seaport.createOrder(createOrderInput);

      // Now it should as the offerer does not have any ERC20
      await expect(
        seaport.createOrder({
          ...createOrderInput,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId,
            },
            {
              token: testErc20.address,
              amount: "1",
            },
          ],
          consideration: [
            {
              token: testErc20.address,
              amount: ethers.utils.parseEther("10").toString(),
              recipient: offerer.address,
            },
          ],
        })
      ).to.be.rejectedWith(
        "The offerer does not have the amount needed to create or fulfill."
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
      await testErc721.mint(randomSigner.address, nftId);

      const { actions } = await seaport.createOrder({
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifier: nftId,
          },
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: offerer.address,
          },
        ],
        // 2.5% fee
        fees: [{ recipient: zone.address, basisPoints: 250 }],
      });

      const createOrderAction = actions[0] as CreateOrderAction;

      const order = await createOrderAction.createOrder();

      expect(createOrderAction.type).to.equal("create");
      expect(order).to.deep.equal({
        parameters: {
          consideration: [
            {
              endAmount: ethers.utils.parseEther("9.75").toString(),
              identifierOrCriteria: "0",
              itemType: ItemType.NATIVE,
              recipient: offerer.address,
              startAmount: ethers.utils.parseEther("9.75").toString(),
              token: ethers.constants.AddressZero,
            },
            {
              endAmount: ethers.utils.parseEther(".25").toString(),
              identifierOrCriteria: "0",
              itemType: ItemType.NATIVE,
              recipient: zone.address,
              startAmount: ethers.utils.parseEther(".25").toString(),
              token: ethers.constants.AddressZero,
            },
          ],
          endTime,
          offer: [
            {
              endAmount: "1",
              identifierOrCriteria: nftId,
              itemType: ItemType.ERC721,
              startAmount: "1",
              token: testErc721.address,
            },
          ],
          offerer: offerer.address,
          orderType: OrderType.FULL_OPEN,
          salt,
          startTime,
          totalOriginalConsiderationItems: 2,
          zone: ethers.constants.AddressZero,
          zoneHash: ethers.constants.HashZero,
          conduitKey: NO_CONDUIT,
          counter: "0",
        },
        signature: order.signature,
      });

      const isValid = await seaportContract
        .connect(randomSigner)
        .callStatic.validate([
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
    await testErc721.mint(offerer.address, nftId);
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
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: seaportContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        seaportContract.address
      )
    ).to.be.true;

    const createOrderAction = actions[1] as CreateOrderAction;
    const messageToSign = await createOrderAction.getMessageToSign();
    const order = await createOrderAction.createOrder();

    expect(createOrderAction.type).to.equal("create");
    const rawSignTypedMessage = await ethers.provider.send(
      "eth_signTypedData_v4",
      [offerer.address, messageToSign]
    );
    expect(ethers.utils.splitSignature(rawSignTypedMessage).compact).eq(
      order.signature
    );

    const isValid = await seaportContract
      .connect(randomSigner)
      .callStatic.validate([
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
    await testErc721.mint(offerer.address, nftId);
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
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
  });

  it("should create an order with a salt including a hash of the supplied domain", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
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
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt.slice(0, 10)).eq(openseaMagicValue);
  });

  it("should create an order with a salt with the first four bytes being empty if no domain is given", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();

    const { executeAllActions } = await seaport.createOrder({
      startTime,
      endTime,
      offer: [
        {
          itemType: ItemType.ERC721,
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt.slice(0, 10)).eq("0x00000000");
  });

  it("should create an order with the passed in salt", async () => {
    const { seaportContract, seaport, testErc721 } = fixture;

    const [offerer, zone] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
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
          token: testErc721.address,
          identifier: nftId,
        },
      ],
      consideration: [
        {
          amount: ethers.utils.parseEther("10").toString(),
          recipient: offerer.address,
        },
      ],
      // 2.5% fee
      fees: [{ recipient: zone.address, basisPoints: 250 }],
    });

    const order = await executeAllActions();

    const contractOrderHash = await seaportContract.getOrderHash(
      order.parameters
    );

    const localOrderHash = seaport.getOrderHash(order.parameters);

    expect(contractOrderHash).eq(localOrderHash);
    expect(order.parameters.salt).eq(`0x${"0".repeat(60)}abcd`);
  });
});

const OPENSEA_DOMAIN = "opensea.io";
const OPENSEA_TAG = "360c6ebe";

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
        orderSigner.address
      );
      const nftId = "1";
      await testErc721.mint(nftOwner.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      // Mint 10 tokens to the wallet contract
      await testErc20.mint(testERC1271Wallet.address, parseEther("10"));
      // Give allowance to the seaport contract
      await testERC1271Wallet.approveToken(
        testErc20.address,
        seaportContract.address,
        parseEther("10")
      );

      const accountAddress = testERC1271Wallet.address;
      const orderUsaCase = await seaportWithSigner.createOrder(
        {
          startTime,
          endTime,
          salt,
          offer: [
            {
              amount: ethers.utils.parseEther("10").toString(),
              token: testErc20.address,
            },
          ],
          consideration: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifier: nftId,
            },
          ],
          // 2.5% fee
          fees: [{ recipient: zone.address, basisPoints: 250 }],
        },
        accountAddress
      );

      const offerActions = orderUsaCase.actions;
      expect(offerActions).to.have.lengthOf(1);

      const createOrderAction = offerActions[0] as CreateOrderAction;
      expect(createOrderAction.type).to.equal("create");

      const order = await orderUsaCase.executeAllActions();

      const fulfillUsaCase = await seaport.fulfillOrders({
        fulfillOrderDetails: [{ order }],
        accountAddress: nftOwner.address,
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
      expect(exchangeTransaction.data?.slice(-8)).to.eq(OPENSEA_TAG);

      const transaction = await exchange.transactionMethods.transact();

      expect(transaction.data.slice(-8)).to.eq(OPENSEA_TAG);

      expect(await testErc721.ownerOf(nftId)).to.equal(
        testERC1271Wallet.address
      );
      expect(await testErc20.balanceOf(nftOwner.address)).to.equal(
        ethers.utils.parseEther("9.75")
      );
    });
  }
);
