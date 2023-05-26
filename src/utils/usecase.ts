import { CallOverrides, Contract, Overrides, PayableOverrides } from "ethers";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";

import {
  CreateBulkOrdersAction,
  CreateOrderAction,
  ExchangeAction,
  OrderUseCase,
  TransactionMethods,
  ContractMethodReturnType,
} from "../types";

export const executeAllActions = async <
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction
>(
  actions: OrderUseCase<T>["actions"]
) => {
  for (let i = 0; i < actions.length - 1; i++) {
    const action = actions[i];
    if (action.type === "approval") {
      const tx = await action.transactionMethods.transact();
      await tx.wait();
    }
  }

  const finalAction = actions[actions.length - 1] as T;

  switch (finalAction.type) {
    case "create":
      return finalAction.createOrder();
    case "createBulk":
      return finalAction.createBulkOrders();
    default:
      return finalAction.transactionMethods.transact();
  }
};

const instanceOfOverrides = <
  T extends Overrides | PayableOverrides | CallOverrides
>(
  obj: Object | undefined
): obj is T => {
  const validKeys = [
    "gasLimit",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "type",
    "accessList",
    "customData",
    "ccipReadEnabled",
    "value",
    "blockTag",
    "CallOverrides",
  ];

  return (
    obj === undefined ||
    Object.keys(obj).every((key) => validKeys.includes(key))
  );
};

export const getTransactionMethods = <
  T extends Contract,
  U extends keyof T["functions"]
>(
  contract: T,
  method: U,
  args: Parameters<T["functions"][U]>,
  domain?: string
): TransactionMethods<ContractMethodReturnType<T, U>> => {
  const lastArg = args[args.length - 1];

  let initialOverrides: Overrides;

  if (instanceOfOverrides(lastArg)) {
    initialOverrides = lastArg;
    args.pop();
  }

  const buildTransaction = async (overrides?: Overrides) => {
    const mergedOverrides = { ...initialOverrides, ...overrides };
    const populatedTransaction = await contract.populateTransaction[
      method as string
    ](...[...args, mergedOverrides]);

    if (domain) {
      const tag = getTagFromDomain(domain);
      populatedTransaction.data = populatedTransaction.data + tag;
    }

    return populatedTransaction;
  };

  return {
    callStatic: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contract.callStatic[method as string](
        ...[...args, mergedOverrides]
      );
    },
    estimateGas: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contract.estimateGas[method as string](
        ...[...args, mergedOverrides]
      );
    },
    transact: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      const data = await buildTransaction(mergedOverrides);

      return contract.signer.sendTransaction(data);
    },
    buildTransaction,
  };
};

export const getTagFromDomain = (domain: string) => {
  return keccak256(toUtf8Bytes(domain)).slice(2, 10);
};
