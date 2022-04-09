import { CreateOrderAction, ExchangeAction, OrderUseCase } from "../types";

export const executeAllActions = async <
  T extends CreateOrderAction | ExchangeAction
>(
  actions: OrderUseCase<T>["actions"]
) => {
  for (let i = 0; i < actions.length - 1; i++) {
    const action = actions[i];
    if (action.type === "approval") {
      await action.transaction.transact();
    }
  }

  const finalAction = actions[actions.length - 1] as T;

  return finalAction.type === "create"
    ? await finalAction.createOrder()
    : await finalAction.transaction.transact();
};
