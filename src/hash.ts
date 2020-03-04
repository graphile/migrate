import * as crypto from "crypto";
export const calculateHash = (
  str: string,
  previousHash: string | null,
  algorithm = "sha1",
): string =>
  algorithm +
  ":" +
  crypto
    .createHash(algorithm)
    .update(((previousHash || "") + "\n" + str).trim() + "\n")
    .digest("hex");
