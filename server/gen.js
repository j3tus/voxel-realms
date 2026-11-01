// Terrain generator for the server: the Rust/WASM build (6x faster, bit-identical) when it loads, otherwise the JS reference. VR_WASM=0 forces JS.
import fs from 'node:fs';
import { createWorldGen } from '../shared/worldgen.js';
import { wasmWorldGenFactory } from '../shared/wasmgen.js';

let factory = null;
if (process.env.VR_WASM !== '0') { try { factory = wasmWorldGenFactory(fs.readFileSync(new URL('../shared/wasm/worldgen.wasm', import.meta.url))); } catch { factory = null; } }
export const wasmActive = !!factory;
export const makeWorldGen = (seed, gen) => factory ? factory(seed, gen) : createWorldGen(seed, gen);
