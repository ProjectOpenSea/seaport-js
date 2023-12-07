import {
  BaseContract,
  ContractTransaction,
  Overrides,
  Signer,
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
> = T[U] extends TypedContractMethod<any, infer Output, any> ? Output : never;

export type TransactionMethods<T = unknown> = {
  buildTransaction: (overrides?: Overrides) => Promise<ContractTransaction>;
  staticCall: (overrides?: Overrides) => Promise<DefaultReturnType<T>>;
  estimateGas: (overrides?: Overrides) => Promise<bigint>;
  transact: (overrides?: Overrides) => Promise<TransactionResponse>;
};

export const getTransactionMethods = <
  T extends BaseContract,
  U extends keyof T,
>(
  signer: Signer | Promise<Signer>,
  contract: T,
  method: U,
  args: T[U] extends TypedContractMethod<infer Args, any, any>
    ? Args | [...Args, Overrides | undefined]
    : never,
  domain?: string,
): TransactionMethods<ContractMethodReturnType<T, U>> => {
  let initialOverrides: Overrides;
  if (args?.length > 0) {
    const lastArg = args[args.length - 1];
    if (instanceOfOverrides(lastArg)) {
      initialOverrides = lastArg;
      args.pop();
    }
  }

  const contractMethod = async (signer: Signer | Promise<Signer>) =>
    (contract.connect(await signer) as T)[
      method
    ] as T[U] extends TypedContractMethod ? T[U] : never;

  const buildTransaction = async (overrides?: Overrides) => {
    const mergedOverrides = { ...initialOverrides, ...overrides };
    const method = await contractMethod(signer);
    const populatedTransaction = await method.populateTransaction(
      ...[...args, mergedOverrides],
    );

    if (domain) {
      const tag = getTagFromDomain(domain);
      populatedTransaction.data = populatedTransaction.data + tag;
    }

    return populatedTransaction;
  };

  return {
    staticCall: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };
      const mergedArgs = [...args, mergedOverrides];
      const method = await contractMethod(signer);
      return method.staticCall(...mergedArgs);
    },
    estimateGas: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };
      const mergedArgs = [...args, mergedOverrides];
      const method = await contractMethod(signer);
      return method.estimateGas(...mergedArgs);
    },
    transact: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides };
      const data = await buildTransaction(mergedOverrides);
      return (await signer).sendTransaction(data);
    },
    buildTransaction,
  };
};

export const getTagFromDomain = (domain: string) => {
  return keccak256(toUtf8Bytes(domain)).slice(2, 10);
};
