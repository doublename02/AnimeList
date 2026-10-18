// Dependency-free bundle for Cloudflare's dashboard editor.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const library=(await readFile(new URL('library.mjs',root),'utf8')).replace(/^export /gm,'');
const worker=(await readFile(new URL('worker/index.mjs',root),'utf8')).replace(/^import .*from '\.\.\/library\.mjs';\s*/,'').replace(/^export (?!default)/gm,'');
const directory=new URL('worker/dist/',root);
await mkdir(directory,{recursive:true});
await writeFile(new URL('worker.mjs',directory),library+'\n'+worker);
console.log('Worker bundle: worker/dist/worker.mjs');
