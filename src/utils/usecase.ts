import {
  BigNumber,
  CallOverrides,
  Contract,
  Overrides,
  PayableOverrides,
  PopulatedTransaction,
  Signer,
} from "ethers";
import { providers } from "ethers";
import {
  accessListify,
  arrayify,
  getAddress,
  FunctionFragment,
  Logger,
  resolveProperties,
  shallowCopy,
} from "ethers/lib/utils";
import { version } from "ethers";

import {
  CreateOrderAction,
  ExchangeAction,
  OrderUseCase,
  TransactionMethods,
  ContractMethodReturnType,
} from "../types";

const logger = new Logger(version);

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
  args: Parameters<T["functions"][U]>,
  suffix?: string
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
        contract,
        [args],
        suffix
      );
    },
  };
};

async function populateTransaction(
  contract: Contract,
  fragment: FunctionFragment,
  args: Array<any>,
  suffix: string
): Promise<PopulatedTransaction> {
  // // If an extra argument is given, it is overrides
  // let overrides: CallOverrides = {};
  // if (
  //   args.length === fragment.inputs.length + 1 &&
  //   typeof args[args.length - 1] === "object"
  // ) {
  //   overrides = shallowCopy(args.pop());
  // }

  // Make sure the parameter count matches
  logger.checkArgumentCount(
    args.length,
    fragment.inputs.length,
    "passed to contract"
  );

  // Populate "from" override (allow promises)
  // if (contract.signer) {
  //   if (overrides.from) {
  //     // Contracts with a Signer are from the Signer's frame-of-reference;
  //     // but we allow overriding "from" if it matches the signer
  //     overrides.from = resolveProperties({
  //       override: resolveName(contract.signer, overrides.from),
  //       signer: contract.signer.getAddress(),
  //     }).then(async (check) => {
  //       if (getAddress(check.signer) !== check.override) {
  //         logger.throwError(
  //           "Contract with a Signer cannot override from",
  //           Logger.errors.UNSUPPORTED_OPERATION,
  //           {
  //             operation: "overrides.from",
  //           }
  //         );
  //       }

  //       return check.override;
  //     });
  //   } else {
  //     overrides.from = contract.signer.getAddress();
  //   }
  // } else if (overrides.from) {
  //   overrides.from = resolveName(contract.provider, overrides.from);

  //   //} else {
  //   // Contracts without a signer can override "from", and if
  //   // unspecified the zero address is used
  //   //overrides.from = AddressZero;
  // }

  // // Wait for all dependencies to be resolved (prefer the signer over the provider)
  // const resolved = await resolveProperties({
  //   args: resolveAddresses(
  //     contract.signer || contract.provider,
  //     args,
  //     fragment.inputs
  //   ),
  //   address: contract.resolvedAddress,
  //   overrides: resolveProperties(overrides) || {},
  // });

  // The ABI coded transaction
  const data = contract.interface.encodeFunctionData(fragment, args) + suffix;
  console.log("data: ", data);
  const tx: PopulatedTransaction = {
    data: data,
    to: contract.address,
  };

  // Resolved Overrides
  // const ro = resolved.overrides;

  // // Populate simple overrides
  // if (ro.nonce != null) {
  //   tx.nonce = BigNumber.from(ro.nonce).toNumber();
  // }
  // if (ro.gasLimit != null) {
  //   tx.gasLimit = BigNumber.from(ro.gasLimit);
  // }
  // if (ro.gasPrice != null) {
  //   tx.gasPrice = BigNumber.from(ro.gasPrice);
  // }
  // if (ro.maxFeePerGas != null) {
  //   tx.maxFeePerGas = BigNumber.from(ro.maxFeePerGas);
  // }
  // if (ro.maxPriorityFeePerGas != null) {
  //   tx.maxPriorityFeePerGas = BigNumber.from(ro.maxPriorityFeePerGas);
  // }
  // if (ro.from != null) {
  //   tx.from = ro.from;
  // }

  // if (ro.type != null) {
  //   tx.type = ro.type;
  // }
  // if (ro.accessList != null) {
  //   tx.accessList = accessListify(ro.accessList);
  // }

  // // If there was no "gasLimit" override, but the ABI specifies a default, use it
  // if (tx.gasLimit == null && fragment.gas != null) {
  //   // Compute the intrinsic gas cost for this transaction
  //   // @TODO: This is based on the yellow paper as of Petersburg; this is something
  //   // we may wish to parameterize in v6 as part of the Network object. Since this
  //   // is always a non-nil to address, we can ignore G_create, but may wish to add
  //   // similar logic to the ContractFactory.
  //   let intrinsic = 21000;
  //   const bytes = arrayify(data);
  //   for (let i = 0; i < bytes.length; i++) {
  //     intrinsic += 4;
  //     if (bytes[i]) {
  //       intrinsic += 64;
  //     }
  //   }
  //   tx.gasLimit = BigNumber.from(fragment.gas).add(intrinsic);
  // }

  // Populate "value" override
  // if (ro.value) {
  //   const roValue = BigNumber.from(ro.value);
  //   if (!roValue.isZero() && !fragment.payable) {
  //     logger.throwError(
  //       "non-payable method cannot override value",
  //       Logger.errors.UNSUPPORTED_OPERATION,
  //       {
  //         operation: "overrides.value",
  //         value: overrides.value,
  //       }
  //     );
  //   }
  //   tx.value = roValue;
  // }

  // if (ro.customData) {
  //   tx.customData = shallowCopy(ro.customData);
  // }

  // if (ro.ccipReadEnabled) {
  //   tx.ccipReadEnabled = !!ro.ccipReadEnabled;
  // }

  // // Remove the overrides
  // delete overrides.nonce;
  // delete overrides.gasLimit;
  // delete overrides.gasPrice;
  // delete overrides.from;
  // delete overrides.value;

  // delete overrides.type;
  // delete overrides.accessList;

  // delete overrides.maxFeePerGas;
  // delete overrides.maxPriorityFeePerGas;

  // delete overrides.customData;
  // delete overrides.ccipReadEnabled;

  // Make sure there are no stray overrides, which may indicate a
  // // typo or using an unsupported key.
  // const leftovers = Object.keys(overrides).filter(
  //   (key) => (<any>overrides)[key] != null
  // );
  // if (leftovers.length) {
  //   logger.throwError(
  //     `cannot override ${leftovers.map((l) => JSON.stringify(l)).join(",")}`,
  //     Logger.errors.UNSUPPORTED_OPERATION,
  //     {
  //       operation: "overrides",
  //       overrides: leftovers,
  //     }
  //   );
  // }

  return tx;
}
