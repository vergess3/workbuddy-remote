import crypto from "node:crypto";

const DEFAULT_PASSWORD_HASH_ALGORITHM = "sha256";
const SUPPORTED_PASSWORD_HASH_ALGORITHMS = new Set(["sha1", "sha256", "sha512"]);

function validatePasswordHashFormat(input) {
  const rawValue = typeof input === "string" ? input.trim() : "";
  if (!rawValue) {
    return null;
  }

  const parts = rawValue.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid password hash. Expected a Jupyter-style value in the form algorithm:salt:hash."
    );
  }

  const algorithm = parts[0].trim().toLowerCase();
  const salt = parts[1];
  const hash = parts[2].trim().toLowerCase();

  if (!SUPPORTED_PASSWORD_HASH_ALGORITHMS.has(algorithm)) {
    throw new Error(
      `Unsupported password hash algorithm: ${algorithm}. Supported algorithms: ${[
        ...SUPPORTED_PASSWORD_HASH_ALGORITHMS,
      ].join(", ")}.`
    );
  }

  if (!salt) {
    throw new Error("Password hash salt cannot be empty.");
  }

  if (!/^[0-9a-f]+$/i.test(hash) || hash.length % 2 !== 0) {
    throw new Error("Password hash digest must be a hex string.");
  }

  return {
    algorithm,
    salt,
    hash,
    rawValue,
  };
}

function derivePasswordDigest(password, { algorithm, salt }) {
  return crypto.createHash(algorithm).update(String(password), "utf8").update(salt, "utf8").digest("hex");
}

function createPasswordHash(password, algorithm = DEFAULT_PASSWORD_HASH_ALGORITHM) {
  const normalizedAlgorithm = String(algorithm || DEFAULT_PASSWORD_HASH_ALGORITHM).toLowerCase();
  if (!SUPPORTED_PASSWORD_HASH_ALGORITHMS.has(normalizedAlgorithm)) {
    throw new Error(
      `Unsupported password hash algorithm: ${normalizedAlgorithm}. Supported algorithms: ${[
        ...SUPPORTED_PASSWORD_HASH_ALGORITHMS,
      ].join(", ")}.`
    );
  }

  const rawPassword = typeof password === "string" ? password : String(password ?? "");
  if (!rawPassword) {
    throw new Error("Password cannot be empty.");
  }

  const salt = crypto.randomBytes(12).toString("hex");
  const hash = derivePasswordDigest(rawPassword, {
    algorithm: normalizedAlgorithm,
    salt,
  });
  return `${normalizedAlgorithm}:${salt}:${hash}`;
}

function verifyPasswordHash(password, storedHash) {
  const parsed = validatePasswordHashFormat(storedHash);
  if (!parsed) {
    return false;
  }

  const actualHash = derivePasswordDigest(password, parsed);
  const expectedBuffer = Buffer.from(parsed.hash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export {
  DEFAULT_PASSWORD_HASH_ALGORITHM,
  SUPPORTED_PASSWORD_HASH_ALGORITHMS,
  createPasswordHash,
  validatePasswordHashFormat,
  verifyPasswordHash,
};
