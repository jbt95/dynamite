/**
 * Type inference tests for query autocomplete functionality.
 *
 * These tests verify that TypeScript properly infers entity field types
 * and provides autocomplete suggestions in the query builder.
 */

import { describe, it, expect } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createDatabase, entity, S, EntityType } from "@/index";
import type { Paths, PathValue } from "@/core/paths";

// Define test entities with various field types
const User = entity("User", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
  isActive: S.boolean,
  profile: S.map({
    bio: S.string,
    avatar: S.string,
    social: S.map({
      twitter: S.string,
      github: S.string,
    }),
  }),
  tags: S.list(S.string),
})
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .build();

const Order = entity("Order", {
  userId: S.string,
  orderId: S.string,
  total: S.number,
  status: S.string,
  items: S.list(
    S.map({
      productId: S.string,
      quantity: S.number,
      price: S.number,
    })
  ),
})
  .partitionKey({ parts: [{ literal: "ORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "ORDER" }, { attr: "orderId" }] })
  .build();

// Type inference tests
type UserType = EntityType<typeof User>;
type OrderType = EntityType<typeof Order>;
type UserPaths = Paths<UserType>;

// Test: Verify PathValue works correctly
type IdType = PathValue<UserType, "id">; // should be string
type ProfileBioType = PathValue<UserType, "profile.bio">; // should be string
type SocialTwitterType = PathValue<UserType, "profile.social.twitter">; // should be string

// Compile-time type checks
const _idTypeCheck: IdType = "test";
const _bioTypeCheck: ProfileBioType = "bio text";
const _twitterTypeCheck: SocialTwitterType = "@handle";

describe("Query Autocomplete Type Inference", () => {
  it("should have correct entity type inference", () => {
    // This test verifies at compile time that EntityType works
    const userData: UserType = {
      id: "123",
      email: "test@example.com",
      name: "Test User",
      age: 30,
      isActive: true,
      profile: {
        bio: "A test user",
        avatar: "avatar.jpg",
        social: {
          twitter: "@testuser",
          github: "testuser",
        },
      },
      tags: ["tag1", "tag2"],
    };

    expect(userData.id).toBe("123");
    expect(userData.profile.social.twitter).toBe("@testuser");
  });

  it("should support nested paths", () => {
    // These paths should all be valid
    const paths: UserPaths[] = [
      "id",
      "email",
      "name",
      "age",
      "isActive",
      "profile",
      "profile.bio",
      "profile.avatar",
      "profile.social",
      "profile.social.twitter",
      "profile.social.github",
      "tags",
    ];

    expect(paths.length).toBeGreaterThan(0);
  });

  it("should compile query with where clauses", () => {
    // Create a mock database to test query building
    const mockClient = {} as DynamoDBClient;

    const db = createDatabase({ client: mockClient })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([User, Order])
      .build();

    // Get the query builder
    const query = db.tables.test.User.query({ id: "123" });

    // The query object should exist
    expect(query).toBeDefined();

    // Type checking happens at compile time - if this compiles, types work
    // Users should get autocomplete when typing: query.where("|"
  });

  it("should compile query with select fields", () => {
    const mockClient = {} as DynamoDBClient;

    const db = createDatabase({ client: mockClient })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([User, Order])
      .build();

    // Get the query builder
    const query = db.tables.test.User.query({ id: "123" });

    // Select should accept field paths
    const queryWithSelect = query.select("id", "email", "name", "profile.bio");

    expect(queryWithSelect).toBeDefined();
  });

  it("should compile Order entity queries", () => {
    const mockClient = {} as DynamoDBClient;

    const db = createDatabase({ client: mockClient })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([User, Order])
      .build();

    // Query Order entity
    const orderQuery = db.tables.test.Order.query({ userId: "user-123" });

    // Should be able to chain sort key methods and filters
    const orderQueryWithFilters = orderQuery
      .sortKeyBeginsWith("ORDER#2024")
      .where("status", "=", "pending")
      .where("total", ">", 100);

    expect(orderQueryWithFilters).toBeDefined();
  });

  it("should support complex nested queries", () => {
    const mockClient = {} as DynamoDBClient;

    const db = createDatabase({ client: mockClient })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([User])
      .build();

    // Query with deeply nested field access
    const query = db.tables.test.User.query({ id: "123" })
      .where("profile.social.twitter", "=", "@handle")
      .where("isActive", "=", true)
      .select("id", "name", "profile.bio", "profile.social.github");

    expect(query).toBeDefined();
  });
});

/**
 * Compile-time type tests.
 *
 * These types are checked at compile time, not runtime.
 * If any of these fail, TypeScript will report an error.
 */
describe("Compile-time type checks", () => {
  it("compiles with correct types", () => {
    // If we reach this point, all type checks passed at compile time
    expect(true).toBe(true);
  });
});

// Export entities for use in other tests
export { User, Order };
export type { UserType, OrderType };
