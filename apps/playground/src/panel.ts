/**
 * z.toJSONSchema(Params) -> Tweakpane walker.
 *
 * Mapping (pinned contract):
 *   number/integer with minimum+maximum -> slider; step comes from multipleOf,
 *     else 1 for integers, else (max - min) / 100
 *   boolean -> checkbox
 *   enum -> list
 *   string -> text
 *   nested object -> folder, recursed
 *
 * Controls read/write `target` in place. Change events bubble up to the Pane,
 * so callers subscribe once with pane.on('change', ...). Unsupported nodes
 * (arrays, unions, ...) are skipped and reported back so the caller can
 * surface them instead of silently dropping params.
 */

import type { FolderApi } from '@tweakpane/core';
import type { Pane } from 'tweakpane';

/** The slice of JSON Schema the walker understands (zod v4 z.toJSONSchema output). */
export interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
}

type Container = Pane | FolderApi;

/** Walks the schema's properties into `container`, binding values on `target`. Returns skipped keys. */
export function buildParamsPanel(
  container: Container,
  schema: JsonSchemaNode,
  target: Record<string, unknown>,
): string[] {
  const skipped: string[] = [];
  walk(container, schema, target, '', skipped);
  return skipped;
}

function walk(
  container: Container,
  schema: JsonSchemaNode,
  target: Record<string, unknown>,
  prefix: string,
  skipped: string[],
): void {
  for (const [key, node] of Object.entries(schema.properties ?? {})) {
    addControl(container, key, node, target, prefix, skipped);
  }
}

function addControl(
  container: Container,
  key: string,
  node: JsonSchemaNode,
  target: Record<string, unknown>,
  prefix: string,
  skipped: string[],
): void {
  const path = prefix === '' ? key : `${prefix}.${key}`;

  // Nested object -> folder.
  if (node.properties !== undefined || node.type === 'object') {
    if (typeof target[key] !== 'object' || target[key] === null) {
      target[key] = defaultFor(node) ?? {};
    }
    const folder = container.addFolder({ title: key });
    walk(folder, node, target[key] as Record<string, unknown>, path, skipped);
    return;
  }

  // Make sure a value exists before binding: Tweakpane infers the control
  // from the current value, so undefined must be filled in first.
  if (target[key] === undefined) {
    const fallback = defaultFor(node);
    if (fallback !== undefined) target[key] = fallback;
  }

  if (node.enum !== undefined && node.enum.length > 0) {
    if (target[key] === undefined) target[key] = node.enum[0];
    container.addBinding(target, key, {
      options: node.enum.map((value) => ({ text: String(value), value })),
    });
    return;
  }

  switch (node.type) {
    case 'number':
    case 'integer': {
      if (typeof target[key] !== 'number') target[key] = node.minimum ?? 0;
      const min = node.minimum ?? node.exclusiveMinimum;
      const max = node.maximum ?? node.exclusiveMaximum;
      const step =
        node.multipleOf ??
        (node.type === 'integer'
          ? 1
          : min !== undefined && max !== undefined
            ? (max - min) / 100
            : undefined);
      container.addBinding(target, key, { min, max, step });
      return;
    }
    case 'boolean': {
      if (typeof target[key] !== 'boolean') target[key] = false;
      container.addBinding(target, key);
      return;
    }
    case 'string': {
      if (typeof target[key] !== 'string') target[key] = '';
      container.addBinding(target, key);
      return;
    }
    default:
      skipped.push(path);
  }
}

function defaultFor(node: JsonSchemaNode): unknown {
  if (node.default !== undefined) return node.default;
  if (node.const !== undefined) return node.const;
  return undefined;
}
