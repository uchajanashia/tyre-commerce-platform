import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, relative } from 'node:path';
const root=resolve(fileURLToPath(new URL('../docs/',import.meta.url)));
const entries=['index.html','storefront/index.html','admin/index.html'];
const issues=[];let references=0,files=0;
async function exists(path){try{return await stat(path);}catch{return null;}}
async function checkReference(owner,value){
 if(!value||/^(?:https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(value)||value.includes('${'))return;
 let clean=value.split(/[?#]/)[0];if(!clean)return;
 try{clean=decodeURIComponent(clean);}catch{return;}
 if(clean.startsWith('/')){issues.push(`${relative(root,owner)}: root-relative resource ${clean}`);return;}
 const path=resolve(dirname(owner),clean);
 if(path!==root&&!path.startsWith(root+'\\')&&!path.startsWith(root+'/')){issues.push(`Escaping demo path in ${relative(root,owner)}`);return;}
 const info=await exists(path);references++;
 if(!info||(info.isDirectory()&&!await exists(resolve(path,'index.html'))))issues.push(`${relative(root,owner)}: missing ${clean}`);
}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const path=resolve(dir,entry.name);if(entry.isDirectory()){await walk(path);continue;}files++;
 if(/^(?:\.env|.*\.(?:key|pem|sqlite|db|log|map))$/.test(entry.name))issues.push(`Unexpected private/build artifact: ${relative(root,path)}`);
 const ext=extname(path);if(!['.html','.js','.css','.json'].includes(ext))continue;
 const text=await readFile(path,'utf8');if(ext==='.json'){try{JSON.parse(text);}catch{issues.push(`Invalid JSON: ${relative(root,path)}`);}continue;}
 if(ext==='.html'){
  if(path.endsWith('index.html')&&path!==resolve(root,'index.html')&&!/<base href="\.\/"\s*\/?>/.test(text))issues.push(`Missing relative base: ${relative(root,path)}`);
  for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g))await checkReference(path,match[1]);
 }
 if(ext==='.css')for(const match of text.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))await checkReference(path,match[1]);
 if(ext==='.js'){
  for(const match of text.matchAll(/(?:from|import\()\s*["'](\.\.?\/[^"']+\.js)["']/g))await checkReference(path,match[1]);
  for(const match of text.matchAll(/["'`]((?:\.\/)?(?:assets|images|new_image|vehicle-visuals|brand)\/[^"'`\s]+\.(?:svg|webp|png|jpg|mp4|glb))["'`]/g))await checkReference(path,match[1]);
 }
}}
for(const entry of entries)if(!await exists(resolve(root,entry)))issues.push(`Missing entry: ${entry}`);
await walk(root);
console.log(JSON.stringify({files,references,issues},null,2));
if(issues.length)process.exitCode=1;
