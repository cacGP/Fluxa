import { randomBytes, randomUUID } from "node:crypto";
const token=()=>randomBytes(32).toString("base64url");
console.log(`ADMIN_TOKEN=${token()}`);
console.log(`SUB_TOKEN=${token()}`);
console.log(`CLIENT_UUID=${randomUUID()}`);
console.log(`TROJAN_PASSWORD=${token()}`);
