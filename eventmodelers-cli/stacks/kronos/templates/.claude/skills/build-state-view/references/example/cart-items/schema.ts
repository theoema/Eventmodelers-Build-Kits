import { doublePrecision, index, pgTable, text, uuid } from "drizzle-orm/pg-core"

// One row per item in a cart. Every write is absolute (insert-if-absent, delete), so replaying an event is harmless.
export const cartItems = pgTable(
  "cart_items",
  {
    itemId: uuid("item_id").primaryKey(),
    aggregateId: uuid("aggregate_id").notNull(),
    productId: uuid("product_id").notNull(),
    description: text("description").notNull(),
    image: text("image").notNull(),
    price: doublePrecision("price").notNull(),
  },
  (t) => [index("cart_items_cart").on(t.aggregateId)],
)
