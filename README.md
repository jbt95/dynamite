# Dynamite

A type-first DynamoDB library for TypeScript with single-table design, multi-table support, transactions, and full type inference.

[![npm version](https://badge.fury.io/js/dynamite.svg)](https://badge.fury.io/js/dynamite)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Full type inference** - Schema is single source of truth, no code generation
- **Result monad everywhere** - Explicit error handling, no null/undefined returns
- **Multi-table support** - First-class support for multiple DynamoDB tables
- **Single-table design** - Entity discrimination built into core
- **Type-safe queries** - Autocomplete for all entity fields including nested paths
- **Multiple consumption patterns** - Generators, async/await, pagination
- **Minimal dependencies** - Only AWS SDK v3

## Install

```bash
bun add dynamite
```

## Quick Start (New API v1.0+)

The new API provides a cleaner, more type-safe interface:

```typescript
import { createDatabase, entity, S, EntityType } from "dynamite";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// 1. Define your entities
const User = entity("User", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
  profile: S.map({
    bio: S.string,
    avatar: S.string,
  }),
})
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .build();

const Order = entity("Order", {
  userId: S.string,
  orderId: S.string,
  total: S.number,
  status: S.string,
})
  .partitionKey({ parts: [{ literal: "ORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "ORDER" }, { attr: "orderId" }] })
  .build();

// 2. Create database with multi-table support
const client = new DynamoDBClient({ region: "us-east-1" });

const db = createDatabase({ client })
  .table("main", {
    name: "my-app-table",
    partitionKey: "PK",
    sortKey: "SK",
    typeField: "_type",
  })
  .entities([User, Order])
  .build();

// 3. Use type-safe repositories with autocomplete!
// Get user by ID
const user = await db.tables.main.User.get({ id: "123" });

// Query orders for a user
const orders = await db.tables.main.Order.query({ userId: "123" })
  .sortKeyBeginsWith("ORDER#2024")
  .where("status", "=", "pending") // ✨ Autocomplete suggests: status, total
  .where("total", ">", 100) // ✨ Type-safe field access
  .toArray();

// Or use getRepository for direct access
const userRepo = db.getRepository(User);
const user2 = await userRepo.get({ id: "456" });

// Type inference works automatically
type UserType = EntityType<typeof User>; // { id: string; email: string; ... }
```

## New API Features

### Multi-Table Support

```typescript
const db = createDatabase({ client })
  .table("users", {
    name: "users-table",
    partitionKey: "PK",
  })
  .entities([User])
  .table("orders", {
    name: "orders-table",
    partitionKey: "PK",
    sortKey: "SK",
  })
  .entities([Order])
  .build();

// Access different tables
db.tables.users.User.get({ id: "123" });
db.tables.orders.Order.query({ userId: "123" });
```

### Nested Field Autocomplete

```typescript
const User = entity("User", {
  id: S.string,
  profile: S.map({
    name: S.string,
    social: S.map({
      twitter: S.string,
      github: S.string,
    }),
  }),
})
  .partitionKey({ parts: [{ attr: "id" }] })
  .build();

const db = createDatabase({ client })
  .table("main", { name: "table", partitionKey: "PK" })
  .entities([User])
  .build();

// Autocomplete suggests all nested paths:
const query = db.tables.main.User.query({ id: "123" })
  .where("profile.name", "=", "John") // ✨ Suggests: profile.name
  .where("profile.social.twitter", "=", "@john") // ✨ Suggests: profile.social.twitter
  .select("id", "profile.name"); // ✨ Suggests all field paths
```

---

## API Reference

### Schema Definition

Define your data schemas with automatic TypeScript type inference:

```typescript
import { S } from "dynamite";

// Primitive types
const stringSchema = S.string; // string
const numberSchema = S.number; // number
const boolSchema = S.boolean; // boolean

// Complex types
const listSchema = S.list(S.string); // string[]
const mapSchema = S.map({
  // { name: string; age: number; }
  name: S.string,
  age: S.number,
});
const setSchema = S.set.string; // Set<string>

// Optional fields
const optionalSchema = S.optional(S.string); // string | undefined

// Default values
const defaultSchema = S.string.default("value"); // string (with default)
```

### Entity Definition (New API)

The new `entity()` function provides a cleaner API:

```typescript
import { entity, S } from "dynamite";

const User = entity("User", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
  tags: S.list(S.string),
  metadata: S.optional(
    S.map({
      createdAt: S.number,
    })
  ),
})
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .sortKey({ parts: [{ literal: "PROFILE" }, { attr: "id" }] }) // Optional
  .gsi("EmailIndex", {
    // Optional GSI
    pk: { parts: [{ attr: "email" }] },
    projection: "ALL",
  })
  .build();

// Extract TypeScript types
type UserType = EntityType<typeof User>; // { id: string; email: string; ... }
type UserPK = EntityPK<typeof User>; // { id: string; }
```

### Database Setup (New API)

Create a database with one or more tables:

```typescript
import { createDatabase } from "dynamite";

const db = createDatabase({ client })
  .table("main", {
    name: "my-table", // DynamoDB table name
    partitionKey: "PK", // Partition key attribute name
    sortKey: "SK", // Sort key attribute name (optional)
    typeField: "_type", // Type discriminator field (optional)
  })
  .entities([User, Order, Product]) // Register entities
  .table("analytics", {
    // Add more tables
    name: "analytics-table",
    partitionKey: "PK",
  })
  .entities([Event])
  .build();
```

### Repository Operations

Access repositories through the database instance:

```typescript
// Get repository
const userRepo = db.tables.main.User;

// CRUD operations
const user = await userRepo.get({ id: "123" });
const putResult = await userRepo.put({ id: "123", email: "test@example.com", ... });
const deleteResult = await userRepo.delete({ id: "123" });
const exists = await userRepo.exists({ id: "123" });

// Queries
const allUsers = await userRepo.query({ id: "123" }).toArray();

// Scans
const activeUsers = await userRepo
  .scan()
  .where("isActive", "=", true)
  .toArray();
```

### Query Builder

Build sophisticated queries with full type safety:

```typescript
// Basic query
const users = await db.tables.main.User.query({ id: "123" }).toArray();

// With sort key conditions
const orders = await db.tables.main.Order.query({ userId: "123" })
  .sortKeyBeginsWith("ORDER#2024")
  .sortKeyBetween("ORDER#001", "ORDER#999")
  .sortKeyLessThan("ORDER#500")
  .toArray();

// With filters (type-safe field paths!)
const filtered = await db.tables.main.Order.query({ userId: "123" })
  .where("status", "=", "pending")
  .where("total", ">", 100)
  .orWhere("priority", "=", "high")
  .toArray();

// With projections
const projected = await db.tables.main.User.query({ id: "123" })
  .select("id", "email", "profile.name")
  .toArray();

// Pagination
const page = await db.tables.main.User.query({ id: "123" }).limit(10).page();

// Streaming (generator)
for await (const user of db.tables.main.User.query({ id: "123" }).execute()) {
  console.log(user);
}
```

### Scan Builder

Scan operations with the same type-safe API:

```typescript
// Basic scan
const allItems = await db.tables.main.User.scan().toArray();

// With filters
const filtered = await db.tables.main.User.scan()
  .where("age", ">=", 18)
  .where("status", "=", "active")
  .toArray();

// Parallel scan
const segment = await db.tables.main.User.scan()
  .parallelScan(0, 4) // Segment 0 of 4
  .toArray();
```

### Result Type

All operations return a `Result<T, Error>` type for explicit error handling:

```typescript
import { isOk, isErr } from "dynamite";

const result = await db.tables.main.User.get({ id: "123" });

if (isOk(result)) {
  console.log(result.value); // User
} else {
  console.error(result.error); // Error
}

// Or use unwrap (throws on error)
const user = (await db.tables.main.User.get({ id: "123" })).unwrap();
```

## Testing

```bash
# Run all tests
bun test

# Unit tests only
bun run test:unit

# Integration tests (requires DynamoDB Local)
bun run test:integration

# Type checking
bun run typecheck
```

### Setting Up DynamoDB Local

```bash
# Using Docker Compose
docker-compose -f docker-compose.test.yml up -d

# Or manually
docker run -p 8000:8000 amazon/dynamodb-local

# Set environment variable
export DYNAMODB_ENDPOINT=http://localhost:8000
```

## Requirements

- Node.js 18+
- TypeScript 5.0+
- AWS SDK v3 (`@aws-sdk/client-dynamodb`)

## License

MIT © Jordi Bermejo Tornero

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) for details.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.
