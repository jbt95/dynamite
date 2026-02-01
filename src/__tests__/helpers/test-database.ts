/**
 * Test database using the new API with testcontainers.
 *
 * This file provides a pre-configured database instance using the new
 * `createDatabase()` API for testing purposes with testcontainers.
 *
 * @example
 * ```typescript
 * import { getTestDatabase, NewUser, NewOrder } from "./test-database";
 *
 * // Get database instance (uses testcontainer client)
 * const db = await getTestDatabase();
 *
 * // Access repositories directly
 * const user = await db.tables.main.User.get({ id: "123" });
 * const orders = await db.tables.main.Order.query({ userId: "123" }).toArray();
 *
 * // Or use getRepository
 * const userRepo = db.getRepository(NewUser);
 * const user2 = await userRepo.get({ id: "456" });
 * ```
 */

import { createDatabase, entity, S } from "@/index";
import { getContainerClient } from "./testcontainers";

/**
 * User entity using the new simplified API.
 */
export const NewUser = entity("User", {
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
 * Order entity using the new simplified API.
 */
export const NewOrder = entity("Order", {
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
 * Get a test database instance using the testcontainer client.
 *
 * @returns Database instance configured with testcontainer DynamoDB
 */
export async function getTestDatabase() {
  const client = getContainerClient();
  if (!client) {
    throw new Error("Testcontainer not started. Make sure globalSetup is configured.");
  }

  return createDatabase({ client })
    .table("main", {
      name: "test-table",
      partitionKey: "PK",
      sortKey: "SK",
      typeField: "_type",
    })
    .entities([NewUser, NewOrder])
    .build();
}

/**
 * Factory function to create a fresh test database instance.
 * Use this when you need test isolation.
 */
export function createTestDatabase() {
  return getTestDatabase();
}

// Entity types are inferred from the entity definitions above
export type UserType = typeof NewUser;
export type OrderType = typeof NewOrder;
