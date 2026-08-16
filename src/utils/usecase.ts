import {
  type BaseContract,
  type ContractTransaction,
  keccak256,
  type Overrides,
  type Signer,
  type TransactionResponse,
  toUtf8Bytes,
} from "ethers"
import type {
  DefaultReturnType,
  TypedContractMethod,
} from "../typechain-types/common"
import type {
  CreateBulkOrdersAction,
  CreateOrderAction,
  ExchangeAction,
  OrderUseCase,
} from "../types"

/**
 * Sends every approval transaction in a use case and waits for its receipt,
 * without performing the use case's final action.
 *
 * Useful when the offerer approves an order onchain instead of by signature,
 * for example through Seaport's `validate()`. A smart contract account may not
 * be able to produce an offchain signature at all, so requesting one in order
 * to build the order is a hard blocker rather than just a wasted prompt. Pair
 * this with the create action's `orderComponents` to get a ready-to-validate
 * order without any signature request.
 *
 * Approvals run sequentially because they are transactions from a single
 * account and take consecutive nonces.
 *
 * Note that this grants the approvals and then stops, so abandoning the flow
 * afterwards leaves them standing with no order behind them. With the default
 * `exactApproval: false` an ERC721/ERC1155 approval is `setApprovalForAll`,
 * which is collection-wide. Callers who may not go on to create or fulfill
 * should prefer `exactApproval: true`, or revoke afterwards.
 */
export const executeApprovals = async <
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction,
>(
  actions: OrderUseCase<T>["actions"],
) => {
  for (let i = 0; i < actions.length - 1; i++) {
    const action = actions[i]
    if (action.type === "approval") {
      const tx = await action.transactionMethods.transact()
      await tx.wait()
    }
  }
}

export const executeAllActions = async <
  T extends CreateOrderAction | CreateBulkOrdersAction | ExchangeAction,
>(
  actions: OrderUseCase<T>["actions"],
) => {
  await executeApprovals(actions)

  const finalAction = actions[actions.length - 1] as T

  switch (finalAction.type) {
    case "create":
      return finalAction.createOrder()
    case "createBulk":
      return finalAction.createBulkOrders()
    default:
      return finalAction.transactionMethods.transact()
  }
}

const instanceOfOverrides = <T extends Overrides>(
  obj: object | undefined,
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
  ]

  if (obj === undefined) {
    return true
  }

  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return false
  }

  return Object.keys(obj).every(key => validKeys.includes(key))
}

export type ContractMethodReturnType<
  T extends BaseContract,
  U extends keyof T,
> = T[U] extends TypedContractMethod<any, infer Output, any> ? Output : never

export type TransactionMethods<T = unknown> = {
  buildTransaction: (overrides?: Overrides) => Promise<ContractTransaction>
  staticCall: (overrides?: Overrides) => Promise<DefaultReturnType<T>>
  estimateGas: (overrides?: Overrides) => Promise<bigint>
  transact: (overrides?: Overrides) => Promise<TransactionResponse>
}

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
  let initialOverrides: Overrides
  if (args?.length > 0) {
    const lastArg = args[args.length - 1]
    if (instanceOfOverrides(lastArg)) {
      initialOverrides = lastArg
      args.pop()
    }
  }

  const contractMethod = async (signer: Signer | Promise<Signer>) =>
    (contract.connect(await signer) as T)[
      method
    ] as T[U] extends TypedContractMethod ? T[U] : never

  const buildTransaction = async (overrides?: Overrides) => {
    const mergedOverrides = { ...initialOverrides, ...overrides }
    const method = await contractMethod(signer)
    const populatedTransaction = await method.populateTransaction(
      ...[...args, mergedOverrides],
    )

    if (domain) {
      const tag = getTagFromDomain(domain)
      populatedTransaction.data = populatedTransaction.data + tag
    }

    return populatedTransaction
  }

  return {
    staticCall: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides }
      const mergedArgs = [...args, mergedOverrides]
      const method = await contractMethod(signer)
      return method.staticCall(...mergedArgs)
    },
    estimateGas: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides }

      // With a domain, `transact` sends the calldata that `buildTransaction`
      // produces, which carries a four byte tag the encoded arguments do not.
      // Estimating off the arguments alone leaves out the calldata cost of
      // that tag, so the estimate lands below what the transaction actually
      // needs and is unusable as a gas limit. Estimate the transaction that
      // will really be sent instead.
      if (domain) {
        return (await signer).estimateGas(
          await buildTransaction(mergedOverrides),
        )
      }

      const mergedArgs = [...args, mergedOverrides]
      const method = await contractMethod(signer)
      return method.estimateGas(...mergedArgs)
    },
    transact: async (overrides?: Overrides) => {
      const mergedOverrides = { ...initialOverrides, ...overrides }
      const data = await buildTransaction(mergedOverrides)
      return (await signer).sendTransaction(data)
    },
    buildTransaction,
  }
}

export const getTagFromDomain = (domain: string) => {
  return keccak256(toUtf8Bytes(domain)).slice(2, 10)
}
