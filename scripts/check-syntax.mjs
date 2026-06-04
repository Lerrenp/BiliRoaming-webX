import fs from 'fs'; import path from 'path'; import vm from 'vm';
const files=[]; function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(/\.(js|mjs)$/.test(e.name)&&!p.includes(path.sep+'vendor'+path.sep)) files.push(p); }}
walk(path.join(process.cwd(),'src'));
for(const f of files){ const code=fs.readFileSync(f,'utf8'); new vm.SourceTextModule(code,{identifier:f}); console.log('ok',path.relative(process.cwd(),f)); }
