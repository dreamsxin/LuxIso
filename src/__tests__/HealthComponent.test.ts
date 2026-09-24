import {describe, it, expect, vi} from 'vitest';
import {HealthComponent} from '../ecs/components/HealthComponent';

describe('HealthComponent — initial state', () => {
  it('starts at max hp', () => {
    const hp = new HealthComponent({max: 100});
    expect(hp.hp).toBe(100);
    expect(hp.maxHp).toBe(100);
    expect(hp.fraction).toBe(1);
    expect(hp.isDead).toBe(false);
  });

  it('respects custom current', () => {
    const hp = new HealthComponent({max: 100, current: 40});
    expect(hp.hp).toBe(40);
    expect(hp.fraction).toBeCloseTo(0.4);
  });
});

describe('HealthComponent — takeDamage', () => {
  it('reduces hp', () => {
    const hp = new HealthComponent({max: 100});
    hp.takeDamage(30);
    expect(hp.hp).toBe(70);
  });

  it('clamps at 0', () => {
    const hp = new HealthComponent({max: 50});
    hp.takeDamage(200);
    expect(hp.hp).toBe(0);
    expect(hp.isDead).toBe(true);
  });

  it('no-ops when already dead', () => {
    const hp = new HealthComponent({max: 50});
    hp.takeDamage(50);
    hp.takeDamage(50); // should be ignored
    expect(hp.hp).toBe(0);
  });

  it('calls onDeath when hp reaches 0', () => {
    const onDeath = vi.fn();
    const hp = new HealthComponent({max: 10, onDeath});
    hp.onAttach({id: 'stub'} as never);
    hp.takeDamage(10);
    expect(onDeath).toHaveBeenCalledOnce();
  });

  it('does not call onDeath for partial damage', () => {
    const onDeath = vi.fn();
    const hp = new HealthComponent({max: 10, onDeath});
    hp.onAttach({id: 'stub'} as never);
    hp.takeDamage(5);
    expect(onDeath).not.toHaveBeenCalled();
  });

  it('calls onChange on every damage', () => {
    const onChange = vi.fn();
    const hp = new HealthComponent({max: 100, onChange});
    hp.onAttach({id: 'stub'} as never);
    hp.takeDamage(20);
    hp.takeDamage(10);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(70, 100, expect.anything());
  });
});

describe('HealthComponent — heal', () => {
  it('restores hp', () => {
    const hp = new HealthComponent({max: 100, current: 50});
    hp.heal(20);
    expect(hp.hp).toBe(70);
  });

  it('clamps at maxHp', () => {
    const hp = new HealthComponent({max: 100, current: 90});
    hp.heal(50);
    expect(hp.hp).toBe(100);
  });

  it('no-ops when dead', () => {
    const hp = new HealthComponent({max: 100});
    hp.takeDamage(100);
    hp.heal(50);
    expect(hp.hp).toBe(0);
  });
});

describe('HealthComponent — setMax', () => {
  it('updates maxHp and clamps current', () => {
    const hp = new HealthComponent({max: 100, current: 80});
    hp.setMax(60);
    expect(hp.maxHp).toBe(60);
    expect(hp.hp).toBe(60);
  });

  it('scales current hp when scaleCurrentHp=true', () => {
    const hp = new HealthComponent({max: 100, current: 50});
    hp.setMax(200, true);
    expect(hp.hp).toBe(100); // 50% of 200
  });
});
