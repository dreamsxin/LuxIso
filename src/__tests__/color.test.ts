import {describe, it, expect} from 'vitest';
import {hexToRgb, hexToRgba, shiftColor, blendColor, lerpColor} from '../math/color';

describe('hexToRgb', () => {
  it('parses white', () => expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]));
  it('parses black', () => expect(hexToRgb('#000000')).toEqual([0, 0, 0]));
  it('parses arbitrary color', () => expect(hexToRgb('#a05c18')).toEqual([160, 92, 24]));
  it('works without leading #', () => expect(hexToRgb('ff0000')).toEqual([255, 0, 0]));
  it('expands three-digit CSS hex colors', () => expect(hexToRgb('#3af')).toEqual([51, 170, 255]));
});

describe('hexToRgba', () => {
  it('produces correct rgba string', () => {
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });
});

describe('shiftColor', () => {
  it('lightens a color', () => {
    const [r] = hexToRgb(shiftColor('#800000', 50));
    expect(r).toBe(178);
  });

  it('clamps at 255', () => {
    const [r] = hexToRgb(shiftColor('#ffffff', 100));
    expect(r).toBe(255);
  });

  it('clamps at 0', () => {
    const [r] = hexToRgb(shiftColor('#000000', -100));
    expect(r).toBe(0);
  });
});

describe('blendColor', () => {
  it('factor 1 returns original color', () => {
    expect(blendColor('#ff8040', 1)).toBe('rgb(255,128,64)');
  });

  it('factor 0 returns black', () => {
    expect(blendColor('#ff8040', 0)).toBe('rgb(0,0,0)');
  });

  it('factor 0.5 halves each channel', () => {
    expect(blendColor('#ff8040', 0.5)).toBe('rgb(128,64,32)');
  });
});

describe('lerpColor', () => {
  it('t=0 returns from color', () => {
    expect(lerpColor('#ff0000', '#0000ff', 0)).toBe('rgb(255,0,0)');
  });

  it('t=1 returns to color', () => {
    expect(lerpColor('#ff0000', '#0000ff', 1)).toBe('rgb(0,0,255)');
  });

  it('t=0.5 averages channels', () => {
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });
});
