import type { GatewayConfigV1 } from "../config/types.js";
import { NineRouterError } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Normalize the configured 9Router /v1 base without changing its origin. */
export function normalizeNineRouterBaseUrl(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new NineRouterError("invalid-url", "connection", "The 9Router base URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NineRouterError("invalid-url", "connection", "The 9Router base URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new NineRouterError("invalid-url", "connection", "The 9Router URL scheme is unsupported");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new NineRouterError("invalid-url", "connection", "The 9Router URL must not contain credentials or query state");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(host)) {
    throw new NineRouterError("invalid-url", "connection", "Non-local 9Router endpoints must use HTTPS");
  }
  const path = url.pathname.replace(/\/+$/u, "");
  if (path === "") url.pathname = "/v1";
  else if (path === "/v1") url.pathname = path;
  else throw new NineRouterError("invalid-url", "connection", "The 9Router base URL must use the /v1 API path");
  return url.toString().replace(/\/$/u, "");
}

export function nineRouterModelsUrl(baseUrl: string): string {
  const normalized = normalizeNineRouterBaseUrl(baseUrl);
  return `${normalized}/models`;
}

export function validateNineRouterGateway(gateway: GatewayConfigV1 | undefined): string {
  if (!gateway || gateway.kind !== "9router" || !gateway.enabled) {
    throw new NineRouterError("invalid-url", "connection", "The 9Router connection is not enabled");
  }
  return normalizeNineRouterBaseUrl(gateway.baseUrl);
}
