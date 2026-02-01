/**
 * Expression building utilities for DynamoDB operations.
 *
 * Provides type-safe construction of condition expressions,
 * filter expressions, and update expressions.
 */

/**
 * Expression attribute name placeholder.
 */
export interface ExpressionAttributeName {
  readonly "#name": string;
}

/**
 * Expression attribute value placeholder.
 */
export interface ExpressionAttributeValue {
  readonly ":value": string;
}

/**
 * Expression builder context.
 */
export interface ExpressionContext {
  names: Record<string, string>;
  values: Record<string, unknown>;
  nameCounter: number;
  valueCounter: number;
}

/**
 * Create a new expression context.
 */
export function createExpressionContext(): ExpressionContext {
  return {
    names: {},
    values: {},
    nameCounter: 0,
    valueCounter: 0,
  };
}

/**
 * Add an attribute name to the context.
 */
export function addAttributeName(context: ExpressionContext, path: string): string {
  const key = `#attr${context.nameCounter++}`;
  context.names[key] = path;
  return key;
}

/**
 * Add an attribute value to the context.
 */
export function addAttributeValue(context: ExpressionContext, value: unknown): string {
  const key = `:val${context.valueCounter++}`;
  context.values[key] = value;
  return key;
}

/**
 * Build a field reference expression.
 */
export function buildFieldRef(context: ExpressionContext, fieldPath: string): string {
  const parts = fieldPath.split(".");
  const refs = parts.map((part) => addAttributeName(context, part));
  return refs.join(".");
}

/**
 * Comparison operators for expressions.
 */
export type ComparisonOperator =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "BETWEEN"
  | "IN"
  | "begins_with"
  | "contains"
  | "attribute_exists"
  | "attribute_not_exists"
  | "attribute_type"
  | "size";

/**
 * Build a comparison expression.
 */
export function buildComparison(
  context: ExpressionContext,
  fieldPath: string,
  operator: ComparisonOperator,
  value?: unknown | [unknown, unknown]
): string {
  const fieldRef = buildFieldRef(context, fieldPath);

  switch (operator) {
    case "attribute_exists":
      return `attribute_exists(${fieldRef})`;
    case "attribute_not_exists":
      return `attribute_not_exists(${fieldRef})`;
    case "begins_with":
      if (value === undefined) {
        throw new Error("begins_with requires a value");
      }
      return `begins_with(${fieldRef}, ${addAttributeValue(context, value)})`;
    case "contains":
      if (value === undefined) {
        throw new Error("contains requires a value");
      }
      return `contains(${fieldRef}, ${addAttributeValue(context, value)})`;
    case "attribute_type":
      if (value === undefined) {
        throw new Error("attribute_type requires a value");
      }
      return `attribute_type(${fieldRef}, ${addAttributeValue(context, value)})`;
    case "size":
      return `size(${fieldRef})`;
    case "BETWEEN":
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error("BETWEEN requires an array of two values");
      }
      return `${fieldRef} BETWEEN ${addAttributeValue(context, value[0])} AND ${addAttributeValue(context, value[1])}`;
    case "IN":
      if (!Array.isArray(value)) {
        throw new Error("IN requires an array");
      }
      const valueRefs = value.map((v) => addAttributeValue(context, v));
      return `${fieldRef} IN (${valueRefs.join(", ")})`;
    default:
      if (value === undefined) {
        throw new Error(`${operator} requires a value`);
      }
      return `${fieldRef} ${operator} ${addAttributeValue(context, value)}`;
  }
}

/**
 * Logical operators.
 */
export type LogicalOperator = "AND" | "OR" | "NOT";

/**
 * Build a logical expression.
 */
export function buildLogical(operator: LogicalOperator, ...expressions: string[]): string {
  if (operator === "NOT") {
    if (expressions.length !== 1) {
      throw new Error("NOT requires exactly one expression");
    }
    return `NOT (${expressions[0]})`;
  }
  if (expressions.length < 2) {
    throw new Error(`${operator} requires at least two expressions`);
  }
  return `(${expressions.join(`) ${operator} (`)})`;
}
