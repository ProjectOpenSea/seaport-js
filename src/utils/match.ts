import { Order } from "../types";

// Building fulfillments
// Can only match if everything about them is the same except for the amounts
// Bucket all the offers and considerations
// Look at item type, token, flatten every offer and every consideration into one array
// in process of flattening, keep track of indices
// If first time seen this item type, token, identifier combo and offerer/recipient, then goes into new bucket
// If i've seen it, put it into the bucket
// If only one possibility to match, then match
// i.e. 2 items in bucket. 1 offer 1 ETH, 1 offer 2 ETH. 2 consideration items, 1 expect 2 ETH, 1 expect 1 ETH
// Minimize number of fulfillments
// Most robust way is to go through every single permutation of both sides

const generateFulfillments = (orders: Order[]) => {};
