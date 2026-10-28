import { describe, expect, it } from "vitest";
import { TWILIO_TEST_CODE, twilioCalls, workerFetchTwilio } from "./harness";

// Phone sign-up, production path (no dev bypass, Twilio Verify faked): a brand
// new US number gets a code, verifies, and lands in a fresh account the native
// apps can use over Authorization: Bearer.

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  workerFetchTwilio(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function signUp(phoneNumber: string, headers: Record<string, string> = {}) {
  const sent = await post("/api/auth/phone-number/send-otp", { phoneNumber }, headers);
  const verified = await post("/api/auth/phone-number/verify", { phoneNumber, code: TWILIO_TEST_CODE }, headers);
  return { sent, verified };
}

describe("phone sign-up (US numbers)", () => {
  it("a new US number signs up and gets a working bearer session", async () => {
    const { sent, verified } = await signUp("+14155550101", { "x-skcal-client": "ios" });
    expect(sent.status).toBe(200);
    expect(twilioCalls).toContainEqual({ path: "Verifications", to: "+14155550101" });
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as { user: { email: string; phoneNumber: string } };
    expect(body.user.phoneNumber).toBe("+14155550101");
    expect(body.user.email).toBe("14155550101@phone.skcal.fit");

    const token = verified.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    const session = await workerFetchTwilio("/api/auth/get-session", { headers: { authorization: `Bearer ${token}` } });
    expect(((await session.json()) as { user: { phoneNumber: string } }).user.phoneNumber).toBe("+14155550101");
  });

  it("a wrong code is rejected and creates no account", async () => {
    await post("/api/auth/phone-number/send-otp", { phoneNumber: "+14155550102" });
    const res = await post("/api/auth/phone-number/verify", { phoneNumber: "+14155550102", code: "000000" });
    expect(res.status).toBe(400);
  });

  // The OS HTTP stack (NSURLSession / OkHttp) keeps the session cookie /verify
  // set and replays it, with no Origin header, on the next sign-in. That must
  // not trip Better Auth's CSRF check for the native apps.
  it.each(["ios", "android"])("%s: a leftover cookie doesn't block signing up again", async (client) => {
    const phone = client === "ios" ? "+14155550103" : "+14155550104";
    const { sent, verified } = await signUp(phone, {
      "x-skcal-client": client,
      cookie: "__Secure-better-auth.session_token=stale.signature; __cf_bm=abc",
    });
    expect(sent.status).toBe(200);
    expect(verified.status).toBe(200);
  });

  it("browsers still need a trusted Origin when they send cookies", async () => {
    const res = await post(
      "/api/auth/phone-number/send-otp",
      { phoneNumber: "+14155550105" },
      { cookie: "__Secure-better-auth.session_token=stale.signature" },
    );
    expect(res.status).toBe(403);
  });

  it("numbers outside +1 are refused before any SMS", async () => {
    const before = twilioCalls.length;
    const res = await post("/api/auth/phone-number/send-otp", { phoneNumber: "+263771234567" });
    expect(res.status).toBe(400);
    expect(twilioCalls.length).toBe(before);
  });
});
