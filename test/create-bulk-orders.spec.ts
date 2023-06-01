import { expect } from "chai";
import { ethers } from "hardhat";
import { ItemType, MAX_INT, NO_CONDUIT, OrderType } from "../src/constants";
import {
  ApprovalAction,
  BasicErc721Item,
  CreateBulkOrdersAction,
} from "../src/types";
import { generateRandomSalt } from "../src/utils/order";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to create bulk orders with one signature",
  (fixture) => {
    it("should create the orders after setting needed approvals", async () => {
      const { seaportContract, seaport, testErc721 } = fixture;

      const [offerer, zone, randomSigner] = await ethers.getSigners();

      const nftId1 = "1";
      const nftId2 = "2";
      const nftId3 = "3";
      const nftIds = [nftId1, nftId2, nftId3];
      for (const nftId of nftIds) {
        await testErc721.mint(offerer.address, nftId);
      }

      const startTime = "0";
      const endTime = MAX_INT.toString();
      const salt = generateRandomSalt();

      const order = {
        startTime,
        endTime,
        salt,
        offer: [
          {
            itemType: ItemType.ERC721,
            token: testErc721.address,
            identifier: nftId1,
          } as BasicErc721Item,
        ],
        consideration: [
          {
            amount: ethers.utils.parseEther("10").toString(),
            recipient: offerer.address,
          },
        ],
        // 2.5% fee
        fees: [{ recipient: zone.address, basisPoints: 250 }],
      };

      const orders = [
        order,
        { ...order, offer: [{ ...order.offer[0], identifier: nftId2 }] },
        { ...order, offer: [{ ...order.offer[0], identifier: nftId3 }] },
      ];

      const { actions } = await seaport.createBulkOrders(orders);

      // Expect only one approval action for the collection of tokens nftId1-nftId3
      expect(actions.filter((a) => a.type === "approval")).to.have.lengthOf(1);

      const approvalAction = actions[0] as ApprovalAction;

      expect(approvalAction).to.be.deep.equal({
        type: "approval",
        token: testErc721.address,
        identifierOrCriteria: nftId1,
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

      const createOrderAction = actions[1] as CreateBulkOrdersAction;
      const createdOrders = await createOrderAction.createBulkOrders();

      expect(createOrderAction.type).to.equal("createBulk");

      // Validate each order
      for (const [index, order] of createdOrders.entries()) {
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
                identifierOrCriteria: nftIds[index],
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
      }
    });
  }
);
