# Security policy

## Reporting a vulnerability

Report it through OpenSea's Bugcrowd program:

**https://bugcrowd.com/engagements/opensea**

That is the channel OpenSea's security team monitors, and it is where a report gets triaged and tracked. Please do not open a public GitHub issue, discussion, or pull request describing a vulnerability, and please hold off on public disclosure until the program has responded.

The Bugcrowd brief is the authority on what is in scope, what is excluded, how severity is assessed, and how rewards work. This file deliberately does not restate any of that, because a second copy would drift out of date and contradict the brief. Read the brief before you start.

Response and disclosure timelines are set by the program, not by this repository.

## About this repository

`@opensea/seaport-js` is a TypeScript library for the [Seaport](https://github.com/ProjectOpenSea/seaport) marketplace protocol. It builds order structs, produces the EIP-712 payload a wallet signs, runs balance and approval checks, and assembles the fulfillment calldata.

It moves assets. Code here decides what a user is asked to sign and what a transaction ends up doing, so a bug in order construction, in the approval or balance checks, in fulfillment or criteria resolution, or in the recipient and amount arithmetic can cost a user NFTs or tokens even though the library holds no funds itself. Reports in that area are worth filing carefully, with the order parameters and the resulting calldata included.

Seaport the protocol lives in a [separate repository](https://github.com/ProjectOpenSea/seaport). A bug in the contracts is not a bug in this library. Report it through the same Bugcrowd program and say which repository it affects.

## Please do not

- Test against production. Do not run exploit attempts against opensea.io, api.opensea.io, or any other OpenSea-operated service. Reproduce against a local fork, a testnet, or your own deployment.
- Run automated scanners, fuzzers, or crawlers against opensea.io or the OpenSea API. That traffic is indistinguishable from an attack, it gets blocked, and raw scanner output on its own is not a report.
- Touch accounts, wallets, or data that are not yours. Use your own.
- Attempt denial of service, spam, or social engineering against OpenSea staff, users, or infrastructure.

We cannot accept a finding that required breaking one of these to produce, however real the underlying bug is.
