# Seaport.js

[Seaport](https://github.com/ProjectOpenSea/seaport) is a new marketplace protocol for safely and efficiently buying and selling NFTs. This is a JavaScript library intended to make interfacing with the contract reasonable and easy.

- [Synopsis](#synopsis)
- [Installation](#installation)
- [Getting Started](#getting-started)
  - [Use Cases](#use-cases)
- [Contributing](#contributing)

## Synopsis

This is a JavaScript library to help interface with Seaport. It includes various helper methods and constants that makes interfacing with Seaport easier. These include creating orders, fulfilling orders, doing the necessary balance and approval checks, and more. We recommend taking a look at the [Seaport](https://github.com/ProjectOpenSea/seaport) docs to get a better understanding of how the Seaport marketplace works.

## Installation

We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions. Execute `nvm use`, if you have `nvm` installed.

Then, in your project, run:

```
npm install --save @opensea/seaport-js
```

## Getting Started

Instantiate your instance of seaport using your ethers provider:

```JavaScript
import { Seaport } from "@opensea/seaport-js";

const provider = ethers.getDefaultProvider();

const seaport = new Seaport(provider);
```

Look at the relevant definitions in `seaport.ts` in order to see the different functionality this library offers.

### Use Cases

Many of the main core flows return _use cases_. What this means is that if you were to create an order (a la `createOrder`), the library helps perform the necessary balance and approval checks based on the `offer` of the order being created. If the `offerer` requires approvals on one asset contract, the `actions` field of the use case would contain an approval action that the user should execute first in order for the trade to succeed in the future.

## Contributing

See [the contributing guide](CONTRIBUTING.md) for detailed instructions on how to get started with this project.
