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
        await testErc721.mint(await offerer.getAddress(), nftId);
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
            token: await testErc721.getAddress(),
            identifier: nftId1,
          } as BasicErc721Item,
        ],
        consideration: [
          {
            amount: ethers.parseEther("10").toString(),
            recipient: await offerer.getAddress(),
          },
        ],
        // 2.5% fee
        fees: [{ recipient: await zone.getAddress(), basisPoints: 250 }],
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
        token: await testErc721.getAddress(),
        identifierOrCriteria: nftId1,
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
                identifierOrCriteria: nftIds[index],
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
      }
    });
  },
);
