import { expect } from "chai"
import type { ChainTimeProvider } from "./setup"
import { syncChainTimeToWallClock } from "./setup"

// Guards the fixture's clock sync. The bug it prevents is not visible in a fast
// run: the simulated chain advances one second per mined block, so over a slow
// suite chain time falls behind wall clock, and orders created with the default
// `startTime` (wall clock) land in the chain's future and get skipped as not yet
// active. Asserting on the drift directly keeps that logic honest without
// needing a slow suite to expose it.
describe("syncChainTimeToWallClock", () => {
  const stubProvider = (blockTimestamp: number | null) => {
    const calls: { method: string; params: unknown[] }[] = []

    const provider: ChainTimeProvider = {
      provider: {
        getBlock: async () =>
          blockTimestamp === null ? null : { timestamp: blockTimestamp },
        send: async (method: string, params: unknown[]) => {
          calls.push({ method, params })
          return null
        },
      },
    }

    return { provider, calls }
  }

  it("jumps the chain forward when it has drifted behind wall clock", async () => {
    const { provider, calls } = stubProvider(1_000)

    const advanced = await syncChainTimeToWallClock(provider, 1_060)

    expect(advanced).to.be.true
    expect(calls.map(call => call.method)).to.deep.equal([
      "evm_setNextBlockTimestamp",
      "evm_mine",
    ])
    expect(calls[0].params).to.deep.equal([1_060])
  })

  it("does nothing when the chain is already ahead", async () => {
    // Mining blocks pushes chain time past wall clock, which is the normal case
    // in a fast run. evm_setNextBlockTimestamp would reject a timestamp at or
    // behind the current block, so this has to be a no-op rather than a clamp.
    const { provider, calls } = stubProvider(1_100)

    expect(await syncChainTimeToWallClock(provider, 1_060)).to.be.false
    expect(calls).to.be.empty
  })

  it("does nothing when the chain is exactly at wall clock", async () => {
    const { provider, calls } = stubProvider(1_060)

    expect(await syncChainTimeToWallClock(provider, 1_060)).to.be.false
    expect(calls).to.be.empty
  })

  it("does nothing when there is no block to read", async () => {
    const { provider, calls } = stubProvider(null)

    expect(await syncChainTimeToWallClock(provider, 1_060)).to.be.false
    expect(calls).to.be.empty
  })
})
