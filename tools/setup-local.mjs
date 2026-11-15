import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const path=new URL('.env',root);
try{await access(path);console.log('Existing local .env preserved.');}
catch{
  const secret=()=>randomBytes(32).toString('hex');
  const password=secret();
  const template=await readFile(new URL('.env.example',root),'utf8');
  const text=template.replaceAll('REPLACE_WITH_GENERATED_LOCAL_PASSWORD',password).replaceAll('REPLACE_WITH_GENERATED_LOCAL_SECRET',secret());
  await writeFile(path,text,{mode:0o600,flag:'wx'});
  console.log('Generated private local .env; no credentials printed.');
}
const api=new URL('apps/api/.env',root);
try{await access(api);console.log('Existing API .env preserved.');}
catch{await writeFile(api,await readFile(path),{mode:0o600,flag:'wx'});}
