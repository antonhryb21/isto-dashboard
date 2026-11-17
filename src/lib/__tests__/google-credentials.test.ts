import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { googleCredentialsCheck } = await import("@/lib/google-credentials");

const KEY = "-----BEGIN PRIVATE KEY-----\nMIIEabc\ndef==\n-----END PRIVATE KEY-----\n";
const file = JSON.stringify({ type: "service_account", client_email: "isto@p.iam.gserviceaccount.com", private_key: KEY }, null, 2);

afterEach(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
});
const check = (v: string) => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = v;
  return googleCredentialsCheck();
};

describe("googleCredentialsCheck", () => {
  it("reads the file pasted as-is", () => expect(check(file)).toEqual({ creds: { client_email: "isto@p.iam.gserviceaccount.com", private_key: KEY } }));
  it("survives curly quotes from TextEdit", () => expect("creds" in check(file.replace(/"/g, (_, i) => (i % 2 ? "”" : "“")))).toBe(true));
  it("survives real line breaks inside private_key", () => expect("creds" in check(file.replace(/\\n/g, "\n"))).toBe(true));
  it("takes base64 in the plain variable", () => expect("creds" in check(Buffer.from(file).toString("base64"))).toBe(true));
  it("takes the file wrapped in quotes", () => expect("creds" in check(`'${file}'`)).toBe(true));
  it("says what is wrong with an OAuth client file", () => {
    const r = check(JSON.stringify({ web: { client_id: "x" } }));
    expect("problem" in r && r.problem).toMatch(/client_email/);
  });
  it("says when the value is not JSON at all", () => {
    const r = check("my-project-new-make-479610-abc.json");
    expect("problem" in r && r.problem).toMatch(/починатися з «\{»/);
  });
});
