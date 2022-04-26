import { Network } from "../constants";

export const LEGACY_PROXY_ADDRESSES = {
  [Network.MAINNET]: {
    WyvernProxyRegistry: "0xa5409ec958C83C3f309868babACA7c86DCB077c1",
    WyvernTokenTransferProxy: "0xE5c783EE536cf5E63E792988335c4255169be4E1",
  },
  [Network.RINKEBY]: {
    WyvernProxyRegistry: "0x1E525EEAF261cA41b809884CBDE9DD9E1619573A",
    WyvernTokenTransferProxy: "0xCdC9188485316BF6FA416d02B4F680227c50b89e",
  },
};
