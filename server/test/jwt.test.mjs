import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyPrivyToken,
  verifyEs256Jwt,
  signEs256Jwt,
  generateEs256TestKey,
  checkRegisteredClaims,
  PRIVY_ISSUER,
} from "../lib/jwt.js";

const APP = "cltestappid000000000000";
const DID = "did:privy:cmtestuser00000000000000";

async function mint({ appId = APP, sub = DID, iss = PRIVY_ISSUER, expOffset = 3600, iatOffset = 0, kid, key } = {}) {
  const k = key || await generateEs256TestKey(kid || "test-privy");
  const now = Math.floor(Date.now() / 1000);
  const token = await signEs256Jwt(
    { iss, aud: appId, sub, iat: now + iatOffset, exp: now + expOffset, sid: "sess1" },
    k.privateKey,
    { kid: k.kid }
  );
  return { token, key: k };
}

test("verifyPrivyToken accepts a local ES256 JWT with iss privy.io and aud = app id", async () => {
  const { token, key } = await mint();
  const got = await verifyPrivyToken(token, APP, { getJwks: async () => key.jwks });
  assert.ok(got);
  assert.equal(got.did, DID);
  assert.equal(got.payload.iss, PRIVY_ISSUER);
  assert.equal(got.payload.aud, APP);
});

test("verifyPrivyToken rejects wrong aud, iss, expired, and bad signature", async () => {
  const { token, key } = await mint();
  assert.equal(await verifyPrivyToken(token, "other-app", { getJwks: async () => key.jwks }), null);

  const badIss = await mint({ iss: "not-privy.io" });
  assert.equal(await verifyPrivyToken(badIss.token, APP, { getJwks: async () => badIss.key.jwks }), null);

  const expired = await mint({ expOffset: -10 });
  assert.equal(await verifyPrivyToken(expired.token, APP, { getJwks: async () => expired.key.jwks }), null);

  const other = await generateEs256TestKey("other");
  assert.equal(await verifyPrivyToken(token, APP, { getJwks: async () => other.jwks }), null);

  assert.equal(await verifyPrivyToken("not.a.jwt", APP, { getJwks: async () => key.jwks }), null);
  assert.equal(await verifyPrivyToken(token, "", { getJwks: async () => key.jwks }), null);
});

test("verifyPrivyToken rejects a non did:privy subject", async () => {
  const { token, key } = await mint({ sub: "user:123" });
  assert.equal(await verifyPrivyToken(token, APP, { getJwks: async () => key.jwks }), null);
});

test("verifyEs256Jwt + checkRegisteredClaims cover nbf and missing payload", async () => {
  const { token, key } = await mint();
  const payload = await verifyEs256Jwt(token, { getJwks: async () => key.jwks, iss: PRIVY_ISSUER, aud: APP });
  assert.equal(payload.sub, DID);
  assert.equal(checkRegisteredClaims(null).ok, false);
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(checkRegisteredClaims({ exp: future + 10, nbf: future, iss: PRIVY_ISSUER, aud: APP }, { iss: PRIVY_ISSUER, aud: APP }).ok, false);
});
