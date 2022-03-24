import * as t from "typed-assert";

export const isExactlyTrue: t.Assert<unknown, true> = (input) =>
  t.assert(input === true);

export const isExactlyNotTrue: t.Assert<unknown, false> = (input) =>
  t.assert(input !== true);
