/**
 * A certificate authority and a server certificate issued by it, made fresh for each test run.
 *
 * Nothing is committed: a committed key pair expires one day and turns the test that uses it into
 * a failure nobody caused. `openssl` is not on every machine the suite runs on, and `node:crypto`
 * has keys and signatures but no certificates, so the certificates are assembled here, in DER, from
 * the few X.509 structures a TLS server certificate needs, and signed with `node:crypto`.
 *
 * Test-only. ECDSA P-256 with SHA-256, valid from an hour ago to a day from now.
 */
import {
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

/** DER tags (X.690) of the types a certificate uses. */
const TAG_BOOLEAN = 0x01;
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_OID = 0x06;
const TAG_UTF8_STRING = 0x0c;
const TAG_UTC_TIME = 0x17;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
/** `[0] EXPLICIT` — the certificate's version. */
const TAG_VERSION = 0xa0;
/** `[3] EXPLICIT` — the certificate's extensions. */
const TAG_EXTENSIONS = 0xa3;
/** `[2] IMPLICIT IA5String` — a `dNSName` in `subjectAltName`. */
const TAG_DNS_NAME = 0x82;

/** A length that fits in the short form: one byte, high bit clear. */
const SHORT_LENGTH_LIMIT = 0x80;
/** The high bit: long-form length in a length byte, "more follows" in an OID sub-identifier. */
const HIGH_BIT = 0x80;
const LOW_SEVEN_BITS = 0x7f;
const BYTE_MASK = 0xff;
/** How many values one byte holds: the base of a long-form length. */
const BYTE_VALUES = 0x100;
const BITS_PER_OID_DIGIT = 7;
/** The first two OID arcs share one byte: `first * 40 + second`. */
const FIRST_ARC_FACTOR = 40;

const OID_COMMON_NAME = '2.5.4.3';
const OID_ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

/** `keyUsage` bits, most significant first: `digitalSignature` is bit 0, `keyCertSign` bit 5. */
const DIGITAL_SIGNATURE = 0x80;
const KEY_CERT_SIGN = 0x04;
const CRL_SIGN = 0x02;
/** The trailing bits of the `keyUsage` byte that name nothing: after `cRLSign`, after `digitalSignature`. */
const CA_UNUSED_BITS = 1;
const SERVER_UNUSED_BITS = 7;
const CA_KEY_USAGE = { bits: KEY_CERT_SIGN | CRL_SIGN, unused: CA_UNUSED_BITS };
const SERVER_KEY_USAGE = { bits: DIGITAL_SIGNATURE, unused: SERVER_UNUSED_BITS };
/** X.509 v3 is version `2`. */
const X509_V3 = 2;
const SERIAL_BYTES = 16;
const CENTURY = 100;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const encoder = new TextEncoder();

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};

/** One DER element: tag, definite length, content. */
const element = (tag: number, content: Uint8Array): Uint8Array => {
  if (content.length < SHORT_LENGTH_LIMIT) {
    return concat(new Uint8Array([tag, content.length]), content);
  }

  const lengthBytes: number[] = [];
  for (let rest = content.length; rest > 0; rest = Math.floor(rest / BYTE_VALUES)) {
    lengthBytes.unshift(rest % BYTE_VALUES);
  }

  return concat(new Uint8Array([tag, HIGH_BIT | lengthBytes.length, ...lengthBytes]), content);
};

const sequence = (...items: Uint8Array[]) => element(TAG_SEQUENCE, concat(...items));
const setOf = (...items: Uint8Array[]) => element(TAG_SET, concat(...items));
const boolean = (value: boolean) => element(TAG_BOOLEAN, new Uint8Array([value ? BYTE_MASK : 0]));
const octetString = (bytes: Uint8Array) => element(TAG_OCTET_STRING, bytes);
const bitString = (bytes: Uint8Array, unusedBits = 0) =>
  element(TAG_BIT_STRING, concat(new Uint8Array([unusedBits]), bytes));

const objectId = (dotted: string): Uint8Array => {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * FIRST_ARC_FACTOR + second];
  for (const arc of rest) {
    const digits = [arc & LOW_SEVEN_BITS];
    for (let high = arc >> BITS_PER_OID_DIGIT; high > 0; high >>= BITS_PER_OID_DIGIT) {
      digits.unshift((high & LOW_SEVEN_BITS) | HIGH_BIT);
    }
    bytes.push(...digits);
  }

  return element(TAG_OID, new Uint8Array(bytes));
};

const utcTime = (date: Date): Uint8Array => {
  const two = (value: number) => String(value).padStart(2, '0');
  const text = [
    date.getUTCFullYear() % CENTURY,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ].map(two).join('');

  return element(TAG_UTC_TIME, encoder.encode(`${text}Z`));
};

const distinguishedName = (commonName: string) =>
  sequence(setOf(sequence(objectId(OID_COMMON_NAME), element(TAG_UTF8_STRING, encoder.encode(commonName)))));

const extension = (id: string, critical: boolean, value: Uint8Array) =>
  sequence(objectId(id), ...(critical ? [boolean(true)] : []), octetString(value));

const toPem = (label: string, der: Uint8Array): string => {
  const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
};

interface Issued {
  certificatePem: string;
  privateKey: KeyObject;
  /** The DER of the subject name, which is the issuer name of what this one signs. */
  subject: Uint8Array;
}

const issue = (
  commonName: string,
  role: { ca: true } | { ca: false; dnsNames: readonly string[]; issuer: Issued },
): Issued => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = randomBytes(SERIAL_BYTES);
  // A positive INTEGER: clear the sign bit
  serial[0] &= LOW_SEVEN_BITS;
  const now = Date.now();
  const algorithm = sequence(objectId(OID_ECDSA_WITH_SHA256));
  const subject = distinguishedName(commonName);
  const keyUsage = role.ca ? CA_KEY_USAGE : SERVER_KEY_USAGE;
  const extensions = [
    extension(OID_BASIC_CONSTRAINTS, true, role.ca ? sequence(boolean(true)) : sequence()),
    extension(OID_KEY_USAGE, true, bitString(new Uint8Array([keyUsage.bits]), keyUsage.unused)),
    ...(role.ca ? [] : [
      extension(
        OID_SUBJECT_ALT_NAME,
        false,
        sequence(...role.dnsNames.map((name) => element(TAG_DNS_NAME, encoder.encode(name)))),
      ),
      extension(OID_EXT_KEY_USAGE, false, sequence(objectId(OID_SERVER_AUTH))),
    ]),
  ];
  const toBeSigned = sequence(
    element(TAG_VERSION, element(TAG_INTEGER, new Uint8Array([X509_V3]))),
    element(TAG_INTEGER, new Uint8Array(serial)),
    algorithm,
    role.ca ? subject : role.issuer.subject,
    sequence(utcTime(new Date(now - HOUR_MS)), utcTime(new Date(now + DAY_MS))),
    subject,
    new Uint8Array(publicKey.export({ type: 'spki', format: 'der' })),
    element(TAG_EXTENSIONS, sequence(...extensions)),
  );
  // ECDSA signatures from `sign` are DER-encoded, which is what X.509 wants
  const signature = sign('sha256', toBeSigned, role.ca ? privateKey : role.issuer.privateKey);

  return {
    certificatePem: toPem('CERTIFICATE', sequence(toBeSigned, algorithm, bitString(new Uint8Array(signature)))),
    privateKey,
    subject,
  };
};

/** PEM files for a TLS server, and the CA a client has to trust to verify it. */
export interface TestCertificates {
  /** The CA certificate: what a client trusts, for example through `NODE_EXTRA_CA_CERTS`. */
  caPem: string;
  /** The server certificate, issued by the CA for `dnsNames`. */
  certPem: string;
  /** The server certificate's private key, PKCS#8. */
  keyPem: string;
}

/** A fresh CA, and a server certificate from it whose `subjectAltName` lists `dnsNames`. */
export const makeTestCertificates = (dnsNames: readonly string[]): TestCertificates => {
  const ca = issue('OneBun test CA', { ca: true });
  const server = issue(dnsNames[0] ?? 'localhost', { ca: false, dnsNames, issuer: ca });

  return {
    caPem: ca.certificatePem,
    certPem: server.certificatePem,
    keyPem: String(server.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  };
};
