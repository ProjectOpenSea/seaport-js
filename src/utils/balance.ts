import { BigNumber, Contract } from "ethers";
import { ERC1155ABI } from "../abi/ERC1155";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType } from "../constants";
import { ERC1155, ERC20, ERC721 } from "../typechain";
import { Item, OrderParameters } from "../types";
import {
  getSummedTokenAndIdentifierAmounts,
  isErc1155Item,
  isErc721Item,
  TimeBasedItemParams,
} from "./item";
import { providers as multicallProviders } from "@0xsequence/multicall";
import {
  BalancesAndApprovals,
  getInsufficientBalanceAndApprovalAmounts,
} from "./balancesAndApprovals";

/**
 * The offerer should have sufficient balance of all offered items.
 * @param orderParameters - standard Order parameters
 */
export const validateOfferBalances = (
  offer: OrderParameters["offer"],
  {
    balancesAndApprovals,
    timeBasedItemParams,
  }: {
    balancesAndApprovals: BalancesAndApprovals;
    timeBasedItemParams?: TimeBasedItemParams;
  }
) => {
  const { insufficientBalances } = getInsufficientBalanceAndApprovalAmounts(
    balancesAndApprovals,
    getSummedTokenAndIdentifierAmounts(offer, timeBasedItemParams)
  );

  if (insufficientBalances.length > 0) {
    throw new Error(
      `The offerer does not have the amount needed to create or fulfill.`
    );
  }
};

export const balanceOf = async (
  owner: string,
  item: Item,
  provider: multicallProviders.MulticallProvider
): Promise<BigNumber> => {
  if (isErc721Item(item)) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC721;

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return contract.balanceOf(owner);
    }

    const isOwner = await contract.ownerOf(item.identifierOrCriteria);
    return BigNumber.from(Number(isOwner));
  } else if (isErc1155Item(item)) {
    if (item.itemType === ItemType.ERC1155_WITH_CRITERIA) {
      throw new Error("ERC1155 Criteria based offers are not supported");
    }

    const contract = new Contract(item.token, ERC1155ABI, provider) as ERC1155;
    return contract.balanceOf(owner, item.identifierOrCriteria);
  }

  if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC20;
    return contract.balanceOf(owner);
  }

  return provider.getBalance(owner);
};
