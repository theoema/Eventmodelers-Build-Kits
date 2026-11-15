import { index, pgTable, uuid } from "drizzle-orm/pg-core"

/** The automation's own todo list, one row per item in a cart; private to this slice and its processor. */
export const archiveItemCarts = pgTable(
  "archive_item_carts",
  {
    itemId: uuid("item_id").primaryKey(),
    aggregateId: uuid("aggregate_id").notNull(),
    productId: uuid("product_id").notNull(),
  },
  (t) => [index("archive_item_carts_product").on(t.productId), index("archive_item_carts_cart").on(t.aggregateId)],
)
