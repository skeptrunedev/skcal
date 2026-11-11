import { describe, expect, it } from "vitest";
import {
  APPLE_BUNDLE_ID,
  appleBillingState,
  appleIapConfigured,
  appleJwtParts,
  appleJwtSigningInput,
  appleStatusCodeToBilling,
  billingRowActive,
  decodeJwsPayload,
  signAppleJwt,
  type AppleTransactionInfo,
} from "../src/worker/apple";
import { seedBillingRow, workerFetchBilling } from "./harness";

// Apple in-app purchase, kept to sync App Store subscriptions bought before
// skcal went free. Everything provable without Apple's servers is proven here:
// JWT construction and signing, the notification/transaction to billing state
// mapping, which rows count as a live subscription, and /api/billing.
//
// NOT covered, and not coverable until the Paid Applications Agreement is signed
// and a subscription product exists: any real round trip against the App Store
// Server API, and any real StoreKit purchase.

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-26T12:00:00Z");

// ---- base64url / JWS --------------------------------------------------------

describe("apple: JWS decoding", () => {
  it("reads the payload out of a three-part JWS", () => {
    const b64u = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const jws = `${b64u({ alg: "ES256" })}.${b64u({ transactionId: "2000000900000001" })}.sig`;
    expect(decodeJwsPayload<{ transactionId: string }>(jws).transactionId).toBe("2000000900000001");
  });

  it("rejects anything that is not a three-part JWS", () => {
    expect(() => decodeJwsPayload("nope")).toThrow();
    expect(() => decodeJwsPayload("a.b")).toThrow();
  });
});

// ---- JWT construction + signing --------------------------------------------

describe("apple: App Store Server API JWT", () => {
  it("builds the exact header and payload Apple documents", () => {
    const parts = appleJwtParts("ABC123KEY", "issuer-uuid", NOW);
    expect(parts.header).toEqual({ alg: "ES256", kid: "ABC123KEY", typ: "JWT" });
    expect(parts.payload.iss).toBe("issuer-uuid");
    expect(parts.payload.aud).toBe("appstoreconnect-v1");
    expect(parts.payload.bid).toBe(APPLE_BUNDLE_ID);
    expect(parts.payload.iat).toBe(Math.floor(NOW / 1000));
    // Apple rejects tokens valid for more than an hour.
    expect(parts.payload.exp - parts.payload.iat).toBeGreaterThan(0);
    expect(parts.payload.exp - parts.payload.iat).toBeLessThanOrEqual(3600);
  });

  it("signing input is base64url header.payload with no padding", () => {
    const input = appleJwtSigningInput(appleJwtParts("K", "I", NOW));
    expect(input.split(".")).toHaveLength(2);
    expect(input).not.toContain("=");
    expect(input).not.toContain("+");
    expect(input).not.toContain("/");
    const header = JSON.parse(Buffer.from(input.split(".")[0], "base64url").toString());
    expect(header.alg).toBe("ES256");
  });

  it("appleIapConfigured needs all three secrets", () => {
    expect(appleIapConfigured({})).toBe(false);
    expect(appleIapConfigured({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i" })).toBe(false);
    expect(appleIapConfigured({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i", APPLE_IAP_PRIVATE_KEY: "p" })).toBe(
      true,
    );
  });

  it("signAppleJwt produces an ES256 JWS that verifies against the public key", async () => {
    // A throwaway P-256 key in the same PKCS#8 PEM shape Apple hands out as .p8.
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;

    const jwt = await signAppleJwt(
      { APPLE_IAP_KEY_ID: "KEYID12345", APPLE_IAP_ISSUER_ID: "issuer-uuid", APPLE_IAP_PRIVATE_KEY: pem },
      NOW,
    );
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString()).kid).toBe("KEYID12345");
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).aud).toBe("appstoreconnect-v1");
    // Raw r||s, 64 bytes for P-256 — the JWS ES256 form, not DER.
    expect(Buffer.from(s, "base64url")).toHaveLength(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      Buffer.from(s, "base64url"),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("accepts a key stored with literal \\n escapes", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const escaped = `-----BEGIN PRIVATE KEY-----\\n${pkcs8}\\n-----END PRIVATE KEY-----`;
    await expect(
      signAppleJwt({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i", APPLE_IAP_PRIVATE_KEY: escaped }, NOW),
    ).resolves.toContain(".");
  });

  it("refuses to sign when the secrets are missing", async () => {
    await expect(signAppleJwt({}, NOW)).rejects.toThrow(/not configured/);
  });
});

// ---- notification / transaction → billing state -----------------------------

function tx(over: Partial<AppleTransactionInfo> = {}): AppleTransactionInfo {
  return {
    transactionId: "2000000900000001",
    originalTransactionId: "2000000800000001",
    bundleId: APPLE_BUNDLE_ID,
    productId: "fit.skcal.app.monthly",
    purchaseDate: NOW - DAY,
    expiresDate: NOW + 29 * DAY,
    type: "Auto-Renewable Subscription",
    ...over,
  };
}

describe("apple: status code mapping", () => {
  it("maps Apple's subscription status codes", () => {
    expect(appleStatusCodeToBilling(1)).toBe("active");
    expect(appleStatusCodeToBilling(2)).toBe("expired");
    expect(appleStatusCodeToBilling(3)).toBe("billing_retry");
    expect(appleStatusCodeToBilling(4)).toBe("grace_period");
    expect(appleStatusCodeToBilling(5)).toBe("revoked");
  });

  it("fails closed on a status code Apple has not shipped yet", () => {
    expect(appleStatusCodeToBilling(99)).toBe("expired");
    expect(appleStatusCodeToBilling(0)).toBe("expired");
  });
});

describe("apple: notification → billing state", () => {
  it("SUBSCRIBED / DID_RENEW with status 1 is active through the new period end", () => {
    const state = appleBillingState(tx({ expiresDate: NOW + 30 * DAY }), {
      statusCode: 1,
      notificationType: "DID_RENEW",
      now: NOW,
    });
    expect(state).toEqual({ status: "active", currentPeriodEnd: NOW + 30 * DAY });
  });

  it("a free-trial transaction reports trialing rather than active", () => {
    expect(appleBillingState(tx({ offerDiscountType: "FREE_TRIAL" }), { statusCode: 1, now: NOW }).status).toBe(
      "trialing",
    );
    expect(appleBillingState(tx({ offerType: 1 }), { statusCode: 1, now: NOW }).status).toBe("trialing");
  });

  it("turning auto-renew off does NOT revoke: access lasts to the period end", () => {
    // This is the cancellation case App Review actually exercises. Apple keeps
    // status 1 until the paid period runs out, and so must we.
    const state = appleBillingState(tx(), {
      statusCode: 1,
      notificationType: "DID_CHANGE_RENEWAL_STATUS",
      subtype: "AUTO_RENEW_DISABLED",
      now: NOW,
    });
    expect(state.status).toBe("active");
    expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(true);
  });

  it("DID_FAIL_TO_RENEW with a grace period keeps access", () => {
    const state = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 4,
      notificationType: "DID_FAIL_TO_RENEW",
      subtype: "GRACE_PERIOD",
      now: NOW,
    });
    expect(state.status).toBe("grace_period");
    expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(true);
  });

  it("DID_FAIL_TO_RENEW without a grace period is billing retry", () => {
    const state = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 3,
      notificationType: "DID_FAIL_TO_RENEW",
      now: NOW,
    });
    expect(state.status).toBe("billing_retry");
    // Short courtesy window, then it lapses.
    expect(billingRowActive({ status: "billing_retry", currentPeriodEnd: NOW - DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "billing_retry", currentPeriodEnd: NOW - 10 * DAY }, NOW)).toBe(false);
  });

  it("EXPIRED and GRACE_PERIOD_EXPIRED end access", () => {
    const expired = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 2,
      notificationType: "EXPIRED",
      subtype: "VOLUNTARY",
      now: NOW,
    });
    expect(expired.status).toBe("expired");
    expect(billingRowActive({ status: expired.status, currentPeriodEnd: expired.currentPeriodEnd }, NOW)).toBe(false);

    const graceOver = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      notificationType: "GRACE_PERIOD_EXPIRED",
      now: NOW,
    });
    expect(graceOver.status).toBe("expired");
  });

  it("REFUND and REVOKE revoke immediately, even mid-period", () => {
    for (const notificationType of ["REFUND", "REVOKE"]) {
      const state = appleBillingState(tx({ expiresDate: NOW + 20 * DAY }), { notificationType, now: NOW });
      expect(state.status).toBe("revoked");
      expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(false);
    }
  });

  it("a revocationDate on the transaction beats an 'active' status code", () => {
    const state = appleBillingState(tx({ revocationDate: NOW - 60_000 }), { statusCode: 1, now: NOW });
    expect(state.status).toBe("revoked");
  });

  it("with no status code it falls back to the expiry date on the transaction", () => {
    expect(appleBillingState(tx({ expiresDate: NOW + DAY }), { now: NOW }).status).toBe("active");
    expect(appleBillingState(tx({ expiresDate: NOW - DAY }), { now: NOW }).status).toBe("expired");
  });
});

// ---- source-aware entitlement -----------------------------------------------

describe("apple: live subscription", () => {
  it("a row is live only for statuses that should keep a subscriber billed", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW + DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "trialing", currentPeriodEnd: NOW + DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "past_due", currentPeriodEnd: NOW - 30 * DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "grace_period", currentPeriodEnd: NOW - DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "canceled", currentPeriodEnd: NOW + DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: "expired", currentPeriodEnd: NOW - DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: "revoked", currentPeriodEnd: NOW + DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: null }, NOW)).toBe(false);
    expect(billingRowActive(undefined, NOW)).toBe(false);
  });

  it("keeps a 3-day slop past the period end so renewal lag never locks anyone out", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW - 2 * DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW - 4 * DAY }, NOW)).toBe(false);
  });

  it("accepts Date as well as epoch ms (Drizzle hands back Date)", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: new Date(NOW + DAY) }, NOW)).toBe(true);
  });
});

// ---- routes (billing configured, IAP keys absent) ---------------------------
// These run against a Worker instance with STRIPE_SECRET_KEY bound, the way
// production runs, so they prove billing being configured gates nothing.

const phone = (n: string) => `1555000${n}@phone.skcal.fit`;

function asPhoneUser(email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return workerFetchBilling(path, { ...init, headers });
}

describe("apple: routes without IAP keys configured", () => {
  it("POST /api/apple/verify → 503 iap_not_configured, not a 500", async () => {
    const res = await asPhoneUser(phone("100"), "/api/apple/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: "2000000900000001" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "IAP not configured", code: "iap_not_configured" });
  });

  // Apple retries any non-2xx for days, so an unconfigured worker must still
  // ACK — this is also what makes App Store Connect's "Send Test Notification"
  // pass before the IAP keys exist.
  it("POST /api/apple/notifications → ACKs without keys, and needs no session at all", async () => {
    const res = await workerFetchBilling("/api/apple/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload: "a.b.c" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: "iap not configured" });
  });
});

type BillingBody = { source: string | null; status: string | null; periodEnd: number | null };
const billingOf = async (email: string) => (await (await asPhoneUser(email, "/api/billing")).json()) as BillingBody;
const NO_SUBSCRIPTION: BillingBody = { source: null, status: null, periodEnd: null };

describe("free access and /api/billing", () => {
  it("an account that never subscribed reaches data routes", async () => {
    const res = await asPhoneUser(phone("200"), "/api/dashboard");
    expect(res.status).toBe(200);
    expect(await billingOf(phone("200"))).toEqual(NO_SUBSCRIPTION);
  });

  it("an account whose subscriptions all lapsed reaches data routes and reports none", async () => {
    const email = phone("204");
    await seedBillingRow({ userEmail: email, source: "apple", status: "expired", currentPeriodEnd: Date.now() - 10 * DAY });
    await seedBillingRow({ userEmail: email, source: "stripe", status: "canceled", currentPeriodEnd: Date.now() - 10 * DAY });
    expect((await asPhoneUser(email, "/api/dashboard")).status).toBe(200);
    expect(await billingOf(email)).toEqual(NO_SUBSCRIPTION);
  });

  it("reports a live Apple subscription even next to a dead Stripe one", async () => {
    const email = phone("202");
    const periodEnd = Date.now() + 25 * DAY;
    await seedBillingRow({ userEmail: email, source: "stripe", status: "canceled", currentPeriodEnd: Date.now() - 40 * DAY });
    await seedBillingRow({ userEmail: email, source: "apple", status: "active", currentPeriodEnd: periodEnd });
    expect(await billingOf(email)).toEqual({ source: "apple", status: "active", periodEnd });
  });

  it("reports a live Stripe subscription even next to a revoked Apple one", async () => {
    const email = phone("203");
    await seedBillingRow({ userEmail: email, source: "apple", status: "revoked", currentPeriodEnd: Date.now() + 25 * DAY });
    await seedBillingRow({ userEmail: email, source: "stripe", status: "active", currentPeriodEnd: Date.now() + 25 * DAY });
    expect((await billingOf(email)).source).toBe("stripe");
  });
});
