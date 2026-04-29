import process from "node:process";

import {
  DEFAULT_PASSWORD_HASH_ALGORITHM,
  SUPPORTED_PASSWORD_HASH_ALGORITHMS,
  createPasswordHash,
} from "../src/server/password-hash.mjs";

function parseArgs(argv) {
  const config = {
    algorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
    password: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--algorithm") {
      config.algorithm = next || DEFAULT_PASSWORD_HASH_ALGORITHM;
      i += 1;
      continue;
    }

    if (!config.password) {
      config.password = current;
    }
  }

  return config;
}

function main() {
  const { algorithm, password } = parseArgs(process.argv.slice(2));

  if (!password) {
    console.error("Usage: node .\\tools\\workbuddy-password-hash.mjs [--algorithm sha256] <password>");
    console.error(
      `Supported algorithms: ${[...SUPPORTED_PASSWORD_HASH_ALGORITHMS].join(", ")}`
    );
    process.exit(1);
  }

  console.log(createPasswordHash(password, algorithm));
}

main();
