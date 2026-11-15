import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=new URL('../',import.meta.url);
for(const [app,name] of [['website','storefront'],['adminka','admin']]){
  const source=new URL(`apps/${app}/dist/demo/browser/`,root);
  const target=new URL(`docs/${name}/`,root);
  const targetPath=resolve(fileURLToPath(target));
  if(targetPath!==resolve(fileURLToPath(root),'docs',name))throw new Error('Unexpected demo output directory.');
  await rm(targetPath,{recursive:true,force:true});
  await mkdir(target,{recursive:true});await cp(source,target,{recursive:true});
  // Hash routing keeps the pathname fixed. Normalize original absolute media
  // references so both GitHub project Pages and nested local previews work.
  for(const entry of await readdir(target)){
    if(!/\.(html|js|css)$/.test(entry))continue;
    const file=new URL(entry,target);let content=await readFile(file,'utf8');
    content=content.replace(/(["'`(])\/(assets|images|new_image|vehicle-visuals|brand)\//g,'$1./$2/');
    content=content.replace(/(["'`])\/(main_hero\.webp|favicon[^"'`]*|apple-touch-icon\.png)/g,'$1./$2');
    if(entry.endsWith('.html'))content=content.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g,tag=>tag.replace(/\s+onload="[^"]*"/g,'').replace(/\s+media="print"/g,''));
    await writeFile(file,content);
  }
}
await writeFile(new URL('docs/.nojekyll',root),'');
console.log('Staged storefront + operations demo under docs/.');
