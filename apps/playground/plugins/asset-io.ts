/**
 * Node-side asset API as Vite dev-server middleware.
 *
 * POST /api/params    body { slug, capsule, seed, params }
 *   -> validates, writes assets/<slug>/asset.json (pretty, trailing newline),
 *      200 { ok: true }. The client sends `capsule` from the asset module's
 *      meta so the written file is a complete AssetRecord.
 *
 * POST /api/finalize  body { slug }
 *   -> reads assets/<slug>/asset.json + gen.ts and the record's capsule files
 *      (capsules/<id>/capsule.json + capsule.ts), sha256 via node:crypto
 *      (generatorHash = hash of gen.ts; capsuleHash = hash of json + ts
 *      concatenated, in that order), writes assets/<slug>/asset.lock.json
 *      (version 1, finalizedAt ISO), 200 { lockfile }.
 *
 * Validation errors and missing files answer 400 { error }; unexpected
 * failures 500 { error }. Slugs and capsule ids are restricted to [a-z0-9-]
 * so no path escapes the workspace.
 *
 * The zod shapes below mirror @ai-games/schema's AssetRecordSchema and
 * LockfileSchema: this file executes in Vite config scope, where plain Node
 * cannot import the schema package's TS source (documented upstream), so zod
 * is imported directly and the two shapes are duplicated. Keep them in sync
 * with packages/schema/src/schemas.ts.
 */

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';
import { z } from 'zod';

// apps/playground/plugins -> workspace root.
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));

const IdSchema = z.string().regex(/^[a-z0-9-]+$/, 'must match [a-z0-9-]+');

const ParamsBodySchema = z.object({
  slug: IdSchema,
  capsule: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
});

const FinalizeBodySchema = z.object({ slug: IdSchema });

/** Mirror of AssetRecordSchema (see file header). */
const AssetRecordMirror = z.object({
  capsule: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
});

/** Mirror of LockfileSchema (see file header). */
const LockfileMirror = z.object({
  version: z.number().int(),
  capsule: z.string().min(1),
  capsuleHash: z.string().min(1),
  generatorHash: z.string().min(1),
  seed: z.number().int(),
  params: z.record(z.string(), z.unknown()),
  finalizedAt: z.string(),
});

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown, what: string): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, `${what}: ${formatIssues(parsed.error)}`);
  return parsed.data;
}

function sha256(...parts: (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new ApiError(400, 'request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function mustRead(file: string): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch {
    throw new ApiError(400, `missing file: ${path.relative(workspaceRoot, file)}`);
  }
}

async function writePretty(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function assetDir(slug: string): Promise<string> {
  const dir = path.join(workspaceRoot, 'assets', slug);
  try {
    await stat(dir);
  } catch {
    throw new ApiError(400, `unknown asset: ${slug}`);
  }
  return dir;
}

async function handleParams(body: unknown): Promise<{ ok: true }> {
  const { slug, capsule, seed, params } = parseWith(ParamsBodySchema, body, 'invalid body');
  const dir = await assetDir(slug);
  const record = AssetRecordMirror.parse({ capsule, seed, params });
  await writePretty(path.join(dir, 'asset.json'), record);
  return { ok: true };
}

async function handleFinalize(body: unknown): Promise<{ lockfile: z.output<typeof LockfileMirror> }> {
  const { slug } = parseWith(FinalizeBodySchema, body, 'invalid body');
  const dir = await assetDir(slug);

  const recordRaw = await mustRead(path.join(dir, 'asset.json'));
  let recordJson: unknown;
  try {
    recordJson = JSON.parse(recordRaw.toString('utf8'));
  } catch {
    throw new ApiError(400, `assets/${slug}/asset.json is not valid JSON`);
  }
  const record = parseWith(AssetRecordMirror, recordJson, `assets/${slug}/asset.json invalid`);

  const capsuleId = record.capsule.split('@')[0] ?? '';
  parseWith(IdSchema, capsuleId, `capsule id in '${record.capsule}' invalid`);
  const capsuleDir = path.join(workspaceRoot, 'capsules', capsuleId);

  const [genSrc, capsuleJson, capsuleTs] = await Promise.all([
    mustRead(path.join(dir, 'gen.ts')),
    mustRead(path.join(capsuleDir, 'capsule.json')),
    mustRead(path.join(capsuleDir, 'capsule.ts')),
  ]);

  const lockfile = LockfileMirror.parse({
    version: 1,
    capsule: record.capsule,
    capsuleHash: sha256(capsuleJson, capsuleTs),
    generatorHash: sha256(genSrc),
    seed: record.seed,
    params: record.params,
    finalizedAt: new Date().toISOString(),
  });
  await writePretty(path.join(dir, 'asset.lock.json'), lockfile);
  return { lockfile };
}

async function route(req: Connect.IncomingMessage, res: ServerResponse): Promise<void> {
  // The '/api' mount prefix is already stripped from req.url by connect.
  const url = (req.url ?? '').split('?')[0];
  if (req.method !== 'POST') {
    throw new ApiError(405, `method not allowed: ${req.method ?? 'GET'} /api${url}`);
  }
  const body = await readBody(req);
  if (url === '/params') {
    send(res, 200, await handleParams(body));
    return;
  }
  if (url === '/finalize') {
    send(res, 200, await handleFinalize(body));
    return;
  }
  throw new ApiError(404, `no such endpoint: POST /api${url}`);
}

export function assetIoPlugin(): Plugin {
  return {
    name: 'ai-games:asset-io',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        route(req, res).catch((err: unknown) => {
          const status = err instanceof ApiError ? err.status : 500;
          send(res, status, { error: err instanceof Error ? err.message : String(err) });
        });
      });
    },
    // Save/Finalize write assets/<slug>/asset.json + asset.lock.json, which
    // the app imports via import.meta.glob — without this, every Save triggers
    // a full page reload that resets camera/panel/selection. The client's
    // in-memory state already matches what it just saved, so suppress HMR for
    // these files (an external hand-edit then needs a manual browser refresh).
    handleHotUpdate(ctx) {
      const rel = path.relative(workspaceRoot, ctx.file);
      if (/^assets\/[^/]+\/asset(\.lock)?\.json$/.test(rel)) return [];
      return undefined;
    },
  };
}
