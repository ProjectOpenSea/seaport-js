import {
  CreateOrderActions,
  OrderExchangeActions,
  OrderUseCase,
} from "../types";

export const executeAllActions = async <
  T = CreateOrderActions | OrderExchangeActions
>(
  genActions: OrderUseCase<T>["genActions"]
) => {
  const actions = await genActions();

  let action = await actions.next();

  while (!action.done) {
    console.log(action);
    action = await actions.next();
  }

  if (action.value.type === "create") {
    return action.value.order;
  }

  return action.value.transaction;
};
