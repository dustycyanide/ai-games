/**
 * zod schemas for the JSON artifacts (capsule manifests, asset records,
 * lockfiles) plus the module shapes (AssetModule, CapsuleModule) that gen.ts
 * and capsule.ts files must satisfy. zod v4 — z.toJSONSchema(Params) drives
 * the playground's auto-generated Tweakpane panel.
 */

import { z } from 'zod';
import type { AssetOutput, GenContext } from './types';

/**
 * capsules/<id>/capsule.json. A capsule is a style contract: palette anchors
 * (OKLCH or hex strings), geometry budget/style hints, motion constants, and
 * the prompts used when an LLM authors assets against this capsule.
 */
export const CapsuleManifestSchema = z.object({
  meta: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    forkedFrom: z.string().optional(),
  }),
  palette: z.object({
    anchors: z.array(z.string()).min(1),
    rules: z.record(z.string(), z.string()).optional(),
  }),
  geometry: z.object({
    maxTriangles: z.number().int().positive(),
    style: z.record(z.string(), z.unknown()),
  }),
  motion: z.record(z.string(), z.union([z.number(), z.array(z.number())])),
  prompts: z.object({
    system: z.string(),
    negative: z.string().optional(),
  }),
});
export type CapsuleManifest = z.infer<typeof CapsuleManifestSchema>;

/** assets/<slug>/asset.json — the saved knobs for one asset. `capsule` is 'id@semver'. */
export const AssetRecordSchema = z.object({
  capsule: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

/**
 * assets/<slug>/asset.lock.json — written by the playground's finalize step.
 * capsuleHash/generatorHash are sha256 hex of the capsule files and gen.ts so
 * a shipped asset can prove which exact code produced it.
 */
export const LockfileSchema = z.object({
  version: z.number().int(),
  capsule: z.string().min(1),
  capsuleHash: z.string().min(1),
  generatorHash: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
  finalizedAt: z.string(),
});
export type Lockfile = z.infer<typeof LockfileSchema>;

/**
 * Shape of an assets/<slug>/gen.ts default export. `Params` is intentionally
 * a loosely-typed ZodObject (pinned contract): each asset narrows its own
 * params via z.infer and the playground only sees the erased shape.
 */
export interface AssetModule {
  Params: z.ZodObject<any>;
  meta: {
    name: string;
    slug: string;
    /** 'id@semver' of the capsule this asset targets. */
    capsule: string;
  };
  generate(ctx: GenContext, params: any): AssetOutput;
}

export interface CapsuleValidation {
  ok: boolean;
  violations: string[];
}

/** Shape of a capsules/<id>/capsule.ts default export. */
export interface CapsuleModule {
  validate(output: AssetOutput, manifest: CapsuleManifest): CapsuleValidation;
}
