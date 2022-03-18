import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber } from "ethers";
import { MAX_INT } from "../constants";
import { Consideration } from "../typechain";
import { Item } from "../types";
import { approvedItemAmount } from "./approval";
import { balanceOf } from "./balance";
import {
  getSummedTokenAndIdentifierAmounts,
  isErc1155Item,
  isErc20Item,
  isErc721Item,
} from "./item";

export type BalancesAndApprovals = {
  token: string;
  identifierOrCriteria: string;
  balance: BigNumber;
  ownerApprovedAmount: BigNumber;
  proxyApprovedAmount: BigNumber;
}[];

export const getBalancesAndApprovals = async (
  owner: string,
  items: Item[],
  {
    considerationContract,
    proxy,
    multicallProvider,
  }: {
    considerationContract: Consideration;
    proxy?: string;
    multicallProvider: multicallProviders.MulticallProvider;
  }
) =>
  Promise.all(
    items.map(async (item) => {
      let ownerApprovedAmountPromise = Promise.resolve(BigNumber.from(0));
      let proxyApprovedAmountPromise = Promise.resolve(BigNumber.from(0));

      // If erc721 or erc1155 check both consideration and proxy approvals unless config says ignore proxy
      if (isErc721Item(item) || isErc1155Item(item)) {
        ownerApprovedAmountPromise = approvedItemAmount(
          owner,
          item,
          considerationContract.address,
          multicallProvider
        );

        if (proxy) {
          proxyApprovedAmountPromise = approvedItemAmount(
            owner,
            item,
            proxy,
            multicallProvider
          );
        }
      }
      // If erc20 check just consideration contract for approvals
      else if (isErc20Item(item)) {
        ownerApprovedAmountPromise = approvedItemAmount(
          owner,
          item,
          considerationContract.address,
          multicallProvider
        );
      }
      // If native token, we don't need to check for approvals
      else {
        ownerApprovedAmountPromise = Promise.resolve(MAX_INT);
        proxyApprovedAmountPromise = Promise.resolve(MAX_INT);
      }

      return {
        token: item.token,
        identifierOrCriteria: BigNumber.from(
          item.identifierOrCriteria
        ).toString(),
        balance: await balanceOf(owner, item, multicallProvider),
        ownerApprovedAmount: await ownerApprovedAmountPromise,
        proxyApprovedAmount: await proxyApprovedAmountPromise,
      };
    })
  );

export const getInsufficientBalanceAndApprovalAmounts = (
  balancesAndApprovals: BalancesAndApprovals,
  tokenAndIdentifierAmounts: ReturnType<
    typeof getSummedTokenAndIdentifierAmounts
  >
) => {
  const tokenAndIdentifierAndAmountNeeded = [
    ...Object.entries(tokenAndIdentifierAmounts).map(
      ([token, identifierToAmount]) =>
        Object.entries(identifierToAmount).map(
          ([identifierOrCriteria, amountNeeded]) =>
            [token, identifierOrCriteria, amountNeeded] as const
        )
    ),
  ].flat();

  const findBalanceAndApproval = (
    token: string,
    identifierOrCriteria: string
  ) => {
    const balanceAndApproval = balancesAndApprovals.find(
      ({
        token: checkedToken,
        identifierOrCriteria: checkedIdentifierOrCriteria,
      }) =>
        token.toLowerCase() === checkedToken.toLowerCase() &&
        checkedIdentifierOrCriteria.toLowerCase() ===
          identifierOrCriteria.toLowerCase()
    );

    if (!balanceAndApproval) {
      throw new Error(
        "Balances and approvals didn't contain all tokens and identifiers"
      );
    }

    return balanceAndApproval;
  };

  const filterBalancesOrApprovals = (
    filterKey: "balance" | "ownerApprovedAmount" | "proxyApprovedAmount"
  ) =>
    tokenAndIdentifierAndAmountNeeded
      .filter(([token, identifierOrCriteria, amountNeeded]) =>
        findBalanceAndApproval(token, identifierOrCriteria)[filterKey].lt(
          amountNeeded
        )
      )
      .map(([token, identifierOrCriteria, amount]) => ({
        token,
        identifierOrCriteria,
        amountNeeded: amount,
        amountHave: findBalanceAndApproval(token, identifierOrCriteria)[
          filterKey
        ],
      }));

  const [
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  ] = [
    filterBalancesOrApprovals("balance"),
    filterBalancesOrApprovals("ownerApprovedAmount"),
    filterBalancesOrApprovals("proxyApprovedAmount"),
  ];

  return {
    insufficientBalances,
    insufficientOwnerApprovals,
    insufficientProxyApprovals,
  };
};
