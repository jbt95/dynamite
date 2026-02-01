/**
 * Integration tests for repository operations using testcontainers.
 *
 * These tests use testcontainers to run a real DynamoDB Local instance.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Repository, createDatabase, entity, S } from "@/index";
import { UpdateExpressionBuilder } from "@/update";
import { getContainerClient, startDynamoDBContainer } from "@/__tests__/helpers/testcontainers";
import { setupTestTable, clearTestTable } from "@/__tests__/helpers/dynamodb";

// Define test entities using the new API
const IntUser = entity("IntUser", {
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
  .partitionKey({ parts: [{ literal: "INTUSER" }, { attr: "id" }] })
  .build();

const IntOrder = entity("IntOrder", {
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
  .partitionKey({ parts: [{ literal: "INTORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "INTORDER" }, { attr: "orderId" }] })
  .build();

describe("Repository Integration", () => {
  let userRepo: Repository<typeof IntUser>;
  let orderRepo: Repository<typeof IntOrder>;

  beforeAll(async () => {
    let client = getContainerClient();
    if (!client) {
      client = await startDynamoDBContainer();
    }

    // Create database with test table
    const db = createDatabase({ client })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
        typeField: "_type",
      })
      .entities([IntUser, IntOrder])
      .build();

    userRepo = db.tables.test.IntUser;
    orderRepo = db.tables.test.IntOrder;

    // Create the table first and clear any existing data
    await setupTestTable(client, "test-table");
    await clearTestTable(client, "test-table");
  }, 120000);

  describe("put and get", () => {
    it("should put and get user", async () => {
      const user = {
        id: "test-user-1",
        email: "test@example.com",
        name: "Test User",
        age: 30,
        profile: {
          bio: "Test bio",
          avatar: "avatar.jpg",
        },
        tags: ["tag1", "tag2"],
      };

      const putResult = await userRepo.put(user);
      expect(putResult.isOk()).toBe(true);

      const getResult = await userRepo.get({ id: "test-user-1" });
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.id).toBe(user.id);
        expect(getResult.value.email).toBe(user.email);
      }
    });

    it("should put and get order with sort key", async () => {
      const order = {
        userId: "user-1",
        orderId: "order-1",
        total: 100.5,
        items: [{ productId: "prod-1", quantity: 2, price: 50.25 }],
        status: "pending",
      };

      const putResult = await orderRepo.put(order);
      expect(putResult.isOk()).toBe(true);

      const getResult = await orderRepo.get({ userId: "user-1" }, { orderId: "order-1" });
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.orderId).toBe(order.orderId);
        expect(getResult.value.total).toBe(order.total);
      }
    });
  });

  describe("update", () => {
    it("should update user", async () => {
      const user = {
        id: "test-user-2",
        email: "test2@example.com",
        name: "Test User 2",
        age: 25,
        profile: {
          bio: "Original bio",
          avatar: "avatar.jpg",
        },
        tags: [],
      };

      await userRepo.put(user);

      const updates = new UpdateExpressionBuilder(IntUser.schema)
        .set("name", "Updated Name")
        .increment("age", 1)
        .unwrap();

      const updateResult = await userRepo.update({ id: "test-user-2" }, updates);
      expect(updateResult.isOk()).toBe(true);

      const getResult = await userRepo.get({ id: "test-user-2" });
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value.name).toBe("Updated Name");
        expect(getResult.value.age).toBe(26);
      }
    });
  });

  describe("delete", () => {
    it("should delete user", async () => {
      const user = {
        id: "test-user-3",
        email: "test3@example.com",
        name: "Test User 3",
        age: 20,
        profile: {
          bio: "Bio",
          avatar: "avatar.jpg",
        },
        tags: [],
      };

      await userRepo.put(user);

      const deleteResult = await userRepo.delete({ id: "test-user-3" });
      expect(deleteResult.isOk()).toBe(true);

      const getResult = await userRepo.get({ id: "test-user-3" });
      expect(getResult.isErr()).toBe(true);
    });
  });

  describe("exists", () => {
    it("should check if user exists", async () => {
      const user = {
        id: "test-user-4",
        email: "test4@example.com",
        name: "Test User 4",
        age: 20,
        profile: {
          bio: "Bio",
          avatar: "avatar.jpg",
        },
        tags: [],
      };

      await userRepo.put(user);

      const existsResult = await userRepo.exists({ id: "test-user-4" });
      expect(existsResult.isOk()).toBe(true);
      if (existsResult.isOk()) {
        expect(existsResult.value).toBe(true);
      }

      const notExistsResult = await userRepo.exists({ id: "non-existent" });
      expect(notExistsResult.isOk()).toBe(true);
      if (notExistsResult.isOk()) {
        expect(notExistsResult.value).toBe(false);
      }
    });
  });
});
