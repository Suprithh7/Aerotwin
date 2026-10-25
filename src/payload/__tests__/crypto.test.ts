import { describe, expect, it } from 'vitest';
import {
  GroundStation,
  SecureElement,
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToHex,
  deriveSessionKey,
  generateEcdhKeyPair,
  hexToBytes,
  randomBytes,
  sha256Hex,
  snapshotRecord,
} from '../crypto';

const PLAINTEXT = new TextEncoder().encode('AEROTWIN RECON // ITEM 01 // SENSOR FRAME');

async function sessionPair() {
  const ground = await generateEcdhKeyPair();
  const aircraft = await generateEcdhKeyPair();
  const [groundKey, aircraftKey] = await Promise.all([
    deriveSessionKey(ground.privateKey, aircraft.publicKey),
    deriveSessionKey(aircraft.privateKey, ground.publicKey),
  ]);
  return { groundKey, aircraftKey };
}

describe('session key exchange', () => {
  it('derives the same HKDF-SHA256 key on both ends', async () => {
    const { groundKey, aircraftKey } = await sessionPair();
    expect(bytesToHex(aircraftKey.raw)).toBe(bytesToHex(groundKey.raw));
    expect(aircraftKey.raw).toHaveLength(32);
    groundKey.raw.fill(0);
    aircraftKey.raw.fill(0);
  });

  it('round-trips AES-256-GCM plaintext and rejects a tampered tag', async () => {
    const { aircraftKey } = await sessionPair();
    const { nonce, ciphertext } = await aesGcmEncrypt(aircraftKey.key, PLAINTEXT);
    const out = await aesGcmDecrypt(aircraftKey.key, nonce, ciphertext);
    expect(new TextDecoder().decode(out)).toBe(new TextDecoder().decode(PLAINTEXT));
    expect(ciphertext.length).toBe(PLAINTEXT.length + 16);
    ciphertext[0] ^= 0xff;
    await expect(aesGcmDecrypt(aircraftKey.key, nonce, ciphertext)).rejects.toThrow();
  });

  it('computes the stored SHA-256 over the plaintext', async () => {
    const { aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    const record = await element.store(1, PLAINTEXT);
    expect(record.hash).toBe(await sha256Hex(PLAINTEXT));
    expect(record.data).not.toEqual(PLAINTEXT);
  });

  it('moves bytes through hex without loss', () => {
    const bytes = randomBytes(17);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});

describe('secure element', () => {
  it('lets the ground station decrypt and verify every received item', async () => {
    const { groundKey, aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    const ground = new GroundStation(groundKey.key);
    const first = await element.store(1, PLAINTEXT);
    const second = await element.store(2, new TextEncoder().encode('SECOND ITEM'));

    for (const record of [first, second]) {
      const result = await ground.receive(snapshotRecord(record));
      expect(result.verified).toBe(true);
      expect(result.plaintext).not.toBeNull();
    }
  });

  it('refuses a record delivered under a different session key', async () => {
    const { aircraftKey } = await sessionPair();
    const other = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    const record = await element.store(1, PLAINTEXT);
    const result = await new GroundStation(other.groundKey.key).receive(snapshotRecord(record));
    expect(result.verified).toBe(false);
    expect(result.plaintext).toBeNull();
  });

  it('zeroizes the key and ciphertext, then refuses new stores', async () => {
    const { aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    const record = await element.store(7, PLAINTEXT);
    const before = snapshotRecord(record);

    expect(element.locked).toBe(false);
    expect(element.zeroize(1234)).toBe(1);
    expect(element.locked).toBe(true);
    expect(element.lockedAtMs).toBe(1234);
    expect(element.zeroize(5678)).toBe(0);

    const stored = element.getRecord(7);
    expect(stored).toBeDefined();
    expect(stored?.data).not.toEqual(before.data);
    expect(stored?.nonce).not.toEqual(before.nonce);
    await expect(aesGcmDecrypt(aircraftKey.key, stored!.nonce, stored!.data)).rejects.toThrow();
    await expect(element.store(8, PLAINTEXT)).rejects.toThrow('SECURE ELEMENT LOCKED');
  });

  it('leaves a delivered ground copy readable after the erase', async () => {
    const { groundKey, aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    const ground = new GroundStation(groundKey.key);
    const record = await element.store(3, PLAINTEXT);
    const delivered = snapshotRecord(record);

    element.zeroize(999);
    const result = await ground.receive(delivered);
    expect(result.verified).toBe(true);
    expect(new TextDecoder().decode(result.plaintext!)).toBe(new TextDecoder().decode(PLAINTEXT));
  });

  it('reports a failed adversary recovery after zeroize', async () => {
    const { aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    await element.store(1, PLAINTEXT);
    await element.store(2, new TextEncoder().encode('ANOTHER ITEM'));

    await expect(element.adversaryRecoveryAttempt(1)).rejects.toThrow(
      'ADVERSARY ATTEMPT REQUIRES A LOCKED ELEMENT',
    );

    element.zeroize(4242);
    const outcome = await element.adversaryRecoveryAttempt(4242);
    expect(outcome.status).toBe('FAILED');
    expect(outcome.attempted).toBe(2);
    expect(outcome.failed).toBe(2);
    expect(outcome.detail).toContain('Key destroyed');
  });

  it('reports no stored blocks when the element was empty', async () => {
    const { aircraftKey } = await sessionPair();
    const element = new SecureElement(aircraftKey.key, aircraftKey.raw);
    element.zeroize(1);
    const outcome = await element.adversaryRecoveryAttempt(1);
    expect(outcome.attempted).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(outcome.detail).toContain('No ciphertext remained');
  });
});
