import {
  RENDER_VERTEX_FLOATS,
  type RenderGeometry,
  type RenderRange,
  type RenderDrawSegment,
} from '../contracts/RenderSnapshot';

export type RenderColor = readonly [number, number, number, number];
export type RenderPoint = readonly [number, number];

export interface VertexStyle {
  color: RenderColor;
  sample: RenderPoint;
  normal?: RenderPoint;
  lit?: boolean;
  pickId?: number;
}

const EMPTY_RANGE: RenderRange = {first: 0, count: 0};

export class GeometryBuilder {
  private _data = new Float32Array(RENDER_VERTEX_FLOATS * 1024);
  private _vertexCount = 0;

  reset(): void {
    this._vertexCount = 0;
  }

  get vertexCount(): number {
    return this._vertexCount;
  }

  mark(): number {
    return this._vertexCount;
  }

  range(first: number): RenderRange {
    return {first, count: this._vertexCount - first};
  }

  geometry(
    floor: RenderRange = EMPTY_RANGE,
    shadows: RenderRange = EMPTY_RANGE,
    opaque: RenderRange = EMPTY_RANGE,
    transparent: RenderRange = EMPTY_RANGE,
    debug: RenderRange = EMPTY_RANGE,
    segments: RenderDrawSegment[] = []
  ): RenderGeometry {
    return {
      data: this._data,
      vertexCount: this._vertexCount,
      floor,
      shadows,
      opaque,
      transparent,
      debug,
      segments,
    };
  }

  triangle(a: RenderPoint, b: RenderPoint, c: RenderPoint, style: VertexStyle): void {
    this._push(a, style);
    this._push(b, style);
    this._push(c, style);
  }

  quad(a: RenderPoint, b: RenderPoint, c: RenderPoint, d: RenderPoint, style: VertexStyle): void {
    this.triangle(a, b, c, style);
    this.triangle(a, c, d, style);
  }

  texturedQuad(
    a: RenderPoint,
    b: RenderPoint,
    c: RenderPoint,
    d: RenderPoint,
    uv: readonly [number, number, number, number],
    style: VertexStyle
  ): void {
    const [u0, v0, u1, v1] = uv;
    this._texturedTriangle(a, b, c, [u0, v0], [u1, v0], [u1, v1], style);
    this._texturedTriangle(a, c, d, [u0, v0], [u1, v1], [u0, v1], style);
  }

  line(a: RenderPoint, b: RenderPoint, width: number, style: VertexStyle): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const ox = (-dy / length) * width * 0.5;
    const oy = (dx / length) * width * 0.5;
    this.quad(
      [a[0] + ox, a[1] + oy],
      [b[0] + ox, b[1] + oy],
      [b[0] - ox, b[1] - oy],
      [a[0] - ox, a[1] - oy],
      style
    );
  }

  polygon(points: readonly RenderPoint[], style: VertexStyle): void {
    if (points.length < 3) {return;}
    for (let i = 1; i < points.length - 1; i++) {
      this.triangle(points[0], points[i], points[i + 1], style);
    }
  }

  ellipse(
    center: RenderPoint,
    radiusX: number,
    radiusY: number,
    style: VertexStyle,
    segments = 20
  ): void {
    const count = Math.max(8, segments);
    for (let i = 0; i < count; i++) {
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      this.triangle(
        center,
        [center[0] + Math.cos(a0) * radiusX, center[1] + Math.sin(a0) * radiusY],
        [center[0] + Math.cos(a1) * radiusX, center[1] + Math.sin(a1) * radiusY],
        style
      );
    }
  }

  private _push(point: RenderPoint, style: VertexStyle): void {
    this._pushVertex(point, style, [0, 0], false);
  }

  private _texturedTriangle(
    a: RenderPoint,
    b: RenderPoint,
    c: RenderPoint,
    uvA: RenderPoint,
    uvB: RenderPoint,
    uvC: RenderPoint,
    style: VertexStyle
  ): void {
    this._pushVertex(a, style, uvA, true);
    this._pushVertex(b, style, uvB, true);
    this._pushVertex(c, style, uvC, true);
  }

  private _pushVertex(
    point: RenderPoint,
    style: VertexStyle,
    uv: RenderPoint,
    textured: boolean
  ): void {
    this._ensure(1);
    const offset = this._vertexCount * RENDER_VERTEX_FLOATS;
    const normal = style.normal ?? [0, -1];
    const pick = encodePickId(style.pickId ?? 0);

    this._data[offset] = point[0];
    this._data[offset + 1] = point[1];
    this._data[offset + 2] = style.sample[0];
    this._data[offset + 3] = style.sample[1];
    this._data[offset + 4] = style.color[0];
    this._data[offset + 5] = style.color[1];
    this._data[offset + 6] = style.color[2];
    this._data[offset + 7] = style.color[3];
    this._data[offset + 8] = normal[0];
    this._data[offset + 9] = normal[1];
    this._data[offset + 10] = style.lit === false ? 0 : 1;
    this._data[offset + 11] = pick[0];
    this._data[offset + 12] = pick[1];
    this._data[offset + 13] = pick[2];
    this._data[offset + 14] = uv[0];
    this._data[offset + 15] = uv[1];
    this._data[offset + 16] = textured ? 1 : 0;
    this._vertexCount++;
  }

  private _ensure(additionalVertices: number): void {
    const required = (this._vertexCount + additionalVertices) * RENDER_VERTEX_FLOATS;
    if (required <= this._data.length) {return;}

    let capacity = this._data.length;
    while (capacity < required) {capacity *= 2;}
    const next = new Float32Array(capacity);
    next.set(this._data);
    this._data = next;
  }
}

export function encodePickId(id: number): readonly [number, number, number] {
  const value = Math.max(0, Math.min(0xffffff, Math.floor(id)));
  return [
    (value & 0xff) / 255,
    ((value >>> 8) & 0xff) / 255,
    ((value >>> 16) & 0xff) / 255,
  ];
}

export function decodePickId(r: number, g: number, b: number): number {
  return r | (g << 8) | (b << 16);
}
