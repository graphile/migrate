import * as crypto from "crypto";
export const calculateHash = (str: string, algorithm: string = 'sha1') =>
  algorithm + ':' + crypto
    .createHash(algorithm)
    .update(str)
    .digest("hex");
