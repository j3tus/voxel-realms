// Procedural texture atlas (8x8 tiles of 64px) painted at start-up - no image assets needed.
import { hash3, lerp } from '../shared/worldgen.js';
import { TILES } from '../shared/blocks.js';
import { ATL } from '../shared/mesher.js';
export const TS = 64;
export { ATL };
const h3 = (a, b, c, s = 0) => hash3(a, b, c, s);
export function makeAtlas(){
  const cv = document.createElement('canvas'); cv.width = cv.height = TS*ATL;
  const ctx = cv.getContext('2d',{willReadFrequently:true});
  // tileable value noise
  const tn=(id,x,y,s)=>{ const n=TS/s, gx=x/s, gy=y/s, ix=Math.floor(gx), iy=Math.floor(gy), fx=gx-ix, fy=gy-iy;
    const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy), h=(a,b)=>h3(((a%n)+n)%n,((b%n)+n)%n,id,0);
    return lerp(lerp(h(ix,iy),h(ix+1,iy),u),lerp(h(ix,iy+1),h(ix+1,iy+1),u),v); };
  const fb=(id,x,y)=>tn(id,x,y,32)*.45+tn(id,x,y,16)*.25+tn(id,x,y,8)*.18+tn(id,x,y,4)*.12;
  const gr=(id,x,y)=>h3(x,y,id,7);
  const C=(b,k,a=255)=>[b[0]*k,b[1]*k,b[2]*k,a];
  const stone=(id,x,y)=>{ let k=.78+fb(id,x,y)*.5+gr(id,x,y)*.06; if(Math.abs(tn(id,x,y,16)-.5)<.025)k*=.78; return k; };
  const DIRT_C=[134,96,67], GRASS_C=[86,152,56], STONE_C=[128,128,134];
  const paint = [
    (x,y)=>C(GRASS_C,.78+fb(0,x,y)*.55+gr(0,x,y)*.07),
    (x,y)=>{ const e=12+tn(1,x,y,8)*9+gr(1,x,0)*3; return y<e ? C(GRASS_C,.78+fb(0,x,y)*.55) : C(DIRT_C,.82+fb(1,x,y)*.45+gr(1,x,y)*.06); },
    (x,y)=> tn(2,x,y,4)>.82 ? C([150,140,130],.9+gr(2,x,y)*.2) : C(DIRT_C,.82+fb(2,x,y)*.5+gr(2,x,y)*.07),
    (x,y)=>C(STONE_C,stone(3,x,y)),
    (x,y)=>C([222,208,158],.92+fb(4,x,y)*.14+gr(4,x,y)*.07),
    (x,y)=>C([104,80,50],.7+tn(5,x,5,4)*.45+tn(5,x,9,2)*.2+fb(5,x,y)*.15),
    (x,y)=>{ const r=Math.hypot(x-31.5,y-31.5); return r>28 ? C([88,66,40],.8+tn(6,x,y,4)*.4) : C([176,142,92],.82+.14*Math.sin(r*1.15+tn(6,x,y,16)*3)+gr(6,x,y)*.05); },
    (x,y)=>{ const k=.62+fb(7,x,y)*.8; const hole=tn(7,x,y,8)>.84; return C([58,128,48],k,hole?0:255); },
    (x,y)=>C([36,108,192],.9+fb(8,x,y)*.25,175),
    (x,y)=>{ const row=Math.floor(y/16); let k=.86+gr(9,row,0)*.14+fb(9,x,y)*.14; if(y%16<1.5)k*=.6; if(Math.abs(x-(row*23)%64)<1.2)k*=.72; return C([176,136,84],k); },
    (x,y)=>{ const edge=x<3||y<3||x>60||y>60; if(edge) return [215,238,246,215]; const sheen=((x+y)%32)<4 && x>6 && y>6; return [190,225,240,sheen?120:34]; },
    (x,y)=>{ const row=Math.floor(y/16), off=(row%2)*16, bx=(x+off)%32; const n=fb(11,x,y);
      if(y%16<2||bx<2) return C([186,180,172],.85+n*.3);
      return C([162,68,52],.78+gr(11,Math.floor((x+off)/32),row)*.35+n*.2); },
    (x,y)=>C([240,246,252],.93+fb(12,x,y)*.1+gr(12,x,y)*.03),
    (x,y)=>{ const v=tn(13,x,y,16)*5, d=Math.abs(v-Math.round(v)); return C([122,122,126],.5+(Math.round(v)/5)*.55+(d<.07?-.25:0)+gr(13,x,y)*.05); },
    (x,y)=> tn(14,x,y,8)>.72 ? C([26,26,30],.8+gr(14,x,y)*.5) : C(STONE_C,stone(14,x,y)),
    (x,y)=> tn(15,x,y,8)>.72 ? C([238,198,62],.85+gr(15,x,y)*.35) : C(STONE_C,stone(15,x,y))
  ];
  const ore=(id,x,y,col)=> tn(id,x,y,8)>.72 ? C(col,.85+gr(id,x,y)*.35) : C(STONE_C,stone(id,x,y));
  const wool=(id,b)=>(x,y)=>C(b,.88+(((x>>1)+(y>>1))%2?.07:0)+fb(id,x,y)*.1+gr(id,x,y)*.05);
  paint.push(
    (x,y)=>C([160,166,182],.9+fb(16,x,y)*.16+gr(16,x,y)*.03),
    (x,y)=>{ const v=tn(17,x,y,4); return C(v>.6?[150,146,142]:[112,108,106],.65+v*.5+gr(17,x,y)*.2); },
    (x,y)=>ore(18,x,y,[216,168,140]),
    (x,y)=>ore(19,x,y,[90,232,232]),
    wool(20,[236,236,236]), wool(21,[172,46,46]), wool(22,[52,72,176]),
    (x,y)=>{ const row=Math.floor(y/16), off=(row%2)*16, bx=(x+off)%32; if(y%16<2||bx<2) return C([88,88,92],.8+fb(23,x,y)*.3); return C(STONE_C,.85+gr(23,Math.floor((x+off)/32),row)*.2+fb(23,x,y)*.25); },
    (x,y)=>{ const row=Math.floor(y/16); let k=.85+gr(24,row,0)*.14+fb(24,x,y)*.14; if(y%16<1.5)k*=.6; if(Math.abs(x-(row*23)%64)<1.2)k*=.72; return C([86,60,36],k); },
    (x,y)=>C([214,196,150],.9+.07*Math.sin(y*.45)+fb(26,x,y)*.12+gr(26,x,y)*.03),
    (x,y)=>C([26,18,44],.55+fb(27,x,y)*1.3+(tn(27,x,y,16)>.7?.35:0)),
    (x,y)=>C([150,202,244],.88+fb(28,x,y)*.3+(((x+y*1.3)%40)<3?.18:0),235),
    (x,y)=>{ if(y<7||y>56) return C([176,136,84],.85+fb(29,x,y)*.2); if(y>=28&&y<36) return C([60,42,24],.8); const row=y<28?0:1, bk=Math.floor(x/6), hh=h3(bk,row,29,0); if(x%6===0) return C([40,28,18],1); const cols=[[170,50,50],[50,100,170],[60,140,70],[200,170,60],[120,70,150]]; return C(cols[Math.floor(hh*5)],.7+gr(29,x,y)*.3); },
    (x,y)=>{ const v=tn(30,x,y,8); return C([255,206,110],.7+fb(30,x,y)*.7+(v>.65?.4:0)); },
    (x,y)=>C([246,206,72],.82+fb(31,x,y)*.3+(x+y<10?.2:0)),
    (x,y)=>C([100,236,232],.82+fb(32,x,y)*.3+(x+y<10?.2:0))
  );
  const img = ctx.createImageData(TS*ATL, TS*ATL);
  for(let t=0;t<paint.length;t++){
    const ox=(t%ATL)*TS, oy=Math.floor(t/ATL)*TS;
    for(let y=0;y<TS;y++) for(let x=0;x<TS;x++){
      const c=paint[t](x,y); if(c[3]>=250&&t!==7){ const e=Math.min(x,y,TS-1-x,TS-1-y); if(e<2){ const f=e===0?.84:.93; c[0]*=f;c[1]*=f;c[2]*=f; } }
      const i=((oy+y)*TS*ATL+ox+x)*4;
      img.data[i]=Math.min(255,c[0]); img.data[i+1]=Math.min(255,c[1]); img.data[i+2]=Math.min(255,c[2]); img.data[i+3]=c[3];
    }
  }
  ctx.putImageData(img,0,0);
  return cv;
}


export function blockColors(atlas) {
  return TILES.map(t => {
    if (!t) return 0xffffff;
    const d = atlas.getContext('2d').getImageData((t[1] % ATL) * TS, Math.floor(t[1] / ATL) * TS, TS, TS).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; return ((r / n) << 16) | ((g / n) << 8) | (b / n);
  });
}
