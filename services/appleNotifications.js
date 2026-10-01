// App Store Server Notifications (v2) verification.
//
// Apple POSTs a body of { signedPayload: "<JWS>" } to a URL you configure in
// App Store Connect. The JWS is signed with a certificate chain that terminates
// at an Apple root CA, so we verify:
//   1. every link in the x5c chain (leaf -> intermediate -> root)
//   2. the root is pinned to a known Apple root CA
//   3. the JWS signature itself, using the leaf certificate's public key
//
// Those pinned fingerprints are SHA-256 of the DER-encoded Apple root CAs.
// They were read from the macOS system keychain rather than typed from memory:
//   security find-certificate -a -c "Apple Root CA - G3" -p \
//     /System/Library/Keychains/SystemRootCertificates.keychain
const { X509Certificate, createVerify } = require("node:crypto");

const APPLE_ROOT_CA_SHA256 = new Set([
  // Apple Root CA - G3  (current App Store signing root, EC P-384)
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
]);

const b64urlToBuffer = (s) => Buffer.from(s, "base64url");
const normalizeFingerprint = (fp) =>
  String(fp).replaceAll(":", "").toLowerCase();

/**
 * Verify a JWS signed by Apple and return its decoded payload.
 * Throws on any verification failure.
 */
const verifyAppleJws = (jws) => {
  if (typeof jws !== "string") {
    throw new TypeError("signed payload is not a string");
  }

  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("signed payload is not a JWS");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
  } catch {
    throw new Error("signed payload header is not valid JSON");
  }

  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length === 0) {
    throw new Error("signed payload header has no certificate chain");
  }

  // 1 + 2: walk the chain and pin the root.
  const certs = x5c.map((der) => new X509Certificate(b64urlToBuffer(der)));
  for (let i = 0; i < certs.length - 1; i += 1) {
    if (!certs[i].verify(certs[i + 1].publicKey)) {
      throw new Error(`certificate chain broken at link ${i}`);
    }
  }

  const root = certs.at(-1);
  const rootFp = normalizeFingerprint(root.fingerprint256);
  if (!APPLE_ROOT_CA_SHA256.has(rootFp)) {
    throw new Error(
      `certificate chain does not terminate at a known Apple root (${rootFp})`,
    );
  }

  // 3: verify the signature with the leaf certificate.
  const verifier = createVerify("SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(certs[0].publicKey, b64urlToBuffer(signatureB64))) {
    throw new Error("signed payload signature is invalid");
  }

  return JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
};

/**
 * Decode an App Store Server Notification v2 body.
 *
 * @returns {{
 *   notificationType: string,
 *   subtype: string|null,
 *   notificationUUID: string|null,
 *   transaction: object|null,
 *   renewalInfo: object|null,
 * }}
 */
const decodeNotification = (signedPayload) => {
  const notification = verifyAppleJws(signedPayload);
  const data = notification?.data || {};

  // The nested transaction/renewal JWTs are individually signed; verify them
  // too so the fields we act on are authenticated.
  const transaction = data.signedTransactionInfo
    ? verifyAppleJws(data.signedTransactionInfo)
    : null;
  const renewalInfo = data.signedRenewalInfo
    ? verifyAppleJws(data.signedRenewalInfo)
    : null;

  return {
    notificationType: notification.notificationType,
    subtype: notification.subtype || null,
    notificationUUID: notification.notificationUUID || null,
    transaction,
    renewalInfo,
  };
};

/**
 * Notification types that should ADD time (grant or extend a membership).
 */
const GRANTING_TYPES = new Set([
  "SUBSCRIBED",
  "DID_RENEW",
  "OFFER_REDEEMED",
  "RENEWAL_EXTENDED",
  "RENEWAL_EXTENSION",
]);

/**
 * Notification types that should REMOVE the entitlement.
 */
const REVOKING_TYPES = new Set(["EXPIRED", "REFUND", "REVOKE"]);

module.exports = {
  verifyAppleJws,
  decodeNotification,
  GRANTING_TYPES,
  REVOKING_TYPES,
};
