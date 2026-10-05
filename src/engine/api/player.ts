// web-scumm/player (4.0): what a build's entry starts the game with, and what a host can plug in (a save store, a
// renderer's contract). Public (docs/en/SUPPORT.md).
export { bootGame, openStore, pickLanguage } from '../boot';
export type { BootOptions, Locales, StoreOpener, SwModule } from '../boot';
export type { AssetManifest } from '../dom/assets';
export type { SaveStore, SlotStore, Presenter } from '../core/ports';
export type {
  SceneRenderer,
  SpriteSpec,
  LayerSpec,
  OccluderSpec,
  LightSpec,
  EmitterSpec,
  StageSpec,
} from '../dom/renderer';
