import { CallOverrides, Contract, Overrides, PayableOverrides } from "ethers";
import {
  CreateOrderAction,
  ExchangeAction,
  OrderUseCase,
  TransactionMethods,
  ContractMethodReturnType,
} from "../types";

export const executeAllActions = async <
  T extends CreateOrderAction | ExchangeAction
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

  return finalAction.type === "create"
    ? await finalAction.createOrder()
    : await finalAction.transactionMethods.transact();
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
  args: Parameters<T["functions"][U]>
): TransactionMethods<ContractMethodReturnType<T, U>> => {
  const lastArg = args[args.length - 1];

  let initialOverrides: Overrides;

  if (instanceOfOverrides(lastArg)) {
    initialOverrides = lastArg;
    args.pop();
  }

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
    transact: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contract[method as string](...args, mergedOverrides);
    },
    buildTransaction: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contract.populateTransaction[method as string](
        ...[...args, mergedOverrides]
      );
    },
  };
};
