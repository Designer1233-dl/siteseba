const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const sessions = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

const readUsers = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const writeUsers = users => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve,reject) => { let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>1e6) reject(Error('too large')); }); req.on('end',()=>{ try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)} }); });
const hashPassword = password => { const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64); return `${salt.toString('hex')}:${hash.toString('hex')}`; };
const passwordOk = (password, saved) => { try { const [s,h]=saved.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(password,Buffer.from(s,'hex'),64)); } catch{return false} };
const publicUser = u => ({id:u.id,name:u.name,username:u.username,avatar:u.avatar||'',bio:u.bio||'',online:false});
const authUser = req => { const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const id=sessions.get(token); return readUsers().find(u=>u.id===id); };

async function api(req,res,url){
  if(req.method==='POST' && url.pathname==='/api/register'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(), name=String(p.name||'').trim(), password=String(p.password||'');
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return json(res,400,{error:'Username: латиница, цифры и _ — от 5 символов'});
    if(name.length<2 || name.length>32 || password.length<8) return json(res,400,{error:'Проверь имя и пароль'});
    const users=readUsers(); if(users.some(u=>u.username===username)) return json(res,409,{error:'Этот username уже занят'});
    const user={id:crypto.randomUUID(),name,username,password:hashPassword(password),avatar:'',bio:'',createdAt:Date.now()}; users.push(user); writeUsers(users);
    const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,user.id); return json(res,201,{token,user:publicUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase(); const user=readUsers().find(u=>u.username===username);
    if(!user || !passwordOk(String(p.password||''),user.password)) return json(res,401,{error:'Неверный username или пароль'});
    const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,user.id); return json(res,200,{token,user:publicUser(user)});
  }
  if(req.method==='GET' && url.pathname==='/api/users'){
    const me=authUser(req); if(!me) return json(res,401,{error:'Нужно войти'}); const q=(url.searchParams.get('q')||'').replace(/^@/,'').toLowerCase();
    const users=readUsers().filter(u=>u.id!==me.id && (!q || u.username.includes(q) || u.name.toLowerCase().includes(q))).slice(0,50).map(publicUser); return json(res,200,{users});
  }
  if(req.method==='GET' && url.pathname==='/api/me'){ const me=authUser(req); return me?json(res,200,{user:publicUser(me)}):json(res,401,{error:'Нужно войти'}); }
  if(req.method==='PATCH' && url.pathname==='/api/me'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),users=readUsers(),u=users.find(x=>x.id===me.id),username=String(p.username||u.username).replace(/^@/,'').toLowerCase();
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)||users.some(x=>x.id!==u.id&&x.username===username))return json(res,409,{error:'Username некорректен или занят'});
    u.name=String(p.name||u.name).slice(0,32);u.username=username;u.bio=String(p.bio||'').slice(0,100);if(String(p.avatar||'').length<500000)u.avatar=p.avatar||u.avatar;writeUsers(users);return json(res,200,{user:publicUser(u)});
  }
  return json(res,404,{error:'Не найдено'});
}

http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try { if(url.pathname.startsWith('/api/')) return await api(req,res,url); } catch(e){ return json(res,500,{error:'Ошибка сервера'}); }
  const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''), file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript':'application/octet-stream'});res.end(data)});
}).listen(PORT,'0.0.0.0',()=>console.log(`Пропал из Интернета: порт ${PORT}`));
