import "server-only";
import { createHmac } from "node:crypto";
import { META } from "@/lib/config";

const BASE = "https://graph.facebook.com";

export class MetaError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
  }
}

function token() {
  const t = process.env.META_SYSTEM_USER_TOKEN;
  if (!t) throw new MetaError("META_SYSTEM_USER_TOKEN is not set");
  return t;
}

function appSecretProof(t: string) {
  const secret = process.env.META_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(t).digest("hex") : undefined;
}

const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004]);

/** GET a Graph API path (e.g. "act_123/insights") with retries on rate limits. */
export async function graph<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const t = token();
  const url = path.startsWith("http") ? new URL(path) : new URL(`${BASE}/${META.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", t);
  const proof = appSecretProof(t);
  if (proof && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", proof);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json()) as T & { error?: { message: string; code?: number; error_subcode?: number } };
    if (!body.error) return body;
    const { message, code, error_subcode } = body.error;
    if (code !== undefined && RETRYABLE.has(code) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    throw new MetaError(message, code, error_subcode);
  }
}

type Page<T> = { data: T[]; paging?: { next?: string } };

/** Follow `paging.next` until exhausted or `max` items collected. */
export async function graphAll<T>(path: string, params: Record<string, string | number | undefined> = {}, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<Page<T>>(path, params);
  out.push(...page.data);
  while (page.paging?.next && out.length < max) {
    page = await graph<Page<T>>(page.paging.next);
    out.push(...page.data);
  }
  return out;
}

/** POST, used to subscribe the Page to the leadgen webhook. */
export async function graphPost<T = unknown>(
  path: string,
  params: Record<string, string>,
  accessToken?: string,
): Promise<T> {
  const t = accessToken ?? token();
  const body = new URLSearchParams({ ...params, access_token: t });
  const proof = appSecretProof(t);
  if (proof) body.set("appsecret_proof", proof);
  const res = await fetch(`${BASE}/${META.apiVersion}/${path}`, { method: "POST", body });
  const json = (await res.json()) as T & { error?: { message: string; code?: number } };
  if (json.error) throw new MetaError(json.error.message, json.error.code);
  return json;
}

/** A Page access token is needed for some Page/lead endpoints; the system user can mint one. */
let pageTokenCache: { token: string; at: number } | null = null;
export async function pageToken(): Promise<string> {
  if (pageTokenCache && Date.now() - pageTokenCache.at < 30 * 60_000) return pageTokenCache.token;
  const res = await graph<{ access_token?: string }>(META.pageId, { fields: "access_token" });
  if (!res.access_token) throw new MetaError("Could not obtain a Page access token. Check the system user's Page access.");
  pageTokenCache = { token: res.access_token, at: Date.now() };
  return res.access_token;
}

/** GET with a Page token instead of the system user token. */
export async function graphAsPage<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const pt = await pageToken();
  const url = new URL(`${BASE}/${META.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", pt);
  const proof = appSecretProof(pt);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as T & { error?: { message: string; code?: number } };
  if (body.error) throw new MetaError(body.error.message, body.error.code);
  return body;
}

export async function graphAllAsPage<T>(path: string, params: Record<string, string | number | undefined> = {}, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let page = await graphAsPage<Page<T>>(path, params);
  out.push(...page.data);
  while (page.paging?.next && out.length < max) {
    const res = await fetch(page.paging.next, { cache: "no-store" });
    page = (await res.json()) as Page<T>;
    out.push(...(page.data ?? []));
  }
  return out;
}
