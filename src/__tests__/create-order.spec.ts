import { expect } from "chai";
import { formatBytes32String, parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Consideration } from "../consideration";
import {
  ItemType,
  LEGACY_PROXY_CONDUIT,
  MAX_INT,
  NO_CONDUIT,
  OrderType,
} from "../constants";
import { ApprovalAction, CreateOrderAction } from "../types";
import { generateRandomSalt } from "../utils/order";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await consideration.createOrder({
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
      operator: considerationContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
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
        zoneHash: formatBytes32String("0"),
        conduit: NO_CONDUIT,
      },
      signature: order.signature,
      nonce: 0,
    });

    const isValid = await considerationContract
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
    const { considerationContract, consideration, testErc20, testErc721 } =
      fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc20.mint(offerer.address, parseEther("10").toString());
    await testErc721.mint(randomSigner.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await consideration.createOrder({
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
      operator: considerationContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc20.allowance(offerer.address, considerationContract.address)
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
        zoneHash: formatBytes32String("0"),
        conduit: NO_CONDUIT,
      },
      signature: order.signature,
      nonce: 0,
    });

    const isValid = await considerationContract
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
    const { considerationContract, consideration, testErc721, testErc1155 } =
      fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
    await testErc1155.mint(offerer.address, nftId, 1);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = generateRandomSalt();

    const { actions } = await consideration.createOrder({
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
        considerationContract.address
      )
    ).to.be.false;
    expect(
      await testErc1155.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.false;

    const approvalAction = actions[0] as ApprovalAction;

    expect(approvalAction).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transactionMethods: approvalAction.transactionMethods,
      operator: considerationContract.address,
    });

    await approvalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.true;

    const erc1155ApprovalAction = actions[1] as ApprovalAction;

    expect(erc1155ApprovalAction).to.be.deep.equal({
      type: "approval",
      token: testErc1155.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC1155,
      transactionMethods: erc1155ApprovalAction.transactionMethods,
      operator: considerationContract.address,
    });

    await erc1155ApprovalAction.transactionMethods.transact();

    // NFT should now be approved
    expect(
      await testErc1155.isApprovedForAll(
        offerer.address,
        considerationContract.address
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
        zoneHash: formatBytes32String("0"),
        conduit: NO_CONDUIT,
      },
      signature: order.signature,
      nonce: 0,
    });

    const isValid = await considerationContract
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
    it("throws if currencies are different", async () => {
      const { consideration, testErc721, testErc20 } = fixture;

      const [offerer, zone] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      await testErc20.mint(offerer.address, 1);

      await expect(
        consideration.createOrder({
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
        })
      ).to.be.rejectedWith(
        "All currency tokens in the order must be the same token"
      );
    });

    it("throws if offerer does not have sufficient balances", async () => {
      const { consideration, testErc721, testErc20 } = fixture;

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

      await expect(
        consideration.createOrder(createOrderInput)
      ).to.be.rejectedWith(
        "The offerer does not have the amount needed to create or fulfill."
      );

      await testErc721
        .connect(zone)
        .transferFrom(zone.address, offerer.address, nftId);

      // It should not throw now as the offerer has sufficient balance
      await consideration.createOrder(createOrderInput);

      // Now it should as the offerer does not have any ERC20
      await expect(
        consideration.createOrder({
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
      const { considerationContract, testErc721, legacyProxyRegistry } =
        fixture;

      const consideration = new Consideration(ethers.provider, {
        balanceAndApprovalChecksOnOrderCreation: false,
        overrides: {
          contractAddress: considerationContract.address,
          legacyProxyRegistryAddress: legacyProxyRegistry.address,
        },
      });

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();
      await testErc721.mint(randomSigner.address, nftId);

      const { actions } = await consideration.createOrder({
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
          zoneHash: formatBytes32String("0"),
          conduit: NO_CONDUIT,
        },
        signature: order.signature,
        nonce: 0,
      });

      const isValid = await considerationContract
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

  describe("with proxy strategy", () => {
    it("should use my proxy if my proxy requires zero approvals while I require approvals", async () => {
      const {
        considerationContract,
        consideration,
        testErc721,
        legacyProxyRegistry,
      } = fixture;

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT should now be approved
      await testErc721.connect(offerer).setApprovalForAll(offererProxy, true);

      const { actions } = await consideration.createOrder({
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
      const createdOrder = await createOrderAction.createOrder();

      expect(createOrderAction.type).to.equal("create");
      expect(createdOrder).to.deep.equal({
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
          zoneHash: formatBytes32String("0"),
          conduit: LEGACY_PROXY_CONDUIT,
        },
        signature: createdOrder.signature,
        nonce: 0,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: {
              ...createdOrder.parameters,
              totalOriginalConsiderationItems:
                createdOrder.parameters.consideration.length,
            },
            signature: createdOrder.signature,
          },
        ]);

      expect(isValid).to.be.true;
    });

    it("should not use my proxy if both my proxy and I require zero approvals", async () => {
      const {
        considerationContract,
        consideration,
        testErc721,
        legacyProxyRegistry,
      } = fixture;

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT approved on both proxy and directly
      await testErc721.connect(offerer).setApprovalForAll(offererProxy, true);
      await testErc721
        .connect(offerer)
        .setApprovalForAll(considerationContract.address, true);

      const { actions } = await consideration.createOrder({
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
          zoneHash: formatBytes32String("0"),
          conduit: NO_CONDUIT,
        },
        signature: order.signature,
        nonce: 0,
      });

      const isValid = await considerationContract
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
});
