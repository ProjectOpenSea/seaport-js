/** Giant TODO for match orders
# Match orders

- Format: list of fulfillments
    - Each fulfillment represents a single transfer or “execution”
    - Each fulfillment specifies an array of offer “components” corresponding to offer items to spend as well as an array of consideration “components” corresponding to consideration items to receive
    - every offer component and consideration component contains an index of the order it is from as well as an index of the item in the respective offer or consideration array on that order
    - the “from” address will be the offerer of whatever offer items are being spent
    - the “to” address will be the recipient of whatever consideration items are being received
- the “One rule” to follow for the whole set of fulfillments:
    - All consideration items must be fully accounted for after adjusting for partial fills and ascending/descending amounts
- the “Four rules” to follow for each distinct fulfillment:
    1. you need at least one offer component and at least one consideration component for each fulfillment; otherwise you don’t know what the “from” or “to” address should be
    2. the offer item corresponding to the first offer component has to match the consideration item corresponding to the first consideration component (with the exception of the amount); otherwise you’re not sending the item that the recipient is expecting
    3. any additional offer items need to match the original offer items (with the exception of the amount) and the same *the offerer*; otherwise you’re composing different items or different origins.
        1. This implies that ERC721 fulfillments will always have a single offer component (even if that corresponding offer item is present in multiple fulfillments, i.e. criteria-based partial fills)

Example: Bulk purchase

- Five distinct sellers create orders to sell ERC721 NFTs for ETH.
    - single offer item on each order: the NFT
    - two consideration items on each order: 10 ETH to the offerer and 1 ETH to OpenSea
    - order index 1 through 5
- To fulfill this, fulfiller creates a *sixth* order to buy all 5 NFTs for ETH
    - single offer item: 55 ETH or `(10 + 1) * 5`
    - five consideration items: all five NFTs
    - order index 0 (by convention)
- This order requires exactly 11 transfers or executions (assuming 5 distinct sellers), translating to 11 fulfillments:
    - 5 transfers of 10 ETH each from order 0 offerer (i.e. fulfiller) to order 1-5 offerers
        - These fulfillments will have a single offer component and single consideration component (offer component: order 0 index 0 and consideration component: orders 1-5 index 0)
    - 5 transfers of 1 NFT each from order 1-5 offers to order 0 offerer (i.e. fulfiller)
        - These fulfillments will have a single offer component and single fulfillment component (offer component: orders 1-5 index 0 and consideration component order 0 index 0-4)
    - 1 transfer of 5 ETH from order 0 offerer (i.e. fulfiller) to OpenSea
        - This fulfillment will have a single offer component mapping to order index 0 + item index 0, but *five* consideration components mapping to order index 1-5 + item index 1

The algorithm (broad-strokes first pass)

1. Take all the orders you want to fulfill and retrieve the latest amounts for those orders based on amount filled, amount *desired* to fill, and ascending/descending amounts (include sufficient buffer on those)
2. “flatten” those orders into:
    - all the offer items (and include the order index, item index, and offerer alongside the item)
    - all the consideration items (and include the order index and item index alongside the item; the recipient is already on the consideration items)
3. Aggregate those items by type + token + identifier + (offerer / recipient), summing up all the amounts (we do need to track the original amounts as well here)
4. Quickly check to see if there are any aggregated offer items with the same type + token + identifier + offerer as an aggregated consideration item’s type + token + identifier + recipient (i.e. offerer == recipient) — if so, create a fulfillment for those and decrement both (no execution / transfer will be created for these fulfillments)
5. Retrieve all approvals and balances for each aggregated offer item; increment / decrement them as we go and ensure they never go below zero
6. Search for fulfillments that can already be performed before the fulfiller’s order has even been created; if any exist, generate those fulfillments first (the goal is to reduce the number of items on the fulfiller’s order).
    - To generate a fulfillment, subtract whatever is lower between the aggregated offer and aggregated consideration it is being matched with from both and register the fulfillment.
    - There will likely be some combination that optimizes for total number of transfers; see if these can be optimized.
        - By way of example, say a fulfiller is accepting offers to sell multiple NFTs at once, and the aggregate fees owed to OpenSea are exactly 1 WETH and it so happens that one of the NFTS has an offer for exactly 1 WETH — that offerer should pay the fees for all the orders being fulfilled in a single transaction.
    - Repeat this process until the fulfillments cannot be compressed any further.
7. Then, create the mirror order with an offer item for each remaining (aggregated) consideration item and a consideration item for each remaining (aggregated) offer item; check for sufficient approval on each derived offer item
8. Run the same sequence as from in step 6, but include the last order as well
9. Ensure that all consideration items have been met!
  */

export {};
