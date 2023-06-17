import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { ItemType, MAX_INT } from "../src/constants";
import { CreateOrderAction } from "../src/types";
import { generateRandomSalt } from "../src/utils/order";
import { describeWithFixture } from "./utils/setup";

describeWithFixture("As a user I want to create an order", (fixture) => {
  it("should create the order after setting needed approvals", async () => {
    const {
      seaportContract,
      seaport,
      testErc721,
      testERC1271Wallet,
      testErc20,
    } = fixture;
    const [orderSigner, zone, nftOwner] = await ethers.getSigners();
    expect(await testERC1271Wallet.orderSigner()).to.equal(orderSigner.address);
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
    const { actions } = await seaport.createOrder(
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

    expect(actions).to.have.lengthOf(1);

    const createOrderAction = actions[0] as CreateOrderAction;
    expect(createOrderAction.type).to.equal("create");
  });
});
