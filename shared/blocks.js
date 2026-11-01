// Block registry shared by the client, the chunk worker and the game server.
export const CS = 16, CH = 80, SEA = 20;

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7, PLANKS: 8, GLASS: 9, BRICK: 10, SNOW: 11,
  COBBLE: 12, COAL: 13, GOLD: 14, CLAY: 15, GRAVEL: 16, IRON: 17, DIAMOND: 18, WOOL_W: 19, WOOL_R: 20, WOOL_B: 21,
  STONE_BRICK: 22, DARK_PLANKS: 23, SANDSTONE: 24, OBSIDIAN: 25, ICE: 26, BOOKSHELF: 27, GLOWSTONE: 28, GOLD_BLOCK: 29, DIAMOND_BLOCK: 30,
};
export const { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, PLANKS, GLASS, BRICK, SNOW, COBBLE, COAL, GOLD, CLAY, GRAVEL, IRON, DIAMOND } = B;

export const NAMES = ['Air', 'Grass', 'Dirt', 'Stone', 'Sand', 'Oak Log', 'Leaves', 'Water', 'Planks', 'Glass', 'Bricks', 'Snow', 'Cobblestone', 'Coal Ore', 'Gold Ore', 'Clay', 'Gravel', 'Iron Ore', 'Diamond Ore', 'White Wool', 'Red Wool', 'Blue Wool', 'Stone Bricks', 'Dark Planks', 'Sandstone', 'Obsidian', 'Ice', 'Bookshelf', 'Glowstone', 'Gold Block', 'Diamond Block'];
export const BLOCK_COUNT = NAMES.length;

// 1 = fully opaque cube (hides neighbouring faces, blocks light)
export const OPAQUE = new Uint8Array(64);
for (let i = 1; i < BLOCK_COUNT; i++) OPAQUE[i] = 1;
OPAQUE[LEAVES] = 0; OPAQUE[WATER] = 0; OPAQUE[GLASS] = 0;

// tiles per block: [side, top, bottom] indices into the 8x8 atlas
export const TILES = [null, [1, 0, 2], [2, 2, 2], [3, 3, 3], [4, 4, 4], [5, 6, 6], [7, 7, 7], [8, 8, 8], [9, 9, 9], [10, 10, 10], [11, 11, 11], [12, 12, 12], [13, 13, 13], [14, 14, 14], [15, 15, 15]];
for (let i = 16; i <= 31; i++) TILES.push([i, i, i]); // block id n (n>=15) uses tile n+1
TILES[27] = [28, 9, 9];

// block light emitted (0..14)
export const EMISSIVE = new Uint8Array(64);
EMISSIVE[GLOWSTONE_ID()] = 14;
function GLOWSTONE_ID() { return 28; }

export const HARD = { 1: .5, 2: .5, 3: 1.6, 4: .4, 5: 1, 6: .2, 8: .9, 9: .3, 10: 1.6, 11: .3, 12: 1.8, 13: 2, 14: 2.4, 15: .5, 16: .5, 17: 2.2, 18: 2.6, 19: .4, 20: .4, 21: .4, 22: 1.8, 23: .9, 24: .8, 25: 5, 26: .5, 27: .9, 28: .4, 29: 2.2, 30: 2.4 };
export const dropOf = id => id === GRASS ? DIRT : id === STONE ? COBBLE : id;
for (let i = 33; i <= 39; i++) TILES[i] = [8, 8, 8]; // flowing water levels 1..7 (see fluid.js)
export const isSolid = id => id !== 0 && id !== WATER && !(id >= 33 && id <= 39);

export const CATS = {
  all: null,
  natural: [1, 2, 3, 4, 5, 6, 7, 11, 15, 16, 26],
  building: [8, 9, 10, 12, 22, 23, 24, 25, 27],
  'ores & decor': [13, 14, 17, 18, 19, 20, 21, 28, 29, 30],
};
export const RECIPES = [
  { out: PLANKS, n: 4, inp: { [LOG]: 1 } }, { out: 23, n: 4, inp: { [LOG]: 1 } }, { out: GLASS, n: 1, inp: { [SAND]: 1 } }, { out: STONE, n: 1, inp: { [COBBLE]: 1 } },
  { out: 22, n: 2, inp: { [STONE]: 2 } }, { out: BRICK, n: 2, inp: { [CLAY]: 2 } }, { out: 24, n: 1, inp: { [SAND]: 4 } }, { out: 27, n: 1, inp: { [PLANKS]: 6 } },
  { out: 19, n: 2, inp: { [LEAVES]: 4 } }, { out: 20, n: 1, inp: { 19: 1 } }, { out: 21, n: 1, inp: { 19: 1 } }, { out: 28, n: 1, inp: { 14: 1, [SAND]: 3 } }, { out: 29, n: 1, inp: { 14: 4 } }, { out: 30, n: 1, inp: { 18: 4 } },
];
export const DEFAULT_HOTBAR = [GRASS, DIRT, STONE, PLANKS, LOG, GLASS, BRICK, SAND, LEAVES];
