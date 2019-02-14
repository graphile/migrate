import * as crypto from "crypto";
export const calculateHash = (str: string) =>
  crypto
    .createHash("sha1")
    .update(str)
    .digest("hex");
