import { Consideration } from "../typechain";

export type ConsiderationConfig = {
  overrides?: {
    contractAddress: string;
  };
};

export type OrderParameters = Parameters<
  Consideration["validate"]
>[0][0]["parameters"];
