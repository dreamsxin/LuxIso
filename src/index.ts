// Core
export { Engine } from './core/Engine';
export { AssetLoader } from './core/AssetLoader';
export type { EngineOptions } from './core/Engine';
export { Scene } from './core/Scene';
export { SceneRenderer } from './core/SceneRenderer';
export { SceneSerializer } from './core/SceneSerializer';
export type { PropSerializer } from './core/SceneSerializer';
export type { LightSerializer } from './core/SceneSerializer';
export { Minimap } from './core/Minimap';
export type { MinimapStyle } from './core/Minimap';
export type { SceneOptions } from './core/Scene';
export { Camera } from './core/Camera';
export type { CameraBounds, CameraOptions } from './core/Camera';
export { LightmapCache } from './core/LightmapCache';
export { InputManager } from './core/InputManager';
export type { PointerState, TouchPoint, InputManagerOptions } from './core/InputManager';
export { SceneManager } from './core/SceneManager';
export type { ManagedScene } from './core/SceneManager';
export { ClickMover } from './core/ClickMover';
export type { ClickMoverOptions } from './core/ClickMover';
export { DebugRenderer } from './core/DebugRenderer';
export type { DebugRendererOptions } from './core/DebugRenderer';
export { HudLayer } from './core/HudLayer';
export type { HudLabel, HudBar, HudButton, HudPanel, HudElement, HudInputSource, LabelOptions, BarOptions, ButtonOptions, PanelOptions } from './core/HudLayer';
export { InputMap } from './core/InputMap';
export type { AxisSource } from './core/InputMap';
export { TouchStick } from './core/TouchStick';
export type { TouchStickOptions } from './core/TouchStick';
export { ObjectPool } from './core/ObjectPool';
export { SceneTransition } from './core/SceneTransition';
export type { TransitionEffect, TransitionOptions } from './core/SceneTransition';

// Elements
export { IsoObject } from './elements/IsoObject';
export { Crystal } from './elements/props/Crystal';
export { Boulder } from './elements/props/Boulder';
export { Chest } from './elements/props/Chest';
export { Tree } from './elements/props/Tree';
export type { TreeOptions } from './elements/props/Tree';
export { FlowerPatch } from './elements/props/FlowerPatch';
export type { FlowerPatchOptions, FlowerOffset } from './elements/props/FlowerPatch';
export { Lantern } from './elements/props/Lantern';
export type { LanternOptions } from './elements/props/Lantern';
export { Cloud } from './elements/props/Cloud';
export type { CloudOptions } from './elements/props/Cloud';
export type { DrawContext } from './elements/IsoObject';
export { Floor } from './elements/Floor';
export type { FloorOptions } from './elements/Floor';
export { Wall } from './elements/Wall';
export type { WallOptions, WallOpening } from './elements/Wall';
export { Character } from './elements/Character';
export type { CharacterOptions } from './elements/Character';

// Lighting
export { BaseLight } from './lighting/BaseLight';
export { OmniLight } from './lighting/OmniLight';
export type { OmniLightOptions } from './lighting/OmniLight';
export { DirectionalLight } from './lighting/DirectionalLight';
export type { DirectionalLightOptions } from './lighting/DirectionalLight';
export { ShadowCaster } from './lighting/ShadowCaster';

// Animation
export { SpriteSheet } from './animation/SpriteSheet';
export type { SpriteSheetOptions, AnimationClip, FrameRect } from './animation/SpriteSheet';
export { AnimationController } from './animation/AnimationController';
export type { Direction } from './animation/AnimationController';
export { DirectionalAnimator } from './animation/DirectionalAnimator';
export type { ActionName, DirectionalAnimatorOptions } from './animation/DirectionalAnimator';
export { ParticleSystem } from './animation/ParticleSystem';
export type { EmitterConfig, EmitterShape, ParticleBlend } from './animation/ParticleSystem';

// Physics
export { TileCollider } from './physics/TileCollider';
export { Pathfinder, PathCache } from './physics/Pathfinder';
export type { IsoVec2 } from './physics/Pathfinder';

// Audio
export { AudioManager } from './audio/AudioManager';
export type { PlayOptions, SpatialOptions } from './audio/AudioManager';
// ECS
export { Entity } from './ecs/Entity';
export type { Component, ComponentCtor } from './ecs/Component';
export { System } from './ecs/System';
export { EventBus, globalBus } from './ecs/EventBus';
export type {
  EventEmitter, LuxIsoEventMap,
  DamageEvent, HealEvent, DeathEvent, MoveEvent, ArrivalEvent, TriggerEvent,
} from './ecs/EventBus';
export { HealthComponent } from './ecs/components/HealthComponent';
export type { HealthOptions } from './ecs/components/HealthComponent';
export { MovementComponent } from './ecs/components/MovementComponent';
export type { MovementOptions } from './ecs/components/MovementComponent';
export { TimerComponent } from './ecs/components/TimerComponent';
export type { TimerOptions } from './ecs/components/TimerComponent';
export { TweenComponent, Easing } from './ecs/components/TweenComponent';
export type { TweenOptions, TweenTarget, EasingFn } from './ecs/components/TweenComponent';
export { TweenSequence } from './ecs/components/TweenSequence';
export type { TweenSequenceOptions } from './ecs/components/TweenSequence';
export { TriggerZoneComponent } from './ecs/components/TriggerZoneComponent';
export type { TriggerZoneOptions } from './ecs/components/TriggerZoneComponent';

// Validation
export { validateSceneJson, validateComponents, requireComponent } from './core/Validator';
export type { ValidationResult, SceneValidationOptions } from './core/Validator';

// Math
export { project, unproject, depthKey, drawIsoCube } from './math/IsoProjection';
export type { IsoVec3, ScreenVec2, IsoView } from './math/IsoProjection';
export { DEFAULT_ISO_VIEW } from './math/IsoProjection';
export { topoSort, MIN_Z_EXTENT_PX } from './math/depthSort';
export type { AABB, Sortable } from './math/depthSort';
export { hexToRgb, hexToRgba, shiftColor, blendColor, blendColorRaw, lerpColor } from './math/color';
