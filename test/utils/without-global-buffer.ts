/**
 * Runs `fn` with the Node-only `Buffer` global removed, which is what a browser
 * bundle sees. Bundlers can alias the `buffer` *module* to a polyfill, which is
 * what keeps merkletreejs working, but none of them define `globalThis.Buffer`,
 * so any library code reaching for the global throws `ReferenceError` in a page
 * while passing every test in Node.
 *
 * `fn` must be synchronous. The global is missing for the whole call, so letting
 * the event loop run in the middle would expose unrelated code to its absence.
 */
export const withoutGlobalBuffer = <T>(fn: () => T): T => {
  const global = globalThis as { Buffer?: unknown }
  const saved = global.Buffer

  delete global.Buffer
  try {
    return fn()
  } finally {
    global.Buffer = saved
  }
}
