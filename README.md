<p align="center">
  <img src="./img/banner.png" />
</p>

[![Version][version-badge]][version-link]
[![npm][npm-badge]][npm-link]
[![Test CI][ci-badge]][ci-link]
[![Code Coverage][coverage-badge]][coverage-link]
[![License][license-badge]][license-link]
[![Docs][docs-badge]][docs-link]
[![Discussions][discussions-badge]][discussions-link]

# Seaport.js

[Seaport][seaport-link] is a new marketplace protocol for safely and efficiently buying and selling NFTs. This is a TypeScript library intended to make interfacing with the contract reasonable and easy.

- [Synopsis](#synopsis)
- [Installation](#installation)
- [Getting Started](#getting-started)
  - [Use Cases](#use-cases)
- [Contributing](#contributing)

## Synopsis

This is a TypeScript library to help interface with Seaport. It includes various helper methods and constants that makes interfacing with Seaport easier. These include creating orders, fulfilling orders, doing the necessary balance and approval checks, and more. We recommend taking a look at the [Seaport][seaport-link] docs to get a better understanding of how the Seaport marketplace works.

## Installation

We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions. Execute `nvm use`, if you have `nvm` installed.

Then, in your project, run:

```console
npm install --save @opensea/seaport-js
```

## Getting Started

Instantiate your instance of seaport using your ethers provider:

### Examples

#### Through a browser provider (i.e. Metamask)

```js
import { Seaport } from "@opensea/seaport-js";
import { ethers } from "ethers";

const provider = new ethers.BrowserProvider(window.ethereum);

const seaport = new Seaport(provider);
```

#### Through a RPC Provider (i.e. Alchemy)

```js
import { Seaport } from "@opensea/seaport-js";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(
  "https://<network>.alchemyapi.io/v2/YOUR-API-KEY",
);

const seaport = new Seaport(provider);
```

#### With custom signer

```js
import { Seaport } from "@opensea/seaport-js";
import { ethers } from "ethers";

// Provider must be provided to the signer when supplying a custom signer
const provider = new ethers.JsonRpcProvider(
  "https://<network>.alchemyapi.io/v2/YOUR-API-KEY",
);

const signer = new ethers.Wallet("YOUR_PK", provider);

const seaport = new Seaport(signer);
```

Look at the relevant definitions in `seaport.ts` in order to see the different functionality this library offers.

### Use Cases

Many of the main core flows return _use cases_. What this means is that if you were to create an order (a la `createOrder`), the library helps perform the necessary balance and approval checks based on the `offer` of the order being created. If the `offerer` requires approvals on one asset contract, the `actions` field of the use case would contain an approval action that the user should execute first in order for the trade to succeed in the future.

### Examples

#### Listing an ERC-721 for 10 ETH and fulfilling it

```js
const offerer = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const fulfiller = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const { executeAllActions } = await seaport.createOrder(
  {
    offer: [
      {
        itemType: ItemType.ERC721,
        token: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e",
        identifier: "1",
      },
    ],
    consideration: [
      {
        amount: ethers.parseEther("10").toString(),
        recipient: offerer,
      },
    ],
  },
  offerer,
);

const order = await executeAllActions();

const { executeAllActions: executeAllFulfillActions } =
  await seaport.fulfillOrder({
    order,
    accountAddress: fulfiller,
  });

const transaction = executeAllFulfillActions();
```

#### Making an offer for an ERC-721 for 10 WETH and fulfilling it

```js
const offerer = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const fulfiller = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const { executeAllActions } = await seaport.createOrder(
  {
    offer: [
      {
        amount: parseEther("10").toString(),
        // WETH
        token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      },
    ],
    consideration: [
      {
        itemType: ItemType.ERC721,
        token: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e",
        identifier: "1",
        recipient: offerer,
      },
    ],
  },
  offerer,
);

const order = await executeAllActions();

const { executeAllActions: executeAllFulfillActions } =
  await seaport.fulfillOrder({
    order,
    accountAddress: fulfiller,
  });

const transaction = executeAllFulfillActions();
```

## Contributing

See [the contributing guide](./.github/CONTRIBUTING.md) for detailed instructions on how to get started with this project.

## License

[MIT](LICENSE) Copyright 2022 Ozone Networks, Inc.

[seaport-link]: https://github.com/ProjectOpenSea/seaport
[version-badge]: https://img.shields.io/github/package-json/v/ProjectOpenSea/seaport-js
[version-link]: https://github.com/ProjectOpenSea/seaport-js/releases
[npm-badge]: https://img.shields.io/npm/v/@opensea/seaport-js?color=red
[npm-link]: https://www.npmjs.com/package/@opensea/seaport-js
[ci-badge]: https://github.com/ProjectOpenSea/seaport-js/actions/workflows/main.yaml/badge.svg
[ci-link]: https://github.com/ProjectOpenSea/seaport-js/actions/workflows/main.yaml
[coverage-badge]: https://codecov.io/gh/ProjectOpenSea/seaport-js/branch/main/graph/badge.svg
[coverage-link]: https://codecov.io/gh/ProjectOpenSea/seaport-js
[license-badge]: https://img.shields.io/github/license/ProjectOpenSea/seaport-js
[license-link]: https://github.com/ProjectOpenSea/seaport-js/blob/main/LICENSE
[docs-badge]: https://img.shields.io/badge/Seaport.js-documentation-informational
[docs-link]: https://github.com/ProjectOpenSea/seaport-js/blob/main/README.md#getting-started
[discussions-badge]: https://img.shields.io/badge/Seaport.js-discussions-blueviolet
[discussions-link]: https://github.com/ProjectOpenSea/seaport-js/discussions
