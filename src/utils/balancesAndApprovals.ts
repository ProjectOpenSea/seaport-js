import { providers as multicallProviders } from "@0xsequence/multicall";
import { BigNumber } from "ethers";
import { MAX_INT } from "../constants";
import { Item } from "../types";
import { approvedItemAmount } from "./approval";
import { balanceOf } from "./balance";
import { getSummedTokenAndIdentifierAmounts } from "./item";

export type BalancesAndApprovals = {
  token: string;
  identifierOrCriteria: string;
  balance: BigNumber;
  approvedAmount: BigNumber;
}[];

export const getBalancesAndApprovals = async (
  owner: string,
  items: Item[],
  operator: string,
  provider: multicallProviders.MulticallProvider
) => {
  const balancesAndApprovedAmounts = await Promise.all(
    items.map(async (item) => ({
      token: item.token,
      identifierOrCriteria: BigNumber.from(
        item.identifierOrCriteria
      ).toString(),
      balance: await balanceOf(owner, item, provider),
      approvedAmount: await approvedItemAmount(owner, item, operator, provider),
    }))
  );

  return balancesAndApprovedAmounts.map((item) => ({
    ...item,
    approvedAmount:
      // approvedAmounts are true means isApprovedForAll is true.
      // Setting to the max int to consolidate types and simplify
      item.approvedAmount === true ? MAX_INT : BigNumber.from(0),
  }));
};

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

  const filterBalancesOrApprovals = (filterKey: "balance" | "approvedAmount") =>
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

  const [insufficientBalances, insufficientApprovals] = [
    filterBalancesOrApprovals("balance"),
    filterBalancesOrApprovals("approvedAmount"),
  ];

  return {
    insufficientBalances,
    insufficientApprovals,
  };
};
