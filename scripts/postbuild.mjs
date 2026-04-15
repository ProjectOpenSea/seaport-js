import { writeFileSync } from "node:fs";

// The root package.json declares "type": "module" for Hardhat v3 compatibility,
// but tsconfig.build.json compiles to CommonJS for backward compatibility with
// CJS consumers. This marker tells Node to treat lib/*.js files as CommonJS.
writeFileSync(
  "lib/package.json",
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);
