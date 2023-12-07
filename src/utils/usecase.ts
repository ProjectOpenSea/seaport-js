import {
  BaseContract,
  ContractTransaction,
  Overrides,
  TransactionResponse,
  keccak256,
  toUtf8Bytes,
} from "ethers";

import {
  CreateBulkOrdersAction,
  CreateOrderAction,
  ExchangeAction,
  OrderUseCase,
} from "../types";
import {
  DefaultReturnType,
  TypedContractMethod,
} from "../typechain-types/common";

export const executeAllActions = async <
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction,
>(
  actions: OrderUseCase<T>["actions"],
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

const instanceOfOverrides = <T extends Overrides>(
  obj: Object | undefined,
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
    "overrides",
  ];

  return (
    obj === undefined ||
    (Object.keys(obj).length > 0 &&
      Object.keys(obj).every((key) => validKeys.includes(key)))
  );
};

export type ContractMethodReturnType<
  T extends BaseContract,
  U extends keyof T,
> = Awaited<ReturnType<T[U] extends TypedContractMethod ? T[U] : never>>;

export type TransactionMethods<T = unknown> = {
  buildTransaction: (overrides?: Overrides) => Promise<ContractTransaction>;
  staticCall: (overrides?: Overrides) => Promise<DefaultReturnType<T>>;
  staticCallResult: (overrides?: Overrides) => Promise<T>;
  estimateGas: (overrides?: Overrides) => Promise<bigint>;
  transact: (overrides?: Overrides) => Promise<TransactionResponse>;
};

export const getTransactionMethods = <
  T extends BaseContract,
  U extends keyof T,
>(
  contract: T,
  method: U,
  args: any, //T[U] extends TypedContractMethod ? Parameters<T[U]> : never,
  domain?: string,
): any => {
  const lastArg = args[args.length - 1];

  let initialOverrides: Overrides;

  if (instanceOfOverrides(lastArg)) {
    initialOverrides = lastArg;
    args.pop();
  }

  const contractMethod = contract[method] as T[U] extends TypedContractMethod
    ? T[U]
    : never;

  const buildTransaction = async (overrides?: Overrides) => {
    const mergedOverrides = { ...initialOverrides, ...overrides };
    const populatedTransaction = await contractMethod.populateTransaction(
      ...[...args, mergedOverrides],
    );

    if (domain) {
      const tag = getTagFromDomain(domain);
      populatedTransaction.data = populatedTransaction.data + tag;
    }

    return populatedTransaction;
  };

  return {
    staticCall: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contractMethod.staticCall(...[...args, mergedOverrides]);
    },
    staticCallResult: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contractMethod.staticCallResult(...[...args, mergedOverrides]);
    },
    estimateGas: (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      return contractMethod.estimateGas(...[...args, mergedOverrides]);
    },
    transact: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };

      const data = await buildTransaction(mergedOverrides);

      if (!contract.runner?.sendTransaction) {
        throw new Error(
          "Missing connected runner (provider or signer) for contract",
        );
      }

      return contract.runner.sendTransaction(data);
    },
    buildTransaction,
  };
};

export const getTagFromDomain = (domain: string) => {
  return keccak256(toUtf8Bytes(domain)).slice(2, 10);
};
