import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Consideration } from "../consideration";
import { ItemType, MAX_INT, OrderType, ProxyStrategy } from "../constants";
import { CreateOrderInput } from "../types";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer",
  (fixture) => {
    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC721", async () => {
        let offerer: SignerWithAddress;
        let zone: SignerWithAddress;
        let fulfiller: SignerWithAddress;
        let standardCreateOrderInput: CreateOrderInput;
        const nftId = "1";

        beforeEach(async () => {
          [offerer, zone, fulfiller] = await ethers.getSigners();
          const { testErc721, legacyProxyRegistry, considerationContract } =
            fixture;

          await testErc721.mint(offerer.address, nftId);

          // Register the proxy on the offerer
          await legacyProxyRegistry.connect(offerer).registerProxy();

          const offererProxy = await legacyProxyRegistry.proxies(
            offerer.address
          );

          // Approving both proxy and consideration contract for convenience
          await testErc721
            .connect(offerer)
            .setApprovalForAll(offererProxy, true);

          await testErc721
            .connect(offerer)
            .setApprovalForAll(considerationContract.address, true);

          standardCreateOrderInput = {
            startTime: "0",
            endTime: MAX_INT.toString(),
            salt: ethers.utils.randomBytes(16),
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
          };
        });

        it("ERC721 <=> ETH", async () => {
          const { consideration } = fixture;
          const { executeAllActions } = await consideration.createOrder(
            standardCreateOrderInput
          );

          const order = await executeAllActions();

          const fulfillActions = await consideration.fulfillOrder(order);
        });
        it("ERC721 <=> ETH (offer via proxy)", async () => {});
        it("ERC721 <=> ETH (already validated order)", async () => {});
        it("ERC721 <=> ETH (extra ether supplied and returned to caller)", async () => {});
        it("ERC721 <=> ETH (fulfilled via proxy)", async () => {});
        it("ERC721 <=> ERC20", async () => {});
        it("ERC721 <=> ERC20 (offer via proxy)", async () => {});
        it("ERC721 <=> ERC20 (already validated order)", async () => {});
        it("ERC721 <=> ERC20 (extra ether supplied and returned to caller)", async () => {});
        it("ERC721 <=> ERC20 (fulfilled via proxy)", async () => {});
      });

      describe("[Accept offer] I want to accept an offer for my single ERC721", async () => {
        it("ERC20 <=> ERC721", async () => {});
        it("ERC20 <=> ERC721 (offer via proxy)", async () => {});
        it("ERC20 <=> ERC721 (already validated order)", async () => {});
        it("ERC20 <=> ERC721 (extra ether supplied and returned to caller)", async () => {});
        it("ERC20 <=> ERC721 (fulfilled via proxy)", async () => {});
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC1155", async () => {
        it("ERC1155 <=> ETH", async () => {});
        it("ERC1155 <=> ETH (offer via proxy)", async () => {});
        it("ERC1155 <=> ETH (already validated order)", async () => {});
        it("ERC1155 <=> ETH (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ETH (fulfilled via proxy)", async () => {});
        it("ERC1155 <=> ERC20", async () => {});
        it("ERC1155 <=> ERC20 (offer via proxy)", async () => {});
        it("ERC1155 <=> ERC20 (already validated order)", async () => {});
        it("ERC1155 <=> ERC20 (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ERC20 (fulfilled via proxy)", async () => {});
      });

      describe("[Accept offer] I want to accept an offer for my single ERC1155", async () => {
        it("ERC1155 <=> ETH", async () => {});
        it("ERC1155 <=> ETH (offer via proxy)", async () => {});
        it("ERC1155 <=> ETH (already validated order)", async () => {});
        it("ERC1155 <=> ETH (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ETH (fulfilled via proxy)", async () => {});
        it("ERC1155 <=> ERC20", async () => {});
        it("ERC1155 <=> ERC20 (offer via proxy)", async () => {});
        it("ERC1155 <=> ERC20 (already validated order)", async () => {});
        it("ERC1155 <=> ERC20 (extra ether supplied and returned to caller)", async () => {});
        it("ERC1155 <=> ERC20 (fulfilled via proxy)", async () => {});
      });
    });

    describe("with proxy strategy", () => {
      it("should use my proxy if my proxy requires zero approvals while I require approvals", async () => {});
      it("should not use my proxy if both my proxy and I require zero approvals", async () => {});
      it("should not use my proxy if proxy strategy is set to NEVER", async () => {});
      it("should use my proxy if proxy strategy is set to ALWAYS, even if I require zero approvals", async () => {});
    });
  }
);
