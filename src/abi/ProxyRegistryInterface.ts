const ProxyRegistryInterfaceABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "proxies",
    outputs: [
      {
        internalType: "address",
        name: "proxy",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export { ProxyRegistryInterfaceABI };
