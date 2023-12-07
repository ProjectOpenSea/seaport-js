import { Signer, ethers } from "ethers";
import { ItemType, MAX_INT } from "../constants";
import { TestERC721__factory, TestERC20__factory } from "../typechain-types";
import type { ApprovalAction, Item } from "../types";
import type { InsufficientApprovals } from "./balanceAndApprovalCheck";
import { isErc1155Item, isErc721Item } from "./item";
import { getTransactionMethods } from "./usecase";

export const approvedItemAmount = async (
  owner: string,
  item: Item,
  operator: string,
  provider: ethers.Provider,
) => {
  if (isErc721Item(item.itemType) || isErc1155Item(item.itemType)) {
    // isApprovedForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
    const contract = TestERC721__factory.connect(item.token, provider);

    const isApprovedForAll = await contract.isApprovedForAll(owner, operator);
    // Setting to the max int to consolidate types and simplify
    return isApprovedForAll ? MAX_INT : 0n;
  } else if (item.itemType === ItemType.ERC20) {
    const contract = TestERC20__factory.connect(item.token, provider);

    return contract.allowance(owner, operator);
  }

  // We don't need to check approvals for native tokens
  return MAX_INT;
};

/**
 * Get approval actions given a list of insufficient approvals.
 */
export function getApprovalActions(
  insufficientApprovals: InsufficientApprovals,
  exactApproval: boolean,
  signer: Signer,
): ApprovalAction[] {
  return insufficientApprovals
    .filter(
      (approval, index) =>
        index === insufficientApprovals.length - 1 ||
        insufficientApprovals[index + 1].token !== approval.token,
    )
    .map(
      ({
        token,
        operator,
        itemType,
        identifierOrCriteria,
        requiredApprovedAmount,
      }) => {
        const isErc1155 = isErc1155Item(itemType);
        if (isErc721Item(itemType) || isErc1155) {
          // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
          const contract = TestERC721__factory.connect(token, signer);
          const transactionMethods =
            exactApproval && !isErc1155
              ? getTransactionMethods(signer, contract, "approve", [
                  operator,
                  identifierOrCriteria,
                ])
              : getTransactionMethods(signer, contract, "setApprovalForAll", [
                  operator,
                  true,
                ]);

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            operator,
            transactionMethods,
          };
        } else {
          const contract = TestERC20__factory.connect(token, signer);

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            transactionMethods: getTransactionMethods(
              signer,
              contract,
              "approve",
              [operator, exactApproval ? requiredApprovedAmount : MAX_INT],
            ),
            operator,
          };
        }
      },
    );
}
