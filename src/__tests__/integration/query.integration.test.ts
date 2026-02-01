/**
 * Integration tests for query operations using testcontainers.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Repository, createDatabase, entity, S } from "@/index";
import { getContainerClient, startDynamoDBContainer } from "@/__tests__/helpers/testcontainers";
import { setupTestTable, clearTestTable } from "@/__tests__/helpers/dynamodb";

// Define test entity using the new API
const TestOrder = entity("TestOrder", {
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
  .partitionKey({ parts: [{ literal: "TESTORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "TESTORDER" }, { attr: "orderId" }] })
  .build();

describe("Query Integration", () => {
  let orderRepo: Repository<typeof TestOrder>;

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
      .entities([TestOrder])
      .build();

    orderRepo = db.tables.test.TestOrder;

    // Create the table first and clear any existing data
    await setupTestTable(client, "test-table");
    await clearTestTable(client, "test-table");

    // Seed test data
    const orders = [
      {
        userId: "user-1",
        orderId: "order-1",
        total: 100,
        items: [],
        status: "pending",
      },
      {
        userId: "user-1",
        orderId: "order-2",
        total: 200,
        items: [],
        status: "completed",
      },
      {
        userId: "user-2",
        orderId: "order-3",
        total: 150,
        items: [],
        status: "pending",
      },
    ];

    for (const order of orders) {
      await orderRepo.put(order);
    }
  }, 120000);

  it("should query by partition key", async () => {
    const query = orderRepo.query({ userId: "user-1" });
    const result = await query.toArray();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value.every((o) => o.userId === "user-1")).toBe(true);
    }
  });

  it("should query with sort key condition", async () => {
    const query = orderRepo.query({ userId: "user-1" });
    query.sortKeyBeginsWith("TESTORDER#order-1");
    const result = await query.toArray();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  it("should filter results", async () => {
    const query = orderRepo.query({ userId: "user-1" });
    query.where("status", "=", "pending");
    const result = await query.toArray();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.every((o) => o.status === "pending")).toBe(true);
    }
  });

  it("should get first result", async () => {
    const query = orderRepo.query({ userId: "user-1" });
    const result = await query.first();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.userId).toBe("user-1");
    }
  });

  it("should count results", async () => {
    const query = orderRepo.query({ userId: "user-1" });
    const result = await query.count();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeGreaterThan(0);
    }
  });
});
