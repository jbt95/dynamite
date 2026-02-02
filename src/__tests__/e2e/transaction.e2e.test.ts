/**
 * End-to-end tests for transactions using testcontainers.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  Repository,
  TransactionBuilder,
  TransactionManager,
  createDatabase,
  entity,
  S,
} from "@/index";
import { marshalItem } from "@/schema";
import { getContainerClient, startDynamoDBContainer } from "@/__tests__/helpers/testcontainers";
import { setupTestTable, clearTestTable } from "@/__tests__/helpers/dynamodb";

// Define test entity using the new API
const TestUser = entity("TestUser", {
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
  .partitionKey({ parts: [{ literal: "TESTUSER" }, { attr: "id" }] })
  .build();

describe("Transaction E2E", () => {
  let userRepo: Repository<typeof TestUser>;
  let transactionManager: TransactionManager;

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
      .entities([TestUser])
      .build();

    transactionManager = new TransactionManager(client);
    userRepo = db.getRepository(TestUser);

    // Create the table first and clear any existing data
    await setupTestTable(client, "test-table");
    await clearTestTable(client, "test-table");
  }, 120000);

  it("should execute multi-item transaction", async () => {
    const user1 = {
      id: "txn-user-1",
      email: "txn1@example.com",
      name: "Txn User 1",
      age: 25,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    const user2 = {
      id: "txn-user-2",
      email: "txn2@example.com",
      name: "Txn User 2",
      age: 30,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    const marshalled1 = marshalItem(TestUser.schema, user1);
    const marshalled2 = marshalItem(TestUser.schema, user2);

    expect(marshalled1.isOk()).toBe(true);
    expect(marshalled2.isOk()).toBe(true);

    if (marshalled1.isOk() && marshalled2.isOk()) {
      const item1 = marshalled1.value.M!;
      item1["PK"] = { S: `TESTUSER#${user1.id}` };
      item1["SK"] = { S: "TestUser" };

      const item2 = marshalled2.value.M!;
      item2["PK"] = { S: `TESTUSER#${user2.id}` };
      item2["SK"] = { S: "TestUser" };

      const builder = new TransactionBuilder();
      builder.put("test-table", item1);
      builder.put("test-table", item2);

      const transaction = builder.build();
      const result = await transactionManager.execute(transaction);
      expect(result.isOk()).toBe(true);

      // Verify both items were created
      const get1 = await userRepo.get({ id: "txn-user-1" });
      const get2 = await userRepo.get({ id: "txn-user-2" });
      expect(get1.isOk()).toBe(true);
      expect(get2.isOk()).toBe(true);
    }
  });

  it("should handle transaction cancellation", async () => {
    const user = {
      id: "txn-user-3",
      email: "txn3@example.com",
      name: "Txn User 3",
      age: 25,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    const marshalled = marshalItem(TestUser.schema, user);
    expect(marshalled.isOk()).toBe(true);

    if (marshalled.isOk()) {
      const item = marshalled.value.M!;
      item["PK"] = { S: `TESTUSER#${user.id}` };
      item["SK"] = { S: "TestUser" };

      const builder = new TransactionBuilder();
      builder.put("test-table", item, "attribute_not_exists(PK)"); // Condition that will fail if item exists

      // First put should succeed
      const transaction1 = builder.build();
      const result1 = await transactionManager.execute(transaction1);
      expect(result1.isOk()).toBe(true);

      // Second put with same condition should fail
      const builder2 = new TransactionBuilder();
      builder2.put("test-table", item, "attribute_not_exists(PK)");
      const transaction2 = builder2.build();
      const result2 = await transactionManager.execute(transaction2);
      expect(result2.isErr()).toBe(true);
    }
  });
});
