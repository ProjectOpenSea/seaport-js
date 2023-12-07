import { ethers, zeroPadValue, TypedDataField } from "ethers";

const baseDefaults: Record<string, any> = {
  integer: 0,
  address: ethers.zeroPadValue("0x", 20),
  bool: false,
  bytes: "0x",
  string: "",
};

const isNullish = (value: any): boolean => {
  if (value === undefined) return false;

  return (
    value !== undefined &&
    value !== null &&
    ((["string", "number"].includes(typeof value) && BigInt(value) === 0n) ||
      (Array.isArray(value) && value.every(isNullish)) ||
      (typeof value === "object" && Object.values(value).every(isNullish)) ||
      (typeof value === "boolean" && value === false))
  );
};

function getDefaultForBaseType(type: string): any {
  // bytesXX
  const [, width] = type.match(/^bytes(\d+)$/) ?? [];
  if (width) return zeroPadValue("0x", parseInt(width));

  if (type.match(/^(u?)int(\d*)$/)) type = "integer";

  return baseDefaults[type];
}

export type EIP712TypeDefinitions = Record<string, TypedDataField[]>;

type DefaultMap<T extends EIP712TypeDefinitions> = {
  [K in keyof T]: any;
};

export class DefaultGetter<Types extends EIP712TypeDefinitions> {
  defaultValues: DefaultMap<Types> = {} as DefaultMap<Types>;

  constructor(protected types: Types) {
    for (const name in types) {
      const defaultValue = this.getDefaultValue(name);
      this.defaultValues[name] = defaultValue;
      if (!isNullish(defaultValue)) {
        throw new Error(
          `Got non-empty value for type ${name} in default generator: ${defaultValue}`,
        );
      }
    }
  }

  /* eslint-disable no-dupe-class-members */
  static from<Types extends EIP712TypeDefinitions>(
    types: Types,
  ): DefaultMap<Types>;

  static from<Types extends EIP712TypeDefinitions>(
    types: Types,
    type: keyof Types,
  ): any;

  static from<Types extends EIP712TypeDefinitions>(
    types: Types,
    type?: keyof Types,
  ): DefaultMap<Types> {
    const { defaultValues } = new DefaultGetter(types);
    if (type) return defaultValues[type];
    return defaultValues;
  }
  /* eslint-enable no-dupe-class-members */

  getDefaultValue(type: string): any {
    if (this.defaultValues[type]) return this.defaultValues[type];
    // Basic type (address, bool, uint256, etc)
    const basic = getDefaultForBaseType(type);
    if (basic !== undefined) return basic;

    // Array
    const match = type.match(/^(.*)(\x5b(\d*)\x5d)$/);
    if (match) {
      const subtype = match[1];
      const length = parseInt(match[3]);
      if (length > 0) {
        const baseValue = this.getDefaultValue(subtype);
        return Array(length).fill(baseValue);
      }
      return [];
    }

    // Struct
    const fields = this.types[type];
    if (fields) {
      return fields.reduce(
        (obj, { name, type }) => ({
          ...obj,
          [name]: this.getDefaultValue(type),
        }),
        {},
      );
    }

    throw new Error(`unknown type: ${type}`);
  }
}
