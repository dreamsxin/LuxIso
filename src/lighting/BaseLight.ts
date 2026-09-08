let _nextLightUid = 0;

export abstract class BaseLight {
  abstract readonly type: string;
  color: string;
  intensity: number;
  /** Optional id — allows scene.removeById() to remove this light. */
  id?: string;
  /**
   * Stable per-instance identity, assigned at construction.
   *
   * `id` is optional and is left undefined whenever scene JSON omits it, so
   * caches must not key off it alone. Falling back to the light's *position*
   * meant a moving light produced a fresh key every frame and per-object
   * caches (e.g. ShadowCaster's) grew without bound.
   */
  readonly uid: string;
  /**
   * When false, the light is skipped during rendering.
   * Useful for toggling lights without removing them from the scene.
   * Default true.
   */
  enabled: boolean = true;

  constructor(color = '#ffffff', intensity = 1) {
    this.color = color;
    this.intensity = intensity;
    this.uid = `light-${++_nextLightUid}`;
  }

  /** `id` when set, otherwise the auto-assigned `uid`. Always stable. */
  get cacheKey(): string {
    return this.id ?? this.uid;
  }
}
