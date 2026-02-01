# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-31

### Added

- **New Simplified API**: Introduced `entity()` function for cleaner entity definition

  ```typescript
  const User = entity("User", {
    id: S.string,
    email: S.string,
  })
    .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
    .build();
  ```

- **Multi-Table Support**: Added `createDatabase()` with support for multiple DynamoDB tables

  ```typescript
  const db = createDatabase({ client })
    .table("users", { name: "users-table", partitionKey: "PK" })
    .entities([User])
    .table("orders", { name: "orders-table", partitionKey: "PK", sortKey: "SK" })
    .entities([Order])
    .build();
  ```

- **Type-Safe Query Autocomplete**: Full IntelliSense support for entity field paths in queries
  - `db.tables.main.User.query({ id: "123" }).where("profile.name", "=", "John")`
  - Autocomplete suggests: `id`, `email`, `profile`, `profile.name`, `profile.social.twitter`, etc.

- **Phantom Type Properties**: Required phantom types for better type inference
  - `_data`: Entity data type
  - `_pk`: Partition key input type
  - `_sk`: Sort key input type (optional)

### Changed

- **Package Name**: Renamed from `dynamodb-typesafe` to `dynamite`
- **Entity Interface**: Phantom type properties now required (not optional) for proper type inference
- **Code Structure**: Reorganized into modular structure:
  - `src/core/` - Path utilities and core types
  - `src/entity/` - Entity types and builder
  - `src/database/` - Database builder and types
  - `src/schema/` - Schema definitions

### Changed

- **Simplified Repository Access**: Removed `.repos` layer, repositories now accessible directly
  - Before: `db.tables.main.repos.User.get({ id: "123" })`
  - After: `db.tables.main.User.get({ id: "123" })`

- **Added `getRepository()` Method**: Alternative way to access repositories
  ```typescript
  const userRepo = db.getRepository(User);
  const user = await userRepo.get({ id: "123" });
  ```

### Fixed

- Type inference for entity field paths in query builders
- Autocomplete not showing for `where()` and `select()` methods
- Entity key type inference with proper `InferKeyInput` utility

### Removed

- **RxJS Observables** (`src/observables.ts`) - Removed optional RxJS integration
- **DynamoDB Streams** (`src/streams.ts`) - Removed DynamoDB Streams processing
- **Retry Utilities** (`src/retry.ts`) - Removed retry and resilience utilities
- **EntityBuilder** - Removed legacy class-based entity builder (use `entity()` instead)
- **TableBuilder** - Removed legacy table builder (use `createDatabase()` instead)
- Redundant `type-inference.test.ts` (functionality covered by `query-autocomplete.test.ts`)

### Migration Guide

See [README.md](./README.md#migration-guide) for detailed migration instructions.

### Testing

- Added 133 unit tests covering both old and new APIs
- All tests passing
- TypeScript compilation successful

---

## [0.1.0] - 2026-01-13

### Added

- Initial release
- EntityBuilder API for entity definition
- TableBuilder API for table configuration
- Repository pattern for CRUD operations
- QueryBuilder and ScanBuilder for DynamoDB operations
- Result monad for explicit error handling
- UpdateExpressionBuilder for atomic updates
- TransactionBuilder and TransactionManager
- UnitOfWork pattern with change tracking
- Hook system for lifecycle events
- StreamConsumer for DynamoDB Streams
- Retry and resilience utilities
- Testing utilities for mocking DynamoDB

[1.0.0]: https://github.com/yourusername/dynamite/releases/tag/v1.0.0
[0.1.0]: https://github.com/yourusername/dynamite/releases/tag/v0.1.0
