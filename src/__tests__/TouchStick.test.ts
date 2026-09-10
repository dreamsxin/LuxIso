import { describe, it, expect } from 'vitest';
import { TouchStick, type TouchStickOptions } from '../core/TouchStick';
import type { InputManager, TouchPoint } from '../core/InputManager';

/**
 * TouchStick tests.
 *
 * Only the two members the stick reads are faked — `touches` and `getTouch` —
 * so the contract with InputManager stays visible.
 */
function fakeInput(points: TouchPoint[]): InputManager {
  return {
    touches: points,
    getTouch: (id: number) => points.find(p => p.id === id) ?? null,
  } as unknown as InputManager;
}

const CENTRE = { x: 100, y: 200 };

function stick(opts: Partial<TouchStickOptions> = {}): TouchStick {
  return new TouchStick({ x: CENTRE.x, y: CENTRE.y, radius: 50, ...opts });
}


describe('TouchStick — claiming a contact', () => {
  it('is inactive and centred at rest', () => {
    const s = stick();
    s.update(fakeInput([]));
    expect(s.active).toBe(false);
    expect(s.touchId).toBeNull();
    expect(s.value).toEqual({ x: 0, y: 0 });
    expect(s.knobX).toBe(CENTRE.x);
  });

  it('claims a contact that lands inside the capture radius', () => {
    const s = stick();
    s.update(fakeInput([{ id: 4, x: 120, y: 200 }]));
    expect(s.active).toBe(true);
    expect(s.touchId).toBe(4);
  });

  it('ignores a contact that lands too far away', () => {
    const s = stick();
    // captureRadius defaults to radius * 1.6 = 80.
    s.update(fakeInput([{ id: 4, x: CENTRE.x + 200, y: CENTRE.y }]));
    expect(s.active).toBe(false);
  });

  it('keeps its own contact and ignores later ones', () => {
    const s = stick();
    s.update(fakeInput([{ id: 1, x: 110, y: 200 }]));
    s.update(fakeInput([
      { id: 1, x: 130, y: 200 },
      { id: 2, x: 105, y: 200 },
    ]));
    expect(s.touchId).toBe(1);
    expect(s.value.x).toBeGreaterThan(0);
  });

  it('resets when the claimed finger lifts', () => {
    const s = stick();
    s.update(fakeInput([{ id: 1, x: 140, y: 200 }]));
    expect(s.value.x).toBeGreaterThan(0);

    s.update(fakeInput([]));
    expect(s.active).toBe(false);
    expect(s.value).toEqual({ x: 0, y: 0 });
    expect(s.knobX).toBe(CENTRE.x);
  });

  it('skips contacts another widget already owns', () => {
    const s = stick();
    s.update(fakeInput([{ id: 7, x: 105, y: 205 }]), id => id === 7);
    expect(s.active).toBe(false);
  });

  it('re-centres on the landing point in dynamicOrigin mode', () => {
    const s = stick({ dynamicOrigin: true });
    s.update(fakeInput([{ id: 1, x: 130, y: 230 }]));
    expect(s.originX).toBe(130);
    expect(s.originY).toBe(230);
    // Landing point is the origin, so there is no deflection yet.
    expect(s.value).toEqual({ x: 0, y: 0 });
  });
});

describe('TouchStick — analog value', () => {
  it('reports full deflection at the rim', () => {
    const s = stick();
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 50, y: CENTRE.y }]));
    expect(s.value.x).toBeCloseTo(1, 6);
    expect(s.value.y).toBeCloseTo(0, 6);
  });

  it('clamps past the rim without exceeding 1', () => {
    const s = stick();
    // Claim inside the capture radius first, then drag well past the rim —
    // a contact starting 500px away would never have been claimed at all.
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 10, y: CENTRE.y }]));
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 500, y: CENTRE.y }]));
    expect(Math.hypot(s.value.x, s.value.y)).toBeCloseTo(1, 6);
    // The knob stops on the ring.
    expect(s.knobX).toBeCloseTo(CENTRE.x + 50, 6);
  });


  it('reports zero inside the deadzone', () => {
    const s = stick({ deadzone: 0.2 });
    // 5px of 50 = 0.1 magnitude, under the 0.2 deadzone.
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 5, y: CENTRE.y }]));
    expect(s.value).toEqual({ x: 0, y: 0 });
    // ...but the knob still tracks the thumb, so the widget looks alive.
    expect(s.knobX).toBeCloseTo(CENTRE.x + 5, 6);
  });

  it('rescales past the deadzone so motion starts from zero', () => {
    const s = stick({ deadzone: 0.2 });
    // Half deflection: (0.5 - 0.2) / (1 - 0.2) = 0.375, not 0.5.
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 25, y: CENTRE.y }]));
    expect(s.value.x).toBeCloseTo(0.375, 6);
  });

  it('preserves direction on a diagonal', () => {
    const s = stick({ deadzone: 0 });
    s.update(fakeInput([{ id: 1, x: CENTRE.x + 30, y: CENTRE.y - 40 }]));
    expect(Math.hypot(s.value.x, s.value.y)).toBeCloseTo(1, 6);
    expect(s.value.x).toBeCloseTo(0.6, 6);
    expect(s.value.y).toBeCloseTo(-0.8, 6);
  });

  it('treats a contact exactly on the origin as zero', () => {
    const s = stick({ deadzone: 0 });
    s.update(fakeInput([{ id: 1, x: CENTRE.x, y: CENTRE.y }]));
    expect(s.value).toEqual({ x: 0, y: 0 });
  });
});

describe('TouchStick — placement and drawing', () => {
  it('setCentre moves the resting position while inactive', () => {
    const s = stick();
    s.setCentre(10, 20);
    expect(s.originX).toBe(10);
    expect(s.knobY).toBe(20);
    s.update(fakeInput([{ id: 1, x: 30, y: 20 }]));
    expect(s.active).toBe(true);
  });

  it('draws a balanced save/restore pair', () => {
    const calls: string[] = [];
    const ctx = {
      save() { calls.push('save'); },
      restore() { calls.push('restore'); },
      beginPath() { calls.push('beginPath'); },
      arc() { calls.push('arc'); },
      fill() { calls.push('fill'); },
      set globalAlpha(_v: number) {},
      set fillStyle(_v: string) {},
    } as unknown as CanvasRenderingContext2D;

    const s = stick();
    s.draw(ctx);
    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
    expect(calls.filter(c => c === 'arc').length).toBe(2);
  });

  it('reset() is safe to call when never used', () => {
    const s = stick();
    expect(() => s.reset()).not.toThrow();
    expect(s.active).toBe(false);
  });
});

