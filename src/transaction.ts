/**
 * Transaction builder and manager for DynamoDB transactions.
 *
 * Provides a fluent API for building multi-item transactions
 * with support for put, update, delete, and condition checks.
 */

import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  BatchWriteItemCommand,
  BatchWriteItemCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { err, ok, Result } from "@/result";
import { fromAwsError, transactionCancelledError } from "@/errors";
import { executeOperation } from "@/client";

/**
 * Transaction operation type.
 */
export type TransactionOperation =
  | { type: "put"; table: string; item: Record<string, AttributeValue>; condition?: string }
  | {
      type: "update";
      table: string;
      key: Record<string, AttributeValue>;
      updateExpression: string;
      condition?: string;
      names?: Record<string, string>;
      values?: Record<string, AttributeValue>;
    }
  | { type: "delete"; table: string; key: Record<string, AttributeValue>; condition?: string }
  | {
      type: "conditionCheck";
      table: string;
      key: Record<string, AttributeValue>;
      condition: string;
    };

/**
 * Transaction builder.
 */
export class TransactionBuilder {
  private operations: TransactionOperation[] = [];

  /**
   * Add a put operation.
   */
  put(table: string, item: Record<string, AttributeValue>, condition?: string): TransactionBuilder {
    this.operations.push({ type: "put", table, item, condition });
    return this;
  }

  /**
   * Add an update operation.
   */
  update(
    table: string,
    key: Record<string, AttributeValue>,
    updateExpression: string,
    names?: Record<string, string>,
    values?: Record<string, AttributeValue>,
    condition?: string
  ): TransactionBuilder {
    this.operations.push({
      type: "update",
      table,
      key,
      updateExpression,
      names,
      values,
      condition,
    });
    return this;
  }

  /**
   * Add a delete operation.
   */
  delete(
    table: string,
    key: Record<string, AttributeValue>,
    condition?: string
  ): TransactionBuilder {
    this.operations.push({ type: "delete", table, key, condition });
    return this;
  }

  /**
   * Add a condition check operation.
   */
  conditionCheck(
    table: string,
    key: Record<string, AttributeValue>,
    condition: string
  ): TransactionBuilder {
    this.operations.push({ type: "conditionCheck", table, key, condition });
    return this;
  }

  /**
   * Build the transaction input.
   */
  build(): TransactWriteItemsCommandInput {
    const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [];

    for (const op of this.operations) {
      switch (op.type) {
        case "put":
          transactItems.push({
            Put: {
              TableName: op.table,
              Item: op.item,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "update":
          transactItems.push({
            Update: {
              TableName: op.table,
              Key: op.key,
              UpdateExpression: op.updateExpression,
              ExpressionAttributeNames: op.names,
              ExpressionAttributeValues: op.values,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "delete":
          transactItems.push({
            Delete: {
              TableName: op.table,
              Key: op.key,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "conditionCheck":
          transactItems.push({
            ConditionCheck: {
              TableName: op.table,
              Key: op.key,
              ConditionExpression: op.condition,
            },
          });
          break;
      }
    }

    return {
      TransactItems: transactItems,
    };
  }

  /**
   * Get the number of operations.
   */
  get length(): number {
    return this.operations.length;
  }
}

/**
 * Transaction manager for executing transactions.
 */
export class TransactionManager {
  constructor(private readonly client: DynamoDBClient) {}

  /**
   * Execute a transaction.
   */
  async execute(
    transaction: TransactWriteItemsCommandInput,
    clientRequestToken?: string
  ): Promise<Result<void, Error>> {
    if (transaction.TransactItems && transaction.TransactItems.length > 25) {
      return err(
        new Error(
          "Transaction cannot exceed 25 items (DynamoDB limit). Use batch operations instead."
        )
      );
    }

    if (clientRequestToken) {
      transaction.ClientRequestToken = clientRequestToken;
    }

    const command = new TransactWriteItemsCommand(transaction);
    const result = await executeOperation(() => this.client.send(command));

    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "TRANSACTION_CANCELLED") {
        return err(
          transactionCancelledError("Transaction was cancelled", {
            cancellationReasons: result.error,
          })
        );
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Execute batch write operations with automatic chunking.
   */
  async batchWrite(
    requests: Array<{
      table: string;
      puts?: Record<string, AttributeValue>[];
      deletes?: Record<string, AttributeValue>[];
    }>,
    onProgress?: (processed: number, total: number) => void
  ): Promise<Result<void, Error>> {
    const chunks: BatchWriteItemCommandInput["RequestItems"][] = [];
    let currentChunk: BatchWriteItemCommandInput["RequestItems"] = {};
    let currentSize = 0;

    for (const request of requests) {
      const puts = request.puts || [];
      const deletes = request.deletes || [];
      const totalOps = puts.length + deletes.length;

      if (currentSize + totalOps > 25) {
        // Start new chunk
        chunks.push(currentChunk);
        currentChunk = {};
        currentSize = 0;
      }

      if (!currentChunk[request.table]) {
        currentChunk[request.table] = [];
      }

      for (const item of puts) {
        currentChunk[request.table].push({ PutRequest: { Item: item } });
        currentSize++;
      }

      for (const key of deletes) {
        currentChunk[request.table].push({ DeleteRequest: { Key: key } });
        currentSize++;
      }
    }

    if (Object.keys(currentChunk).length > 0) {
      chunks.push(currentChunk);
    }

    let processed = 0;
    const total = requests.reduce(
      (sum, r) => sum + (r.puts?.length || 0) + (r.deletes?.length || 0),
      0
    );

    for (const chunk of chunks) {
      const command = new BatchWriteItemCommand({ RequestItems: chunk });
      const result = await executeOperation(() => this.client.send(command));

      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }

      // Handle unprocessed items with exponential backoff
      let unprocessed = result.value.UnprocessedItems;
      let retries = 0;
      const maxRetries = 5;

      while (unprocessed && Object.keys(unprocessed).length > 0 && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));
        const retryCommand = new BatchWriteItemCommand({
          RequestItems: unprocessed,
        });
        const retryResult = await executeOperation(() => this.client.send(retryCommand));

        if (retryResult.isErr()) {
          return err(fromAwsError(retryResult.error));
        }

        unprocessed = retryResult.value.UnprocessedItems;
        retries++;
      }

      if (unprocessed && Object.keys(unprocessed).length > 0) {
        return err(new Error(`Failed to process all items after ${maxRetries} retries`));
      }

      const chunkOps = chunk ? Object.values(chunk) : [];
      processed += chunkOps.reduce((sum, ops) => sum + ops.length, 0);
      if (onProgress) {
        onProgress(processed, total);
      }
    }

    return ok(undefined);
  }
}
