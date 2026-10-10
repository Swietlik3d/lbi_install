import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

export const PASSWORD_MIN_LENGTH = 12;
export const SCRYPT_PARAMS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
});

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid password hash encoding.");
  }
  return Buffer.from(value, "base64url");
}

export async function createPasswordRecord(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > 1024 || /[\r\n\0]/u.test(password)) {
    throw new Error("Password contains unsupported characters or is too long.");
  }

  const salt = crypto.randomBytes(32);
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return {
    version: 1,
    algorithm: "scrypt",
    salt: encode(salt),
    hash: encode(derived),
    params: {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      keylen: SCRYPT_PARAMS.keylen,
      maxmem: SCRYPT_PARAMS.maxmem,
    },
    createdAt: new Date().toISOString(),
  };
}

export function validatePasswordRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Invalid password hash file.");
  }
  const params = record.params;
  if (
    record.version !== 1 ||
    record.algorithm !== "scrypt" ||
    !params ||
    params.N !== SCRYPT_PARAMS.N ||
    params.r !== SCRYPT_PARAMS.r ||
    params.p !== SCRYPT_PARAMS.p ||
    params.keylen !== SCRYPT_PARAMS.keylen ||
    params.maxmem !== SCRYPT_PARAMS.maxmem
  ) {
    throw new Error("Unsupported password hash parameters.");
  }
  const salt = decode(record.salt);
  const hash = decode(record.hash);
  if (salt.length !== 32 || hash.length !== SCRYPT_PARAMS.keylen) {
    throw new Error("Invalid password hash file.");
  }
  return { salt, hash, params };
}

export async function verifyPassword(password, record) {
  const { salt, hash, params } = validatePasswordRecord(record);
  const candidate = typeof password === "string" && password.length <= 1024 ? password : "";
  const derived = await scryptAsync(candidate, salt, params.keylen, params);
  return crypto.timingSafeEqual(hash, derived);
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
