import { ContractTransaction } from "ethers";
import {
  CreatedOrder,
  CreateOrderAction,
  CreateOrderActions,
  ExchangeAction,
  OrderExchangeActions,
  OrderUseCase,
} from "../types";

export const executeAllActions = async <
  T extends CreateOrderAction | ExchangeAction
>(
  actions: OrderUseCase<T>["actions"]
) => {
  for (let i = 0; i < actions.length - 1; i++) {
    const action = actions[i];
    if (action.type === "approval") {
      await action.transactionDetails.send();
    }
  }

  const finalAction = actions[actions.length - 1] as T;

  return finalAction.type === "create"
    ? finalAction.order
    : await finalAction.transactionDetails.send();
};
