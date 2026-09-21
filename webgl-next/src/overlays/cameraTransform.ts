import type {RenderSnapshot} from '../contracts/RenderSnapshot';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** CPU equivalent of the shared WebGL vertex transform for DOM overlays. */
export function renderPointToScreen(x: number, y: number, snapshot: RenderSnapshot): ScreenPoint {
  const {camera, tileW, tileH} = snapshot;
  const cameraIsoX = (camera.worldX - camera.worldY) * (tileW / 2);
  const cameraIsoY = (camera.worldX + camera.worldY) * (tileH / 2);
  let px = x - cameraIsoX;
  let py = (y - cameraIsoY) * (camera.elevation / 0.5);
  const radians = camera.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const aspect = tileW / tileH;
  const rotatedX = cos * px + sin * aspect * py;
  const rotatedY = -sin * px / aspect + cos * py;
  px = rotatedX * camera.zoom;
  py = rotatedY * camera.zoom;
  return {x: camera.originX + px, y: camera.originY + py};
}
