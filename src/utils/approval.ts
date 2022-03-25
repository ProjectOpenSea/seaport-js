import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, Contract, providers } from "ethers";
import { ERC20ABI } from "../abi/ERC20";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType, MAX_INT } from "../constants";
import type { ERC20, ERC721 } from "../typechain";
import type { ApprovalAction, Item } from "../types";
import type { InsufficientApprovals } from "./balancesAndApprovals";
import { isErc1155Item, isErc721Item } from "./item";

export const approvedItemAmount = async (
  owner: string,
  item: Item,
  operator: string,
  provider: multicallProviders.MulticallProvider
) => {
  if (isErc721Item(item.itemType) || isErc1155Item(item.itemType)) {
    // isApprovedForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC721;
    return contract.isApprovedForAll(owner, operator).then((isApprovedForAll) =>
      // Setting to the max int to consolidate types and simplify
      isApprovedForAll ? MAX_INT : BigNumber.from(0)
    );
  } else if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(item.token, ERC20ABI, provider) as ERC20;

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * Set the appropriate approvals given a list of insufficent approvals.
 */
export async function* setNeededApprovals(
  insufficientApprovals: InsufficientApprovals,
  {
    provider,
  }: {
    provider: providers.JsonRpcProvider;
  }
): AsyncGenerator<ApprovalAction> {
  const signer = provider.getSigner();

  for (const {
    token,
    operator,
    itemType,
    identifierOrCriteria,
  } of insufficientApprovals) {
    if (isErc721Item(itemType) || isErc1155Item(itemType)) {
      // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
      const contract = new Contract(token, ERC721ABI, signer) as ERC721;
      const transaction = await contract.setApprovalForAll(operator, true);

      yield {
        type: "approval",
        token,
        identifierOrCriteria,
        itemType,
        transaction,
        operator,
      };
      await transaction.wait();
    } else if (itemType === ItemType.ERC20) {
      const contract = new Contract(token, ERC721ABI, signer) as ERC20;
      const transaction = await contract.approve(operator, MAX_INT);

      yield {
        type: "approval",
        token,
        identifierOrCriteria,
        itemType,
        transaction,
        operator,
      };
      await transaction.wait();
    }
  }
}
