import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber, Contract, Overrides, providers } from "ethers";
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
 * Get approval actions given a list of insufficent approvals.
 */
export function getApprovalActions(
  insufficientApprovals: InsufficientApprovals,
  {
    signer,
  }: {
    signer: providers.JsonRpcSigner;
  }
): Promise<ApprovalAction[]> {
  return Promise.all(
    insufficientApprovals.map(
      async ({ token, operator, itemType, identifierOrCriteria }) => {
        if (isErc721Item(itemType) || isErc1155Item(itemType)) {
          // setApprovalForAll check is the same for both ERC721 and ERC1155, defaulting to ERC721
          const contract = new Contract(token, ERC721ABI, signer) as ERC721;

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            operator,
            transaction: {
              transact: (overrides: Overrides = {}) =>
                contract
                  .connect(signer)
                  .setApprovalForAll(operator, true, overrides),
              buildTransaction: (overrides: Overrides = {}) =>
                contract.populateTransaction.setApprovalForAll(
                  operator,
                  true,
                  overrides
                ),
            },
          };
        } else {
          const contract = new Contract(token, ERC20ABI, signer) as ERC20;

          return {
            type: "approval",
            token,
            identifierOrCriteria,
            itemType,
            transaction: {
              transact: (overrides: Overrides = {}) =>
                contract.connect(signer).approve(operator, MAX_INT, overrides),
              buildTransaction: (overrides: Overrides = {}) =>
                contract.populateTransaction.approve(
                  operator,
                  MAX_INT,
                  overrides
                ),
            },
            operator,
          };
        }
      }
    )
  );
}
