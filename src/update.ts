/**
 * Update expression builder for DynamoDB updates.
 *
 * Provides a type-safe, fluent API for building update expressions
 * with SET, REMOVE, ADD, and DELETE operations.
 */

import type { SchemaDef } from "@/schema";
import { err, ok, Result } from "@/result";
import { validationError } from "@/errors";
import {
  ExpressionContext,
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
} from "@/expressions";
import { AttributeValue } from "@aws-sdk/client-dynamodb";

/**
 * Update expression operations.
 */
type UpdateOperation = "SET" | "REMOVE" | "ADD" | "DELETE";

/**
 * Update expression builder.
 */
export class UpdateExpressionBuilder<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  private setExpressions: string[] = [];
  private removeExpressions: string[] = [];
  private addExpressions: string[] = [];
  private deleteExpressions: string[] = [];
  private context: ExpressionContext;

  constructor(private readonly schema: SchemaDef) {
    this.context = createExpressionContext();
  }

  /**
   * Set a field value.
   */
  set<K extends keyof TData>(field: K, value: TData[K]): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valueRef = addAttributeValue(this.context, value);
    this.setExpressions.push(`${fieldRef} = ${valueRef}`);
    return this;
  }

  /**
   * Set a field value only if it doesn't exist.
   */
  setIfNotExists<K extends keyof TData>(field: K, value: TData[K]): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valueRef = addAttributeValue(this.context, value);
    this.setExpressions.push(`${fieldRef} = if_not_exists(${fieldRef}, ${valueRef})`);
    return this;
  }

  /**
   * Increment a number field.
   */
  increment<K extends keyof TData>(field: K, amount: number): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const amountRef = addAttributeValue(this.context, amount);
    this.setExpressions.push(`${fieldRef} = ${fieldRef} + ${amountRef}`);
    return this;
  }

  /**
   * Decrement a number field.
   */
  decrement<K extends keyof TData>(field: K, amount: number): UpdateExpressionBuilder<TData> {
    return this.increment(field, -amount);
  }

  /**
   * Append to a list.
   */
  listAppend<K extends keyof TData>(field: K, values: unknown[]): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valuesRef = addAttributeValue(this.context, values);
    this.setExpressions.push(`${fieldRef} = list_append(${fieldRef}, ${valuesRef})`);
    return this;
  }

  /**
   * Prepend to a list.
   */
  listPrepend<K extends keyof TData>(field: K, values: unknown[]): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valuesRef = addAttributeValue(this.context, values);
    this.setExpressions.push(`${fieldRef} = list_append(${valuesRef}, ${fieldRef})`);
    return this;
  }

  /**
   * Remove a field.
   */
  remove<K extends keyof TData>(field: K): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    this.removeExpressions.push(fieldRef);
    return this;
  }

  /**
   * Add to a number or set.
   */
  add<K extends keyof TData>(
    field: K,
    value: number | Set<string> | Set<number>
  ): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valueRef = addAttributeValue(this.context, value);
    this.addExpressions.push(`${fieldRef} ${valueRef}`);
    return this;
  }

  /**
   * Delete from a set.
   */
  delete<K extends keyof TData>(
    field: K,
    value: Set<string> | Set<number>
  ): UpdateExpressionBuilder<TData> {
    const fieldRef = addAttributeName(this.context, String(field));
    const valueRef = addAttributeValue(this.context, value);
    this.deleteExpressions.push(`${fieldRef} ${valueRef}`);
    return this;
  }

  /**
   * Build the update expression.
   */
  build(): Result<
    {
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, AttributeValue>;
    },
    Error
  > {
    const parts: string[] = [];

    if (this.setExpressions.length > 0) {
      parts.push(`SET ${this.setExpressions.join(", ")}`);
    }

    if (this.removeExpressions.length > 0) {
      parts.push(`REMOVE ${this.removeExpressions.join(", ")}`);
    }

    if (this.addExpressions.length > 0) {
      parts.push(`ADD ${this.addExpressions.join(", ")}`);
    }

    if (this.deleteExpressions.length > 0) {
      parts.push(`DELETE ${this.deleteExpressions.join(", ")}`);
    }

    if (parts.length === 0) {
      return err(validationError("Update expression cannot be empty"));
    }

    // Convert values to AttributeValue format
    const attributeValues: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(this.context.values)) {
      // Simple conversion - in real implementation, would use proper marshalling
      if (typeof value === "string") {
        attributeValues[key] = { S: value };
      } else if (typeof value === "number") {
        attributeValues[key] = { N: String(value) };
      } else if (typeof value === "boolean") {
        attributeValues[key] = { N: value ? "1" : "0" };
      } else if (value instanceof Set) {
        const items = Array.from(value);
        if (items.length > 0 && typeof items[0] === "string") {
          attributeValues[key] = { SS: items as string[] };
        } else {
          attributeValues[key] = { NS: items.map(String) };
        }
      } else if (Array.isArray(value)) {
        attributeValues[key] = { L: value.map((v) => ({ S: String(v) })) };
      } else {
        return err(validationError(`Unsupported value type: ${typeof value}`, { value }));
      }
    }

    return ok({
      UpdateExpression: parts.join(" "),
      ExpressionAttributeNames: this.context.names,
      ExpressionAttributeValues: attributeValues,
    });
  }

  /**
   * Unwrap and build (throws on error).
   */
  unwrap(): {
    UpdateExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, AttributeValue>;
  } {
    const result = this.build();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }
}
