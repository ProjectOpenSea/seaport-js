import { Contract, ethers } from "ethers";
import { ERC1155ABI } from "../abi/ERC1155";
import { ERC20ABI } from "../abi/ERC20";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType } from "../constants";
import type { TestERC20, TestERC1155, TestERC721 } from "../typechain-types";
import type { InputCriteria, Item } from "../types";
import { isErc1155Item, isErc20Item, isErc721Item } from "./item";

export const balanceOf = async (
  owner: string,
  item: Item,
  provider: ethers.Provider,
  criteria?: InputCriteria,
): Promise<BigInt> => {
  if (isErc721Item(item.itemType)) {
    const contract = new Contract(
      item.token,
      ERC721ABI,
      provider,
    ) as TestERC721;

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return criteria
        ? contract
            .ownerOf(criteria.identifier)
            .then((ownerOf) =>
              BigInt(Number(ownerOf.toLowerCase() === owner.toLowerCase())),
            )
        : contract.balanceOf(owner);
    }

    return contract
      .ownerOf(item.identifierOrCriteria)
      .then((ownerOf) =>
        BigInt(Number(ownerOf.toLowerCase() === owner.toLowerCase())),
      );
  } else if (isErc1155Item(item.itemType)) {
    const contract = new Contract(
      item.token,
      ERC1155ABI,
      provider,
    ) as TestERC1155;

    if (item.itemType === ItemType.ERC1155_WITH_CRITERIA) {
      if (!criteria) {
        // We don't have a good way to determine the balance of an erc1155 criteria item unless explicit
        // identifiers are provided, so just assume the offerer has sufficient balance
        const startAmount = BigInt(item.startAmount);
        const endAmount = BigInt(item.endAmount);

        return startAmount > endAmount ? startAmount : endAmount;
      }
      return contract.balanceOf(owner, criteria.identifier);
    }

    return contract.balanceOf(owner, item.identifierOrCriteria);
  }

  if (isErc20Item(item.itemType)) {
    const contract = new Contract(item.token, ERC20ABI, provider) as TestERC20;
    return contract.balanceOf(owner);
  }

  return provider.getBalance(owner);
};
