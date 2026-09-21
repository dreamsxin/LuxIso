import {IsoObject} from '../elements/IsoObject';

/**
 * Base interface for all ECS components.
 *
 * A component encapsulates a single behaviour or data facet.
 * It receives a reference to its owner entity on attachment.
 */
export interface Component {
  /**
   * Optional diagnostic label kept for compatibility with existing components.
   * Component lookup uses the constructor reference, never this string.
   */
  readonly componentType?: string;

  /** Called by Entity when this component is attached. */
  onAttach?(owner: IsoObject): void;

  /** Called by Entity when this component is detached. */
  onDetach?(): void;

  /** Called every frame by Scene.update(). */
  update?(ts?: number): void;

  /** Called at a fixed rate (default 1/60 s) for physics and pathfinding. */
  fixedUpdate?(dt: number): void;
}

/** Constructor reference used for type-safe component lookup and System queries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentCtor<T extends Component = Component> = abstract new (...args: any[]) => T;
