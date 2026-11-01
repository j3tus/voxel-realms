// Port of shared/worldgen.js (terrainH + genChunk). It must stay bit-for-bit identical to the JS: the JS is the reference and the fallback,
// and test/wasm-worldgen.test.js compares both over thousands of chunks. Edit one, edit the other, run that test.
const CS: i32 = 16;
const CH: i32 = 80;
const SEA: i32 = 20;
const GRASS: u8 = 1; const DIRT: u8 = 2; const STONE: u8 = 3; const SAND: u8 = 4; const LOG: u8 = 5; const LEAVES: u8 = 6; const WATER: u8 = 7;
const SNOW: u8 = 11; const COAL: u8 = 13; const GOLD: u8 = 14; const CLAY: u8 = 15; const GRAVEL: u8 = 16; const IRON: u8 = 17; const DIAMOND: u8 = 18;
const SIZE: usize = (CS * CS * CH) as usize;
static mut OUT: [u8; SIZE] = [0; SIZE];

#[inline] fn hash3(a: i32, b: i32, c: i32, s: i32) -> f64 {
    let mut h: i32 = a.wrapping_mul(374761393) ^ b.wrapping_mul(668265263) ^ c.wrapping_mul(1274126177) ^ s.wrapping_mul(2246822519u32 as i32);
    h = (h ^ (((h as u32) >> 13) as i32)).wrapping_mul(1274126177);
    h ^= ((h as u32) >> 16) as i32;
    (h as u32) as f64 / 4294967296.0
}
#[inline] fn lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }
#[inline] fn fade(t: f64) -> f64 { t * t * t * (t * (t * 6.0 - 15.0) + 10.0) }

struct Gen { seed: i32, ty: u32 }
impl Gen {
    fn vn2(&self, x: f64, z: f64, o: i32) -> f64 {
        let (fxl, fzl) = (x.floor(), z.floor()); let (ix, iz) = (fxl as i32, fzl as i32); let (fx, fz) = (fade(x - fxl), fade(z - fzl)); let s = self.seed;
        lerp(lerp(hash3(ix, iz, o, s), hash3(ix + 1, iz, o, s), fx), lerp(hash3(ix, iz + 1, o, s), hash3(ix + 1, iz + 1, o, s), fx), fz)
    }
    fn vn3(&self, x: f64, y: f64, z: f64, o: i32) -> f64 {
        let (fxl, fyl, fzl) = (x.floor(), y.floor(), z.floor()); let (ix, iy, iz) = (fxl as i32, fyl as i32, fzl as i32);
        let (fx, fy, fz) = (fade(x - fxl), fade(y - fyl), fade(z - fzl)); let s = self.seed.wrapping_add(o);
        let h = |a: i32, b: i32, c: i32| hash3(ix + a, iy + b, iz + c, s);
        lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy), lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy), fz)
    }
    fn fbm2(&self, x: f64, z: f64, oct: i32, o: i32) -> f64 {
        let (mut s, mut a, mut t, mut f) = (0.0f64, 1.0f64, 0.0f64, 1.0f64);
        for i in 0..oct { s += a * self.vn2(x * f, z * f, o + i * 31); t += a; a *= 0.5; f *= 2.0; }
        s / t
    }
    fn terrain_h(&self, x: i32, z: i32) -> i32 {
        let (x, z) = (x as f64, z as f64);
        let base = self.fbm2(x * 0.0035, z * 0.0035, 4, 1);
        let mnt = ((self.fbm2(x * 0.008 + 100.0, z * 0.008 + 100.0, 4, 2) - 0.45).max(0.0) * 2.2).powf(1.6);
        let mut h = 16.0 + (base - 0.35) * 40.0 + mnt * 42.0 + self.fbm2(x * 0.04, z * 0.04, 3, 3) * 5.0;
        match self.ty { 1 => h = 24.0 + self.fbm2(x * 0.05, z * 0.05, 2, 3) * 1.5, 2 => h = SEA as f64 + (h - SEA as f64) * 1.7 + 4.0, 3 => h -= 10.0, _ => {} }
        let h = h.floor(); h.min((CH - 12) as f64).max(2.0) as i32
    }
}
#[inline] fn idx(x: i32, y: i32, z: i32) -> usize { (x + 16 * (z + 16 * y)) as usize }

/// type: 0 normal, 1 flat, 2 mountains, 3 islands (anything else behaves like normal, as in the JS)
#[no_mangle] pub extern "C" fn out_ptr() -> *const u8 { core::ptr::addr_of!(OUT) as *const u8 }
#[no_mangle] pub extern "C" fn terrain_h(seed: i32, ty: u32, x: i32, z: i32) -> i32 { Gen { seed, ty }.terrain_h(x, z) }
/// fills OUT with the chunk and returns maxY
#[no_mangle] pub extern "C" fn gen_chunk(seed: i32, ty: u32, cx: i32, cz: i32) -> i32 {
    let g = Gen { seed, ty }; let data: &mut [u8; SIZE] = unsafe { &mut *core::ptr::addr_of_mut!(OUT) }; data.fill(0);
    let mut max_y: i32 = 0;
    for lz in 0..CS { for lx in 0..CS {
        let (wx, wz) = (cx * CS + lx, cz * CS + lz); let h = g.terrain_h(wx, wz);
        let sandy = h <= SEA + 1;
        let top = if sandy { if h < SEA - 1 && hash3(wx >> 2, wz >> 2, 41, seed) > 0.72 { CLAY } else { SAND } } else if h > 56 { SNOW } else if h > 46 { STONE } else { GRASS };
        for y in 0..=h {
            let mut id: u8;
            if y == h { id = top; }
            else if y > h - 4 { id = if sandy { if top == CLAY { CLAY } else { SAND } } else if top == STONE || top == SNOW { STONE } else { DIRT }; }
            else {
                id = STONE; let r = hash3(wx, y, wz, seed.wrapping_add(5));
                if y < 44 && r < 0.012 { id = COAL; } else if y < 40 && r > 0.975 && r < 0.99 { id = IRON; } else if y < 22 && r > 0.9965 { id = GOLD; } else if y < 14 && r > 0.9985 { id = DIAMOND; } else if y < 46 && r > 0.94 && r < 0.95 { id = GRAVEL; }
            }
            if y > 2 && y < h - 3 && (g.vn3(wx as f64 * 0.045, y as f64 * 0.07, wz as f64 * 0.045, 11) - 0.5).abs() < 0.04 && (g.vn3(wx as f64 * 0.045, y as f64 * 0.07, wz as f64 * 0.045, 23) - 0.5).abs() < 0.05 { id = 0; }
            data[idx(lx, y, lz)] = id;
        }
        for y in (h + 1)..=SEA { data[idx(lx, y, lz)] = WATER; }
        max_y = max_y.max(h + 1).max(SEA + 1);
        if top == GRASS && lx >= 2 && lx <= 13 && lz >= 2 && lz <= 13 && hash3(wx, wz, 7, seed) < 0.014 {
            let th = 4 + (hash3(wx, wz, 8, seed) * 3.0).floor() as i32; let tp = h + th;
            for dy in -2..=1 {
                let r: i32 = if dy == 1 { 1 } else { 2 };
                for dx in -r..=r { for dz in -r..=r {
                    if dx.abs() == r && dz.abs() == r && (dy == 1 || hash3(wx + dx, wz + dz, dy, seed) > 0.5) { continue; }
                    let y = tp + dy;
                    if y < CH && data[idx(lx + dx, y, lz + dz)] == 0 { data[idx(lx + dx, y, lz + dz)] = LEAVES; max_y = max_y.max(y + 1); }
                } }
            }
            for y in (h + 1)..=tp { data[idx(lx, y, lz)] = LOG; }
        }
    } }
    (max_y + 1).min(CH)
}
