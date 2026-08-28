import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "chai"
import * as seaportJs from "../src/index"

/**
 * The entry point is all a consumer can reach without a deep import, so
 * anything the docs hand them has to be reachable from here. seaport-js#983
 * shipped a README whose two order examples were written with `ItemType` and a
 * `fulfillOrder` doc comment that pointed readers at `getMaximumSizeForOrder`,
 * while `src/index.ts` exported only `Seaport`. Both examples failed at import
 * for anyone who copied them, and a member of the public reported it.
 *
 * These checks read the docs instead of restating them, so they keep working
 * as the docs change.
 *
 * What is covered:
 *
 * - Every named value import from `@opensea/seaport-js` written in a fenced
 *   code block in README.md is reachable from `src/index.ts`.
 * - Every identifier named in an "expose" sentence inside a JSDoc block in
 *   `src/`, where that identifier is also a top-level exported declaration
 *   somewhere in `src/`, is reachable from `src/index.ts`.
 *
 * What is NOT covered:
 *
 * - Type-only imports (`import type { … }`, or a `type X` specifier). They
 *   vanish at runtime, so a module namespace cannot be asked about them.
 *   `npm run lint` runs `tsc`, which does resolve those.
 * - Deep imports (`@opensea/seaport-js/lib/…`), which bypass the entry point
 *   by design.
 * - Member access on an imported symbol. A README that writes
 *   `ItemType.NOT_A_REAL_MEMBER` still passes, because only the import is read.
 * - Prose outside a fenced code block, and any doc-comment promise phrased
 *   without the word "expose".
 * - Docs outside README.md and `src/`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")

/** Generated output that lives under src/ but is not hand-written source. */
const GENERATED_DIRS = new Set(["artifacts", "contracts", "typechain-types"])

/**
 * Read a file with its line endings normalised.
 *
 * Every scan below is a regex over file text, and git hands Windows checkouts
 * CRLF by default. That is enough to stop a pattern anchored on \n from
 * matching at all, which leaves the checks reading an empty document.
 */
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}

const PACKAGE_NAME = (
  JSON.parse(readText(join(ROOT, "package.json"))) as {
    name: string
  }
).name

const publicExports = new Set(Object.keys(seaportJs))

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return GENERATED_DIRS.has(entry.name) ? [] : sourceFiles(full)
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : []
  })
}

const SOURCE_FILES = sourceFiles(SRC)

/**
 * Named value imports of the package written in README code fences, e.g.
 * `import { ItemType } from "@opensea/seaport-js"`.
 *
 * A whole `import type { … }` statement and an individual `type X` specifier
 * are both dropped: neither exists at runtime.
 */
function importedSymbolsIn(
  markdown: string,
): { symbol: string; statement: string }[] {
  // Normalised here as well as at the read, so the parse does not depend
  // on how the caller got hold of the text.
  const readme = markdown.replace(/\r\n/g, "\n")
  const fence = /```[a-zA-Z]*\n([\s\S]*?)```/g
  const importStatement = new RegExp(
    `import\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${escapeForRegExp(
      PACKAGE_NAME,
    )}["']`,
    "g",
  )

  const found: { symbol: string; statement: string }[] = []
  for (const [, block] of readme.matchAll(fence)) {
    for (const [statement, typeOnly, specifiers] of block.matchAll(
      importStatement,
    )) {
      if (typeOnly) {
        continue
      }
      for (const specifier of specifiers.split(",")) {
        const name = specifier
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
        if (name && !name.startsWith("type ")) {
          found.push({ symbol: name, statement: statement.trim() })
        }
      }
    }
  }
  return found
}

function readmeImportedSymbols(): { symbol: string; statement: string }[] {
  return importedSymbolsIn(readText(join(ROOT, "README.md")))
}

/** Names of top-level exported declarations anywhere under `src/`. */
function exportedDeclarations(): Set<string> {
  const declaration =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
  const reExportList = /^export\s*\{([^}]*)\}/gm

  const names = new Set<string>()
  for (const file of SOURCE_FILES) {
    const text = readText(file)
    for (const [, name] of text.matchAll(declaration)) {
      names.add(name)
    }
    for (const [, specifiers] of text.matchAll(reExportList)) {
      for (const specifier of specifiers.split(",")) {
        const parts = specifier.trim().split(/\s+as\s+/)
        const name = (parts[1] ?? parts[0] ?? "").trim().replace(/^type\s+/, "")
        if (name) {
          names.add(name)
        }
      }
    }
  }
  return names
}

/**
 * Identifiers a JSDoc block promises are exposed.
 *
 * The window read for each promise starts at the word "expose" and stops at
 * the first sentence break, the first JSDoc tag, or 200 characters, whichever
 * comes first. Only identifiers that are also top-level exported declarations
 * in `src/` count, which is what keeps ordinary English out of the result.
 */
function docCommentPromises(): {
  symbol: string
  file: string
  sentence: string
}[] {
  const exported = exportedDeclarations()
  const docBlock = /\/\*\*[\s\S]*?\*\//g
  const promise = /\bexpose[sd]?\b/gi

  const found: { symbol: string; file: string; sentence: string }[] = []
  for (const file of SOURCE_FILES) {
    for (const [block] of readText(file).matchAll(docBlock)) {
      const prose = block
        .replace(/^\s*\/\*\*|\*\/\s*$/g, " ")
        .replace(/^\s*\*/gm, " ")
        .replace(/\s+/g, " ")
        .trim()
      for (const match of prose.matchAll(promise)) {
        const rest = prose.slice(match.index)
        const stop = Math.min(
          ...[/[.;!?]\s/.exec(rest)?.index, /\s@\w/.exec(rest)?.index, 200]
            .filter(index => index !== undefined)
            .map(Number),
        )
        const sentence = rest.slice(0, stop)
        for (const [identifier] of sentence.matchAll(/[A-Za-z_$][\w$]*/g)) {
          if (exported.has(identifier)) {
            found.push({
              symbol: identifier,
              file: relative(ROOT, file),
              sentence,
            })
          }
        }
      }
    }
  }
  return found
}

describe("public exports", () => {
  it("finds the docs it is supposed to read", () => {
    // Vacuity guard. Every check below reports "nothing missing" when its
    // regex stops matching, so pin that the inputs are non-empty.
    expect(
      SOURCE_FILES.length,
      "TypeScript files under src/",
    ).to.be.greaterThan(0)
    expect(
      readmeImportedSymbols().length,
      `named imports of ${PACKAGE_NAME} in README code fences`,
    ).to.be.greaterThan(0)
    expect(
      exportedDeclarations().size,
      "exported declarations under src/",
    ).to.be.greaterThan(0)
  })

  it("reads a code fence the same on LF and on CRLF", () => {
    // git hands Windows checkouts CRLF by default, and the fence pattern is
    // anchored on a newline, so a scan written for LF alone quietly returns
    // nothing on those clones. Every check below it then passes over an empty
    // list rather than over the docs.
    const fenced = [
      "```js",
      `import { ItemType } from "${PACKAGE_NAME}";`,
      "```",
      "",
    ].join("\n")

    expect(importedSymbolsIn(fenced).map(({ symbol }) => symbol)).to.deep.equal(
      ["ItemType"],
    )
    expect(
      importedSymbolsIn(fenced.replace(/\n/g, "\r\n")).map(
        ({ symbol }) => symbol,
      ),
      "a CRLF checkout must read the same as an LF one",
    ).to.deep.equal(["ItemType"])
  })

  it("exports every symbol the README's code examples import", () => {
    const missing = readmeImportedSymbols()
      .filter(({ symbol }) => !publicExports.has(symbol))
      .map(({ symbol, statement }) => `${symbol} (README: ${statement})`)

    expect(
      missing,
      "README code examples import symbols that src/index.ts does not export, " +
        "so copying the example fails at import",
    ).to.deep.equal([])
  })

  it("exports every helper a doc comment promises is exposed", () => {
    const missing = docCommentPromises()
      .filter(({ symbol }) => !publicExports.has(symbol))
      .map(({ symbol, file, sentence }) => `${symbol} (${file}: "${sentence}")`)

    expect(
      missing,
      "a doc comment points readers at a helper that src/index.ts does not " +
        "export, so the reader cannot import it",
    ).to.deep.equal([])
  })

  it("keeps ItemType's numeric values, which the examples depend on", () => {
    // Not derivable from the docs: the README writes `ItemType.ERC721`, and
    // the number behind it is the Seaport wire value.
    expect(seaportJs.ItemType.NATIVE).to.eq(0)
    expect(seaportJs.ItemType.ERC20).to.eq(1)
    expect(seaportJs.ItemType.ERC721).to.eq(2)
    expect(seaportJs.ItemType.ERC1155).to.eq(3)
  })
})
