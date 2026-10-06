import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Pinned original CC0 maps, 2.1m scan span. No catalogue crawling or paid services.
const directory=resolve(import.meta.dirname,'../src/assets/pavement');
const maps=[
 {role:'albedo',suffix:'diff',bytes:3314999,md5:'d3afa117daf0846a743bbf5b4eb2464d',colorSpace:'sRGB'},
 {role:'normalGL',suffix:'nor_gl',bytes:3923727,md5:'f9d4e1b14ac5b231748b600dcd59f20e',colorSpace:'linear-data'},
 {role:'arm',suffix:'arm',bytes:3461113,md5:'683b881a2b614cd57fd518102f6ce99a',colorSpace:'linear-data'},
];
const hash=(kind,bytes)=>createHash(kind).update(bytes).digest('hex');
await mkdir(directory,{recursive:true});
const files=await Promise.all(maps.map(async map=>{
 const file=`clean_asphalt_${map.suffix}_2k.jpg`,url=`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/clean_asphalt/${file}`,path=resolve(directory,file);
 let bytes;
 try{bytes=await readFile(path);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(url,{headers:{'User-Agent':'SeaLocalAssetPreparation/1.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok||!response.url.startsWith('https://dl.polyhaven.org/'))throw new Error(`Pavement download ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());
 }
 if(bytes.length!==map.bytes||hash('md5',bytes)!==map.md5||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error(`Original map integrity failed: ${file}`);
 await writeFile(path,bytes);
 return {...map,file,url,sha256:hash('sha256',bytes)};
}));
await writeFile(resolve(directory,'manifest.json'),JSON.stringify({asset:'clean_asphalt',author:'Dimitrios Savva',license:'CC0-1.0',source:'https://polyhaven.com/a/clean_asphalt',sourceLicense:'https://polyhaven.com/license',apiInfo:'https://api.polyhaven.com/info/clean_asphalt',apiFiles:'https://api.polyhaven.com/files/clean_asphalt',spanMeters:2.1,resolution:2048,scope:'Generic road material, not a photographic scan of Habushi pavement',files},null,2)+'\n');
await writeFile(resolve(directory,'LICENSE.txt'),'Clean Asphalt by Dimitrios Savva / Poly Haven\nCC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/\nSource: https://polyhaven.com/a/clean_asphalt\nLicense: https://polyhaven.com/license\n');
process.stdout.write(JSON.stringify({files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),integrity:'PASS'})+'\n');
