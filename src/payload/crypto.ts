// Session cryptography for the simulated recon datalink: ephemeral ECDH
// P-256, HKDF-SHA256, then AES-256-GCM per item. The aircraft's session key
// lives in one SecureElement; zeroize overwrites what JavaScript exposes and
// drops the rest. WebCrypto can demonstrate this protocol but cannot promise
// heap zeroization - production uses a hardware secure element and a certified
// link (README / ASSUMPTIONS).
import type { AdversaryOutcome } from './types';

export const SESSION_KEY_BYTES = 32;
export const GCM_NONCE_BYTES = 12;
const HKDF_SALT = new TextEncoder().encode('aerotwin/datalink/session/v1');
const HKDF_INFO = new TextEncoder().encode('recon payload aes-256-gcm');

export interface EcdhKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export interface DerivedSessionKey {
  key: CryptoKey;
  /** Raw HKDF output, held only so the demo can overwrite it on zeroize. */
  raw: Uint8Array;
}

export interface CipherRecord {
  id: number;
  nonce: Uint8Array;
  data: Uint8Array;
  /** SHA-256 of the plaintext, lowercase hex. */
  hash: string;
}

export interface GroundReceiveResult {
  verified: boolean;
  plaintext: Uint8Array | null;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WEB CRYPTO UNAVAILABLE');
  return s;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, length));
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await subtle().digest('SHA-256', arrayBufferOf(data));
  return bytesToHex(new Uint8Array(digest));
}

/** Copy into an ArrayBuffer-backed view; WebCrypto typings reject the generic form. */
function arrayBufferOf(data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  const pair = await subtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

/**
 * Both sides call this with their own private key and the peer's public key;
 * they land on the same AES-GCM key. The raw output is returned separately for
 * SecureElement ownership and is never stored anywhere else.
 */
export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<DerivedSessionKey> {
  const s = subtle();
  const sharedBuffer = await s.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );
  const shared = new Uint8Array(sharedBuffer);
  try {
    const base = await s.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
    const bits = await s.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
      base,
      SESSION_KEY_BYTES * 8,
    );
    const raw = new Uint8Array(bits);
    const key = await s.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    return { key, raw };
  } finally {
    shared.fill(0);
  }
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const buffer = await subtle().encrypt(
    { name: 'AES-GCM', iv: arrayBufferOf(nonce) },
    key,
    arrayBufferOf(plaintext),
  );
  return { nonce, ciphertext: new Uint8Array(buffer) };
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const buffer = await subtle().decrypt(
    { name: 'AES-GCM', iv: arrayBufferOf(nonce) },
    key,
    arrayBufferOf(ciphertext),
  );
  return new Uint8Array(buffer);
}

/**
 * The aircraft side. It owns the only CryptoKey used to encrypt recon items and
 * the ciphertext records themselves, so a single zeroize call covers both.
 */
export class SecureElement {
  private key: CryptoKey | null;
  private keyBytes: Uint8Array;
  private records = new Map<number, CipherRecord>();
  private lockedAt: number | null = null;

  constructor(key: CryptoKey, keyBytes: Uint8Array) {
    this.key = key;
    this.keyBytes = keyBytes;
  }

  get locked(): boolean {
    return this.lockedAt !== null;
  }

  get lockedAtMs(): number | null {
    return this.lockedAt;
  }

  get recordCount(): number {
    return this.records.size;
  }

  hasRecord(id: number): boolean {
    return this.records.has(id);
  }

  getRecord(id: number): CipherRecord | undefined {
    return this.records.get(id);
  }

  /** Encrypt into the element. Refuses once the element is locked. */
  async store(id: number, plaintext: Uint8Array): Promise<CipherRecord> {
    if (!this.key) throw new Error('SECURE ELEMENT LOCKED');
    const { nonce, ciphertext } = await aesGcmEncrypt(this.key, plaintext);
    // zeroize may have run while the encrypt promise was in flight.
    if (this.lockedAt !== null) {
      globalThis.crypto.getRandomValues(ciphertext);
      throw new Error('SECURE ELEMENT LOCKED');
    }
    const hash = await sha256Hex(plaintext);
    if (this.lockedAt !== null) {
      globalThis.crypto.getRandomValues(ciphertext);
      throw new Error('SECURE ELEMENT LOCKED');
    }
    const record: CipherRecord = { id, nonce, data: ciphertext, hash };
    this.records.set(id, record);
    return record;
  }

  /**
   * Overwrite the exposed key bytes and every stored ciphertext block, drop the
   * CryptoKey reference and lock the element. Returns the number of records
   * destroyed. The CryptoKey itself has no destruction API in WebCrypto.
   */
  zeroize(atMs: number): number {
    if (this.lockedAt !== null) return 0;
    globalThis.crypto.getRandomValues(this.keyBytes);
    this.keyBytes.fill(0);
    this.key = null;
    for (const record of this.records.values()) {
      globalThis.crypto.getRandomValues(record.nonce);
      globalThis.crypto.getRandomValues(record.data);
    }
    this.lockedAt = atMs;
    return this.records.size;
  }

  /**
   * Stand-in for an adversary who has the hardware but not the key: every
   * decrypt is attempted with a fresh random AES key and every authentication
   * tag check must fail. Intended to be called after zeroize.
   */
  async adversaryRecoveryAttempt(atMs: number): Promise<AdversaryOutcome> {
    if (!this.locked) throw new Error('ADVERSARY ATTEMPT REQUIRES A LOCKED ELEMENT');
    const records = [...this.records.values()];
    const decoy = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'decrypt',
    ]);
    let failed = 0;
    for (const record of records) {
      try {
        const plaintext = await aesGcmDecrypt(decoy, record.nonce, record.data);
        const hash = await sha256Hex(plaintext);
        if (hash !== record.hash) failed++;
      } catch {
        failed++;
      }
    }
    return {
      status: 'FAILED',
      attempted: records.length,
      failed,
      atMs,
      detail:
        records.length > 0
          ? `Key destroyed. All ${records.length} stored blocks failed authentication.`
          : 'Key destroyed. No ciphertext remained onboard.',
    };
  }
}

/** The ground end of the link: decrypts a delivered record and checks its hash. */
export class GroundStation {
  constructor(private readonly key: CryptoKey) {}

  async receive(record: CipherRecord): Promise<GroundReceiveResult> {
    try {
      const plaintext = await aesGcmDecrypt(this.key, record.nonce, record.data);
      const hash = await sha256Hex(plaintext);
      if (hash !== record.hash) return { verified: false, plaintext: null };
      return { verified: true, plaintext };
    } catch {
      return { verified: false, plaintext: null };
    }
  }
}

/** Defensive copy used when dispatch and zeroize can interleave. */
export function snapshotRecord(record: CipherRecord): CipherRecord {
  return {
    id: record.id,
    nonce: record.nonce.slice(),
    data: record.data.slice(),
    hash: record.hash,
  };
}
