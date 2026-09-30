import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir=import.meta.dirname, receipt=JSON.parse(await readFile(dir+'/provenance.json','utf8'));
for(const [id,i] of [['island_tree_01',0],['island_tree_02',1],['island_tree_03',2]]) {
 const meta=await(await fetch('https://api.polyhaven.com/files/'+id)).json(), src=meta.leaves_alpha['1k'].png;
 const b=Buffer.from(await(await fetch(src.url)).arrayBuffer());
 if(b.length!==src.size||createHash('md5').update(b).digest('hex')!==src.md5)throw Error('integrity');
 const file='canopy'+i+'-leaf-alpha-1k.png'; await writeFile(dir+'/'+file,b);
 receipt.assets[i].alpha={file,url:src.url,bytes:b.length,md5:src.md5,sha256:createHash('sha256').update(b).digest('hex'),usage:'Unmodified native alpha PNG; alphaMap uses green grayscale channel'};
}
receipt.totalBytes=receipt.assets.reduce((s,a)=>s+a.output.bytes+a.alpha.bytes,0);
await writeFile(dir+'/provenance.json',JSON.stringify(receipt,null,2)+'\n','utf8');
console.log(receipt.totalBytes);
