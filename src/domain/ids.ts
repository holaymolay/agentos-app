import crypto from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createToken(): string {
  return crypto.randomUUID();
}
