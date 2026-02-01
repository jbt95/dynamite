/**
 * Test entities and schemas for testing.
 *
 * Uses the new simplified entity() API.
 */

import { S, entity } from "@/index";
import type { Entity } from "@/entity";

/**
 * User entity using the simplified API.
 */
export const ModernUser = entity("ModernUser", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
  profile: S.map({
    bio: S.string,
    avatar: S.string,
  }),
  tags: S.list(S.string),
})
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .build();

/**
 * Order entity using the simplified API.
 */
export const ModernOrder = entity("ModernOrder", {
  userId: S.string,
  orderId: S.string,
  total: S.number,
  items: S.list(
    S.map({
      productId: S.string,
      quantity: S.number,
      price: S.number,
    })
  ),
  status: S.string,
})
  .partitionKey({ parts: [{ literal: "ORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "ORDER" }, { attr: "orderId" }] })
  .build();

/**
 * Product entity for testing.
 */
export const Product = entity("Product", {
  id: S.string,
  name: S.string,
  price: S.number,
  category: S.string,
  tags: S.list(S.string),
})
  .partitionKey({ parts: [{ literal: "PRODUCT" }, { attr: "id" }] })
  .build();

export type { Entity };
