// Fixture game for the tests: same shape as a games/<id>/index.ts.
import type { Layout } from '@engine/core/types';
import type { AssetManifest } from '@engine/dom/assets';
import { game } from './game';
import house from './layout/house.json';
import garden from './layout/garden.json';
import manifestJson from './assets.gen.json';

export { game };
export const layouts: Record<string, Layout> = {
  house: house as unknown as Layout,
  garden: garden as unknown as Layout,
};
export const manifest = manifestJson as unknown as AssetManifest;
export const minigames = {};
