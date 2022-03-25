import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Consideration } from "../consideration";
import { ItemType, MAX_INT, OrderType, ProxyStrategy } from "../constants";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const { considerationContract, consideration, testErc721 } = fixture;

    const [offerer, zone, randomSigner] = await ethers.getSigners();
    const nftId = "1";
    await testErc721.mint(offerer.address, nftId);
    const startTime = "0";
    const endTime = MAX_INT.toString();
    const salt = ethers.utils.randomBytes(16);

    const { insufficientApprovals, genActions, numActions } =
      await consideration.createOrder({
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifierOrCriteria: nftId,
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

    expect(insufficientApprovals).to.be.deep.equal([
      {
        token: testErc721.address,
        identifierOrCriteria: nftId,
        approvedAmount: BigNumber.from(0),
        requiredApprovedAmount: BigNumber.from(1),
        operator: considerationContract.address,
        itemType: ItemType.ERC721,
      },
    ]);
    expect(numActions).to.equal(2);

    const actions = await genActions();

    const approvalAction = await actions.next();

    isExactlyNotTrue(approvalAction.done);

    expect(approvalAction.value).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transaction: approvalAction.value.transaction,
      operator: considerationContract.address,
    });

    await approvalAction.value.transaction.wait();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.true;

    const createOrderAction = await actions.next();

    isExactlyTrue(createOrderAction.done);
    expect(createOrderAction.value.type).to.equal("create");
    expect(createOrderAction.value.order).to.deep.equal({
      consideration: [
        {
          endAmount: ethers.utils.parseEther("10").toString(),
          identifierOrCriteria: "0",
          itemType: ItemType.NATIVE,
          recipient: offerer.address,
          startAmount: ethers.utils.parseEther("10").toString(),
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
      nonce: 0,
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
      signature: createOrderAction.value.order.signature,
      startTime,
      zone: ethers.constants.AddressZero,
    });

    const isValid = await considerationContract
      .connect(randomSigner)
      .callStatic.validate([
        {
          parameters: createOrderAction.value.order,
          signature: createOrderAction.value.order.signature,
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
    const salt = ethers.utils.randomBytes(16);

    const { insufficientApprovals, genActions, numActions } =
      await consideration.createOrder({
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifierOrCriteria: nftId,
          },
          {
            itemType: ItemType.ERC1155,
            token: testErc1155.address,
            identifierOrCriteria: nftId,
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

    expect(insufficientApprovals).to.be.deep.equal([
      {
        token: testErc721.address,
        identifierOrCriteria: nftId,
        approvedAmount: BigNumber.from(0),
        requiredApprovedAmount: BigNumber.from(1),
        operator: considerationContract.address,
        itemType: ItemType.ERC721,
      },
      {
        token: testErc1155.address,
        identifierOrCriteria: nftId,
        approvedAmount: BigNumber.from(0),
        requiredApprovedAmount: BigNumber.from(1),
        operator: considerationContract.address,
        itemType: ItemType.ERC1155,
      },
    ]);
    expect(numActions).to.equal(3);
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

    const actions = await genActions();

    const approvalAction = await actions.next();

    isExactlyNotTrue(approvalAction.done);

    expect(approvalAction.value).to.be.deep.equal({
      type: "approval",
      token: testErc721.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC721,
      transaction: approvalAction.value.transaction,
      operator: considerationContract.address,
    });

    await approvalAction.value.transaction.wait();

    // NFT should now be approved
    expect(
      await testErc721.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.true;

    const erc1155ApprovalAction = await actions.next();

    isExactlyNotTrue(erc1155ApprovalAction.done);

    expect(erc1155ApprovalAction.value).to.be.deep.equal({
      type: "approval",
      token: testErc1155.address,
      identifierOrCriteria: nftId,
      itemType: ItemType.ERC1155,
      transaction: erc1155ApprovalAction.value.transaction,
      operator: considerationContract.address,
    });

    await erc1155ApprovalAction.value.transaction.wait();

    // NFT should now be approved
    expect(
      await testErc1155.isApprovedForAll(
        offerer.address,
        considerationContract.address
      )
    ).to.be.true;

    const createOrderAction = await actions.next();

    isExactlyTrue(createOrderAction.done);
    expect(createOrderAction.value.type).to.equal("create");
    expect(createOrderAction.value.order).to.deep.equal({
      consideration: [
        {
          endAmount: ethers.utils.parseEther("10").toString(),
          identifierOrCriteria: "0",
          itemType: ItemType.NATIVE,
          recipient: offerer.address,
          startAmount: ethers.utils.parseEther("10").toString(),
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
      nonce: 0,
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
      signature: createOrderAction.value.order.signature,
      startTime,
      zone: ethers.constants.AddressZero,
    });

    const isValid = await considerationContract
      .connect(randomSigner)
      .callStatic.validate([
        {
          parameters: createOrderAction.value.order,
          signature: createOrderAction.value.order.signature,
        },
      ]);

    expect(isValid).to.be.true;
  });

  describe("validations", () => {
    it("throws if currencies are different", async () => {
      const { consideration, testErc721, testErc20 } = fixture;

      const [offerer, zone] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = ethers.utils.randomBytes(16);
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
              identifierOrCriteria: nftId,
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
      const salt = ethers.utils.randomBytes(16);

      const createOrderInput = {
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifierOrCriteria: nftId,
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
              identifierOrCriteria: nftId,
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
      const salt = ethers.utils.randomBytes(16);
      await testErc721.mint(randomSigner.address, nftId);

      const { insufficientApprovals, genActions, numActions } =
        await consideration.createOrder({
          startTime,
          endTime,
          salt,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifierOrCriteria: nftId,
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

      expect(insufficientApprovals).to.be.deep.equal([
        {
          token: testErc721.address,
          identifierOrCriteria: nftId,
          approvedAmount: BigNumber.from(0),
          requiredApprovedAmount: BigNumber.from(1),
          operator: considerationContract.address,
          itemType: ItemType.ERC721,
        },
      ]);
      // We don't count approval as an action since we skip it.
      expect(numActions).to.equal(1);
      expect(
        await testErc721.isApprovedForAll(
          offerer.address,
          considerationContract.address
        )
      ).to.be.false;

      const actions = await genActions();

      const createOrderAction = await actions.next();

      isExactlyTrue(createOrderAction.done);
      expect(createOrderAction.value.type).to.equal("create");
      expect(createOrderAction.value.order).to.deep.equal({
        consideration: [
          {
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("10").toString(),
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
        nonce: 0,
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
        signature: createOrderAction.value.order.signature,
        startTime,
        zone: ethers.constants.AddressZero,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: createOrderAction.value.order,
            signature: createOrderAction.value.order.signature,
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
      const salt = ethers.utils.randomBytes(16);

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT should now be approved
      await testErc721.connect(offerer).setApprovalForAll(offererProxy, true);

      const { insufficientApprovals, genActions, numActions } =
        await consideration.createOrder({
          startTime,
          endTime,
          salt,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifierOrCriteria: nftId,
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

      expect(insufficientApprovals.length).to.equal(0);
      expect(numActions).to.equal(1);

      const actions = await genActions();

      const createOrderAction = await actions.next();

      isExactlyTrue(createOrderAction.done);
      expect(createOrderAction.value.type).to.equal("create");
      expect(createOrderAction.value.order).to.deep.equal({
        consideration: [
          {
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("10").toString(),
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
        nonce: 0,
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
        orderType: OrderType.FULL_OPEN_VIA_PROXY,
        salt,
        signature: createOrderAction.value.order.signature,
        startTime,
        zone: ethers.constants.AddressZero,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: createOrderAction.value.order,
            signature: createOrderAction.value.order.signature,
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
      const salt = ethers.utils.randomBytes(16);

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT approved on both proxy and directly
      await testErc721.connect(offerer).setApprovalForAll(offererProxy, true);
      await testErc721
        .connect(offerer)
        .setApprovalForAll(considerationContract.address, true);

      const { insufficientApprovals, genActions, numActions } =
        await consideration.createOrder({
          startTime,
          endTime,
          salt,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifierOrCriteria: nftId,
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

      expect(insufficientApprovals.length).to.equal(0);
      expect(numActions).to.equal(1);

      const actions = await genActions();

      const createOrderAction = await actions.next();

      isExactlyTrue(createOrderAction.done);
      expect(createOrderAction.value.type).to.equal("create");
      expect(createOrderAction.value.order).to.deep.equal({
        consideration: [
          {
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("10").toString(),
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
        nonce: 0,
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
        signature: createOrderAction.value.order.signature,
        startTime,
        zone: ethers.constants.AddressZero,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: createOrderAction.value.order,
            signature: createOrderAction.value.order.signature,
          },
        ]);

      expect(isValid).to.be.true;
    });

    it("should not use my proxy if proxy strategy is set to NEVER", async () => {
      const { considerationContract, testErc721, legacyProxyRegistry } =
        fixture;

      const consideration = new Consideration(ethers.provider, {
        proxyStrategy: ProxyStrategy.NEVER,
        overrides: {
          contractAddress: considerationContract.address,
          legacyProxyRegistryAddress: legacyProxyRegistry.address,
        },
      });

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = ethers.utils.randomBytes(16);

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT approved on proxy
      await testErc721.connect(offerer).setApprovalForAll(offererProxy, true);

      const { insufficientApprovals, genActions, numActions } =
        await consideration.createOrder({
          startTime,
          endTime,
          salt,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifierOrCriteria: nftId,
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

      expect(insufficientApprovals).to.be.deep.equal([
        {
          token: testErc721.address,
          identifierOrCriteria: nftId,
          approvedAmount: BigNumber.from(0),
          requiredApprovedAmount: BigNumber.from(1),
          itemType: ItemType.ERC721,
          operator: considerationContract.address,
        },
      ]);
      expect(numActions).to.equal(2);

      const actions = await genActions();

      const approvalAction = await actions.next();

      isExactlyNotTrue(approvalAction.done);

      expect(approvalAction.value).to.be.deep.equal({
        type: "approval",
        token: testErc721.address,
        identifierOrCriteria: nftId,
        itemType: ItemType.ERC721,
        transaction: approvalAction.value.transaction,
        operator: considerationContract.address,
      });

      await approvalAction.value.transaction.wait();

      // NFT should now be approved
      expect(
        await testErc721.isApprovedForAll(
          offerer.address,
          considerationContract.address
        )
      ).to.be.true;

      const createOrderAction = await actions.next();

      isExactlyTrue(createOrderAction.done);
      expect(createOrderAction.value.type).to.equal("create");
      expect(createOrderAction.value.order).to.deep.equal({
        consideration: [
          {
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("10").toString(),
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
        nonce: 0,
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
        signature: createOrderAction.value.order.signature,
        startTime,
        zone: ethers.constants.AddressZero,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: createOrderAction.value.order,
            signature: createOrderAction.value.order.signature,
          },
        ]);

      expect(isValid).to.be.true;
    });

    it("should use my proxy if proxy strategy is set to ALWAYS, even if I require zero approvals", async () => {
      const { considerationContract, testErc721, legacyProxyRegistry } =
        fixture;

      const consideration = new Consideration(ethers.provider, {
        proxyStrategy: ProxyStrategy.ALWAYS,
        overrides: {
          contractAddress: considerationContract.address,
          legacyProxyRegistryAddress: legacyProxyRegistry.address,
        },
      });

      const [offerer, zone, randomSigner] = await ethers.getSigners();
      const nftId = "1";
      await testErc721.mint(offerer.address, nftId);
      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = ethers.utils.randomBytes(16);

      // Register the proxy on the user
      await legacyProxyRegistry.connect(offerer).registerProxy();

      const offererProxy = await legacyProxyRegistry.proxies(offerer.address);

      // NFT approved on consideration
      await testErc721
        .connect(offerer)
        .setApprovalForAll(considerationContract.address, true);

      const { insufficientApprovals, genActions, numActions } =
        await consideration.createOrder({
          startTime,
          endTime,
          salt,
          offer: [
            {
              itemType: ItemType.ERC721,
              token: testErc721.address,
              identifierOrCriteria: nftId,
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

      expect(insufficientApprovals).to.be.deep.equal([
        {
          token: testErc721.address,
          identifierOrCriteria: nftId,
          approvedAmount: BigNumber.from(0),
          requiredApprovedAmount: BigNumber.from(1),
          itemType: ItemType.ERC721,
          operator: offererProxy,
        },
      ]);
      expect(numActions).to.equal(2);

      const actions = await genActions();

      const approvalAction = await actions.next();

      isExactlyNotTrue(approvalAction.done);

      expect(approvalAction.value).to.be.deep.equal({
        type: "approval",
        token: testErc721.address,
        identifierOrCriteria: nftId,
        itemType: ItemType.ERC721,
        transaction: approvalAction.value.transaction,
        operator: offererProxy,
      });

      await approvalAction.value.transaction.wait();

      // NFT should now be approved
      expect(await testErc721.isApprovedForAll(offerer.address, offererProxy))
        .to.be.true;

      const createOrderAction = await actions.next();

      isExactlyTrue(createOrderAction.done);
      expect(createOrderAction.value.type).to.equal("create");
      expect(createOrderAction.value.order).to.deep.equal({
        consideration: [
          {
            endAmount: ethers.utils.parseEther("10").toString(),
            identifierOrCriteria: "0",
            itemType: ItemType.NATIVE,
            recipient: offerer.address,
            startAmount: ethers.utils.parseEther("10").toString(),
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
        nonce: 0,
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
        orderType: OrderType.FULL_OPEN_VIA_PROXY,
        salt,
        signature: createOrderAction.value.order.signature,
        startTime,
        zone: ethers.constants.AddressZero,
      });

      const isValid = await considerationContract
        .connect(randomSigner)
        .callStatic.validate([
          {
            parameters: createOrderAction.value.order,
            signature: createOrderAction.value.order.signature,
          },
        ]);

      expect(isValid).to.be.true;
    });
  });
});
