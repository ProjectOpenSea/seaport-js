# Contributing

## Installation

We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions. Execute `nvm use`, if you have `nvm` installed.

We currently use [yarn](https://yarnpkg.com/getting-started/install) to manage dependencies.

Then, run `yarn` after `yarn` is installed

In order to enable pre-commit hooks, install husky:

`npx husky install`

## Running tests

To run the tests:

```
yarn test
```

The first run might fail due to typechain needing to compile. If so, just run the command again.
