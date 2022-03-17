import { BigNumber, BigNumberish, Contract, ethers } from "ethers";
import { ERC721ABI } from "../abi/ERC721";
import { ItemType, NftItemType } from "../constants";
import { ERC1155, ERC20, ERC721 } from "../typechain";
import { Item, OfferItem, ReceivedItem } from "../types";

type ConstructItemParams = {
  itemType: BigNumberish;
  token: string;
  amount: BigNumberish;
  identifierOrCriteria: BigNumberish;
  endAmount?: BigNumberish;
  recipient?: string;
};

type ConstructedItem<T> = T extends { recipient: string }
  ? ReceivedItem
  : OfferItem;

const constructItem = <T extends ConstructItemParams>({
  itemType,
  token = ethers.constants.AddressZero,
  amount,
  identifierOrCriteria,
  endAmount,
  recipient,
}: T): T extends { recipient: string } ? ReceivedItem : OfferItem => {
  const item = {
    itemType,
    token,
    identifierOrCriteria,
    startAmount: amount,
    endAmount: endAmount ?? amount,
  };

  if (recipient !== undefined) {
    return {
      ...item,
      recipient,
    } as ConstructedItem<T>;
  }

  return item as ConstructedItem<T>;
};

export const constructNftItem = <
  T extends Omit<ConstructItemParams, "endAmount" | "itemType"> & {
    itemType?: NftItemType;
  }
>({
  itemType = ItemType.ERC721,
  token,
  amount,
  identifierOrCriteria,
  recipient,
}: T): ConstructedItem<T> => {
  return constructItem({
    itemType,
    token,
    amount,
    identifierOrCriteria,
    recipient,
  }) as ConstructedItem<T>;
};

export const constructCurrencyItem = <
  T extends Pick<ConstructItemParams, "amount" | "endAmount" | "recipient"> &
    Partial<Pick<ConstructItemParams, "token">>
>({
  token = ethers.constants.AddressZero,
  amount,
  endAmount,
  recipient,
}: T): ConstructedItem<T> => {
  return constructItem({
    itemType:
      token === ethers.constants.AddressZero ? ItemType.NATIVE : ItemType.ERC20,
    token,
    amount,
    identifierOrCriteria: 0,
    endAmount,
    recipient,
  }) as ConstructedItem<T>;
};

export const isCurrencyItem = ({ itemType }: Item) =>
  [ItemType.NATIVE, ItemType.ERC20].includes(itemType);

export const isErc721Item = ({ itemType }: Item) =>
  [ItemType.ERC721, ItemType.ERC721_WITH_CRITERIA].includes(itemType);

export const isErc1155Item = ({ itemType }: Item) =>
  [ItemType.ERC1155, ItemType.ERC1155_WITH_CRITERIA].includes(itemType);

export const balanceOf = async (
  owner: string,
  item: Item,
  provider: ethers.providers.JsonRpcProvider
): Promise<BigNumber> => {
  if (isErc721Item(item)) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC721;

    if (item.itemType === ItemType.ERC721_WITH_CRITERIA) {
      return contract.balanceOf(owner);
    }

    const isOwner = await contract.ownerOf(item.identifierOrCriteria);
    return BigNumber.from(Number(isOwner));
  } else if (isErc1155Item(item)) {
    if (item.itemType === ItemType.ERC1155_WITH_CRITERIA) {
      throw new Error("This doesn't make sense");
    }

    const contract = new Contract(item.token, ERC721ABI, provider) as ERC1155;
    return contract.balanceOf(owner, item.identifierOrCriteria);
  }

  if (item.itemType === ItemType.ERC20) {
    const contract = new Contract(item.token, ERC721ABI, provider) as ERC20;
    return contract.balanceOf(owner);
  }

  return await provider.getBalance(owner);
};
