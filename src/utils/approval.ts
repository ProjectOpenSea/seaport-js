import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, Contract, providers } from "ethers";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType, MAX_INT } from "../constants";
import { ERC20, ERC721 } from "../typechain";
import { Item } from "../types";
import { BalancesAndApprovals } from "./balancesAndApprovals";
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
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC20;

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * Set the appropriate approvals given a list of insufficent approvals.
 */
export const setNeededApprovals = async (
  insufficientApprovals: BalancesAndApprovals,
  {
    provider,
  }: {
    provider: providers.JsonRpcProvider;
  }
) => {
  const signer = provider.getSigner();

  for (const { token, operator, itemType } of insufficientApprovals) {
    // This is guaranteed to exist

    if (isErc721Item(itemType) || isErc1155Item(itemType)) {
      // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
      const contract = new Contract(token, ERC721ABI, signer) as ERC721;
      await contract.setApprovalForAll(operator, true);
    } else if (itemType === ItemType.ERC20) {
      const contract = new Contract(token, ERC721ABI, signer) as ERC20;
      await contract.approve(operator, MAX_INT);
    }
  }
};
