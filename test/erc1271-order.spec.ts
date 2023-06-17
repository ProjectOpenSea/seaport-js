import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderAction } from "../src/types";
import { generateRandomSalt } from "../src/utils/order";
import { describeWithFixture } from "./utils/setup";

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
