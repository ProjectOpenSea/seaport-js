import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, Contract, Signer } from "ethers";
import { ERC20ABI } from "../abi/ERC20";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType, MAX_INT } from "../constants";
import type { ERC20 } from "../typechain/ERC20";
import type { ERC721 } from "../typechain/ERC721";
import type { ApprovalAction, Item } from "../types";
import type { InsufficientApprovals } from "./balanceAndApprovalCheck";
import { isErc1155Item, isErc721Item } from "./item";
import { getTransactionMethods } from "./usecase";

export const approvedItemAmount = async (
  owner: string,
  item: Item,
  operator: string,
  multicallProvider: multicallProviders.MulticallProvider
) => {
  if (isErc721Item(item.itemType) || isErc1155Item(item.itemType)) {
    // isApprovedForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
    const contract = new Contract(
      item.token,
      ERC721ABI,
      multicallProvider
    ) as ERC721;
    return contract.isApprovedForAll(owner, operator).then((isApprovedForAll) =>
      // Setting to the max int to consolidate types and simplify
      isApprovedForAll ? MAX_INT : BigNumber.from(0)
    );
  } else if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(
      item.token,
      ERC20ABI,
      multicallProvider
    ) as ERC20;

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * Get approval actions given a list of insufficent approvals.
 */
export function getApprovalActions(
  insufficientApprovals: InsufficientApprovals,
  signer: Signer
): Promise<ApprovalAction[]> {
  return Promise.all(
    insufficientApprovals
      .filter(
        (approval, index) =>
          index === insufficientApprovals.length - 1 ||
          insufficientApprovals[index + 1].token !== approval.token
      )
      .map(async ({ token, operator, itemType, identifierOrCriteria }) => {
        if (isErc721Item(itemType) || isErc1155Item(itemType)) {
          // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
          const contract = new Contract(token, ERC721ABI, signer) as ERC721;

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            operator,
            transactionMethods: getTransactionMethods(
              contract.connect(signer),
              "setApprovalForAll",
              [operator, true]
            ),
          };
        } else {
          const contract = new Contract(token, ERC20ABI, signer) as ERC20;

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            transactionMethods: getTransactionMethods(
              contract.connect(signer),
              "approve",
              [operator, MAX_INT]
            ),
            operator,
          };
        }
      })
  );
}
