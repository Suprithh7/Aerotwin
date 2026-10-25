import { describe, expect, it } from 'vitest';
import { thermalColor } from '../uiMeta';

const CHT = [110, 120, 135] as const;

describe('thermal ramp', () => {
  it('holds blue-grey through the nominal band', () => {
    expect(thermalColor(60, ...CHT)).toBe('rgb(91,141,184)');
    expect(thermalColor(110, ...CHT)).toBe('rgb(91,141,184)');
  });

  it('turns amber at caution and red only at the limit', () => {
    expect(thermalColor(120, ...CHT)).toBe('rgb(201,146,46)');
    expect(thermalColor(134.9, ...CHT)).not.toBe('rgb(196,68,63)');
    expect(thermalColor(135, ...CHT)).toBe('rgb(196,68,63)');
    expect(thermalColor(160, ...CHT)).toBe('rgb(196,68,63)');
  });

  it('blends between the anchors', () => {
    const at115 = thermalColor(115, ...CHT);
    const at125 = thermalColor(125, ...CHT);
    expect(at115).not.toBe(thermalColor(110, ...CHT));
    expect(at115).not.toBe(thermalColor(120, ...CHT));
    expect(at125).not.toBe(thermalColor(120, ...CHT));
    expect(at125).not.toBe(thermalColor(135, ...CHT));
  });
});
