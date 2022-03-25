import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Consideration } from "../consideration";
import { ItemType, MAX_INT, OrderType, ProxyStrategy } from "../constants";
import { isExactlyNotTrue, isExactlyTrue } from "./utils/assert";
import { describeWithFixture } from "./utils/setup";

describeWithFixture(
  "As a user I want to buy now or accept an offer",
  (fixture) => {
    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] I want to buy a single ERC721", async () => {
        it("ERC721 <=> ETH", async () => {});
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
