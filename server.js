const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const waiters = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');

const readUsers = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const writeUsers = users => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
const readMessages = () => { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } };
const writeMessages = items => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(items, null, 2));
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve,reject) => { let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>1e6) reject(Error('too large')); }); req.on('end',()=>{ try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)} }); });
const hashPassword = password => { const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64); return `${salt.toString('hex')}:${hash.toString('hex')}`; };
const passwordOk = (password, saved) => { try { const [s,h]=saved.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(password,Buffer.from(s,'hex'),64)); } catch{return false} };
const publicUser = u => ({id:u.id,name:u.name,username:u.username,avatar:u.avatar||'',bio:u.bio||'',online:false});
const readSessions = () => { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8')); } catch { return {}; } };
const saveSession = (token,id) => { const all=readSessions(); all[token]={id,createdAt:Date.now()}; fs.writeFileSync(SESSIONS_FILE,JSON.stringify(all)); };
const authUser = req => { const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const session=readSessions()[token]; return readUsers().find(u=>u.id===session?.id); };
const wakeUser = id => { const list=waiters.get(id)||[]; waiters.delete(id); list.forEach(fn=>fn()); };
const waitForMessage = id => new Promise(resolve => { const fn=()=>{clearTimeout(timer);resolve()}; const timer=setTimeout(()=>{const list=waiters.get(id)||[];waiters.set(id,list.filter(x=>x!==fn));resolve()},25000); waiters.set(id,[...(waiters.get(id)||[]),fn]); });

async function api(req,res,url){
  if(req.method==='POST' && url.pathname==='/api/register'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(), name=String(p.name||'').trim(), password=String(p.password||'');
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return json(res,400,{error:'Username: латиница, цифры и _ — от 5 символов'});
    if(name.length<2 || name.length>32 || password.length<8) return json(res,400,{error:'Проверь имя и пароль'});
    const users=readUsers(); if(users.some(u=>u.username===username)) return json(res,409,{error:'Этот username уже занят'});
    const user={id:crypto.randomUUID(),name,username,password:hashPassword(password),avatar:'',bio:'',createdAt:Date.now()}; users.push(user); writeUsers(users);
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,201,{token,user:publicUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase(); const user=readUsers().find(u=>u.username===username);
    if(!user || !passwordOk(String(p.password||''),user.password)) return json(res,401,{error:'Неверный username или пароль'});
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,200,{token,user:publicUser(user)});
  }
  if(req.method==='GET' && url.pathname==='/api/users'){
    const me=authUser(req); if(!me) return json(res,401,{error:'Нужно войти'}); const q=(url.searchParams.get('q')||'').replace(/^@/,'').toLowerCase();
    const users=readUsers().filter(u=>u.id!==me.id && (!q || u.username.includes(q) || u.name.toLowerCase().includes(q))).slice(0,50).map(publicUser); return json(res,200,{users});
  }
  if(req.method==='GET' && url.pathname==='/api/me'){ const me=authUser(req); return me?json(res,200,{user:publicUser(me)}):json(res,401,{error:'Нужно войти'}); }
  if(req.method==='GET' && url.pathname==='/api/conversations'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'});
    const messages=readMessages().filter(m=>m.from===me.id||m.to===me.id), ids=[...new Set(messages.map(m=>m.from===me.id?m.to:m.from))], users=readUsers();
    const conversations=ids.map(id=>{const user=users.find(u=>u.id===id),last=[...messages].reverse().find(m=>(m.from===me.id&&m.to===id)||(m.from===id&&m.to===me.id));return user?{user:publicUser(user),last}:null}).filter(Boolean).sort((a,b)=>b.last.createdAt-a.last.createdAt);
    return json(res,200,{conversations});
  }
  if(req.method==='GET' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const username=(url.searchParams.get('with')||'').replace(/^@/,'').toLowerCase(),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Пользователь не найден'}); const messages=readMessages().filter(m=>(m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)).slice(-300).map(m=>({...m,mine:m.from===me.id}));
    return json(res,200,{user:publicUser(other),messages});
  }
  if(req.method==='GET' && url.pathname==='/api/events'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const since=Number(url.searchParams.get('since')||0);
    let latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0);
    if(latest<=since){await waitForMessage(me.id);latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0)}
    return json(res,200,{changed:latest>since,cursor:latest});
  }
  if(req.method==='POST' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),username=String(p.to||'').replace(/^@/,'').toLowerCase(),text=String(p.text||'').trim(),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Получатель не найден'}); if(!text||text.length>4000)return json(res,400,{error:'Сообщение пустое или слишком длинное'});
    const messages=readMessages(),message={id:crypto.randomUUID(),from:me.id,to:other.id,text,createdAt:Date.now()};messages.push(message);writeMessages(messages);wakeUser(other.id);wakeUser(me.id);return json(res,201,{message:{...message,mine:true}});
  }
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
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript':'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0'});res.end(data)});
}).listen(PORT,'0.0.0.0',()=>console.log(`Пропал из Интернета: порт ${PORT}`));
