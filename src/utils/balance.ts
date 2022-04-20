import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, Contract } from "ethers";
import { ERC1155ABI } from "../abi/ERC1155";
import { ERC20ABI } from "../abi/ERC20";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType } from "../constants";
import type { ERC20 } from "../typechain/ERC20";
import type { ERC1155 } from "../typechain/ERC1155";
import type { ERC721 } from "../typechain/ERC721";
import type { InputCriteria, Item } from "../types";
import { isErc1155Item, isErc20Item, isErc721Item } from "./item";

export const balanceOf = async (
  owner: string,
  item: Item,
  multicallProvider: multicallProviders.MulticallProvider,
  criteria?: InputCriteria
): Promise<BigNumber> => {
  if (isErc721Item(item.itemType)) {
    const contract = new Contract(
      item.token,
      ERC721ABI,
      multicallProvider
    ) as ERC721;

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return criteria
        ? contract
            .ownerOf(criteria.identifier)
            .then((ownerOf) =>
              BigNumber.from(
                Number(ownerOf.toLowerCase() === owner.toLowerCase())
              )
            )
        : contract.balanceOf(owner);
    }

    return contract
      .ownerOf(item.identifierOrCriteria)
      .then((ownerOf) =>
        BigNumber.from(Number(ownerOf.toLowerCase() === owner.toLowerCase()))
      );
  } else if (isErc1155Item(item.itemType)) {
    const contract = new Contract(
      item.token,
      ERC1155ABI,
      multicallProvider
    ) as ERC1155;

    if (item.itemType === ItemType.ERC1155_WITH_CRITERIA) {
      if (!criteria) {
        // We don't have a good way to determine the balance of an erc1155 criteria item unless explicit
        // identifiers are provided, so just assume the offerer has sufficient balance
        const startAmount = BigNumber.from(item.startAmount);
        const endAmount = BigNumber.from(item.endAmount);

        return startAmount.gt(endAmount) ? startAmount : endAmount;
      }
      return contract.balanceOf(owner, criteria.identifier);
    }

    return contract.balanceOf(owner, item.identifierOrCriteria);
  }

  if (isErc20Item(item.itemType)) {
    const contract = new Contract(
      item.token,
      ERC20ABI,
      multicallProvider
    ) as ERC20;
    return contract.balanceOf(owner);
  }

  return multicallProvider.getBalance(owner);
};
