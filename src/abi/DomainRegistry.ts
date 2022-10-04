const DomainRegistryABI = [
  {
    inputs: [
      {
        internalType: "string",
        name: "domain",
        type: "string",
      },
    ],
    name: "DomainAlreadyRegistered",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
      {
        internalType: "uint256",
        name: "maxIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "suppliedIndex",
        type: "uint256",
      },
    ],
    name: "DomainIndexOutOfRange",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "domain",
        type: "string",
      },
      {
        indexed: false,
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "DomainRegistered",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "getDomain",
    outputs: [
      {
        internalType: "string",
        name: "domain",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
    ],
    name: "getDomains",
    outputs: [
      {
        internalType: "string[]",
        name: "domains",
        type: "string[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
    ],
    name: "getNumberOfDomains",
    outputs: [
      {
        internalType: "uint256",
        name: "totalDomains",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "domain",
        type: "string",
      },
    ],
    name: "setDomain",
    outputs: [
      {
        internalType: "bytes4",
        name: "tag",
        type: "bytes4",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export { DomainRegistryABI };
