import { ethers } from "ethers";
import { ItemType } from "../constants";
import {
  TestERC721__factory,
  TestERC1155__factory,
  TestERC20__factory,
} from "../typechain-types";
import type { InputCriteria, Item } from "../types";
import { isErc1155Item, isErc20Item, isErc721Item } from "./item";

export const balanceOf = async (
  owner: string,
  item: Item,
  provider: ethers.Provider,
  criteria?: InputCriteria,
): Promise<bigint> => {
  if (isErc721Item(item.itemType)) {
    const contract = TestERC721__factory.connect(item.token, provider);

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return criteria
        ? contract
            .ownerOf(criteria.identifier)
            .then((ownerOf) =>
              BigInt(ownerOf.toLowerCase() === owner.toLowerCase()),
            )
        : contract.balanceOf(owner);
    }

    return contract
      .ownerOf(item.identifierOrCriteria)
      .then((ownerOf) => BigInt(ownerOf.toLowerCase() === owner.toLowerCase()));
  } else if (isErc1155Item(item.itemType)) {
    const contract = TestERC1155__factory.connect(item.token, provider);

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
    const contract = TestERC20__factory.connect(item.token, provider);
    return contract.balanceOf(owner);
  }

  return provider.getBalance(owner);
};
