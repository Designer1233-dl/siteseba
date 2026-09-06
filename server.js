const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_VERSION = 'build-10-admin-replies-connection-fix';
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const waiters = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({verifications:[],pinned:null},null,2));

const readUsers = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const writeUsers = users => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
const readMessages = () => { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } };
const writeMessages = items => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(items, null, 2));
const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8')); } catch { return {verifications:[],pinned:null}; } };
const writeSettings = value => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value,null,2));
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve,reject) => { let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>8e6) reject(Error('too large')); }); req.on('end',()=>{ try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)} }); });
const hashPassword = password => { const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64); return `${salt.toString('hex')}:${hash.toString('hex')}`; };
const passwordOk = (password, saved) => { try { const [s,h]=saved.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(password,Buffer.from(s,'hex'),64)); } catch{return false} };
const isAdmin = u => u?.username?.toLowerCase()==='vsevolod';
const publicUser = u => { const settings=readSettings(),verified=(settings.verifications||[]).some(v=>v.type==='user'&&v.username===u.username); return {id:u.id,name:u.name,username:u.username,avatar:u.avatar||'',bio:u.bio||'',notifications:u.notifications!==false,verified,isAdmin:isAdmin(u),online:false}; };
const readSessions = () => { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8')); } catch { return {}; } };
const saveSession = (token,id) => { const all=readSessions(); all[token]={id,createdAt:Date.now()}; fs.writeFileSync(SESSIONS_FILE,JSON.stringify(all)); };
const authUser = req => { const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const session=readSessions()[token]; return readUsers().find(u=>u.id===session?.id); };
const wakeUser = id => { const list=waiters.get(id)||[]; waiters.delete(id); list.forEach(fn=>fn()); };
const waitForMessage = id => new Promise(resolve => { const fn=()=>{clearTimeout(timer);resolve()}; const timer=setTimeout(()=>{const list=waiters.get(id)||[];waiters.set(id,list.filter(x=>x!==fn));resolve()},25000); waiters.set(id,[...(waiters.get(id)||[]),fn]); });

async function api(req,res,url){
  if(req.method==='GET' && url.pathname==='/api/health'){
    return json(res,200,{ok:true,version:APP_VERSION,time:Date.now()});
  }
  if(req.method==='POST' && url.pathname==='/api/register'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(), name=String(p.name||'').trim(), password=String(p.password||'');
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return json(res,400,{error:'Username: латиница, цифры и _ — от 5 символов'});
    if(name.length<2 || name.length>32 || password.length<8) return json(res,400,{error:'Проверь имя и пароль'});
    const users=readUsers(); if(users.some(u=>u.username===username)) return json(res,409,{error:'Этот username уже занят'});
    const user={id:crypto.randomUUID(),name,username,password:hashPassword(password),avatar:'',bio:'',notifications:true,createdAt:Date.now()}; users.push(user); writeUsers(users);
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
  if(req.method==='GET' && url.pathname==='/api/pinned'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); return json(res,200,{pinned:readSettings().pinned||null});
  }
  if(url.pathname.startsWith('/api/admin/')){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); if(!isAdmin(me))return json(res,403,{error:'Доступ только для администратора @Vsevolod'});
    if(req.method==='GET'&&url.pathname==='/api/admin/messages'){
      const users=readUsers(),names=new Map(users.map(u=>[u.id,{name:u.name,username:u.username}]));
      const messages=readMessages().slice(-1000).reverse().map(m=>({id:m.id,from:names.get(m.from)||{name:'Удалённый аккаунт',username:'unknown'},to:names.get(m.to)||{name:'Удалённый аккаунт',username:'unknown'},text:m.text||'',hasImage:Boolean(m.image)||Boolean(m.viewedAt),viewOnce:Boolean(m.viewOnce),replyTo:m.replyTo||null,adminSent:Boolean(m.impersonatedBy),createdAt:m.createdAt,readAt:m.readAt||null,viewedAt:m.viewedAt||null}));
      return json(res,200,{messages});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/messages/reply'){
      const p=await body(req),messages=readMessages(),original=messages.find(m=>m.id===String(p.messageId||'')),side=String(p.as||''),text=String(p.text||'').trim();if(!original)return json(res,404,{error:'Исходное сообщение не найдено'});if(!['from','to'].includes(side)||!text||text.length>4000)return json(res,400,{error:'Проверьте сторону ответа и текст'});const from=side==='from'?original.from:original.to,to=side==='from'?original.to:original.from,message={id:crypto.randomUUID(),from,to,text,image:'',viewOnce:false,replyTo:original.id,impersonatedBy:me.id,createdAt:Date.now()};messages.push(message);writeMessages(messages);wakeUser(from);wakeUser(to);return json(res,201,{message});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/settings')return json(res,200,readSettings());
    if(req.method==='POST'&&url.pathname==='/api/admin/verify'){
      const p=await body(req),type=String(p.type||''),username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(),enabled=p.enabled!==false;
      if(!['user','channel','group'].includes(type)||!/^[a-z][a-z0-9_]{2,63}$/.test(username))return json(res,400,{error:'Укажите корректные тип и username'});
      if(type==='user'&&!readUsers().some(u=>u.username===username))return json(res,404,{error:'Пользователь не найден'});
      const settings=readSettings();settings.verifications=Array.isArray(settings.verifications)?settings.verifications:[];settings.verifications=settings.verifications.filter(v=>!(v.type===type&&v.username===username));if(enabled)settings.verifications.push({type,username,createdAt:Date.now(),by:me.id});writeSettings(settings);return json(res,200,settings);
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/pin'){
      const p=await body(req),type=String(p.type||''),username=String(p.username||'').replace(/^@/,'').toLowerCase().trim();if(!['user','channel','group'].includes(type)||!/^[a-z][a-z0-9_]{2,63}$/.test(username))return json(res,400,{error:'Укажите корректные тип и username'});if(type==='user'&&!readUsers().some(u=>u.username===username))return json(res,404,{error:'Пользователь не найден'});const settings=readSettings();settings.pinned={type,username,createdAt:Date.now(),by:me.id};writeSettings(settings);return json(res,200,settings);
    }
    if(req.method==='DELETE'&&url.pathname==='/api/admin/pin'){const settings=readSettings();settings.pinned=null;writeSettings(settings);return json(res,200,settings);}
  }
  if(req.method==='GET' && url.pathname==='/api/conversations'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'});
    const messages=readMessages().filter(m=>m.from===me.id||m.to===me.id), ids=[...new Set(messages.map(m=>m.from===me.id?m.to:m.from))], users=readUsers();
    const conversations=ids.map(id=>{const user=users.find(u=>u.id===id),last=[...messages].reverse().find(m=>(m.from===me.id&&m.to===id)||(m.from===id&&m.to===me.id));return user?{user:publicUser(user),last}:null}).filter(Boolean).sort((a,b)=>b.last.createdAt-a.last.createdAt);
    return json(res,200,{conversations});
  }
  if(req.method==='GET' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const username=(url.searchParams.get('with')||'').replace(/^@/,'').toLowerCase(),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Пользователь не найден'}); const all=readMessages(); let changed=false; all.forEach(m=>{if(m.from===other.id&&m.to===me.id&&!m.readAt){m.readAt=Date.now();changed=true}}); if(changed){writeMessages(all);wakeUser(other.id)} const messages=all.filter(m=>(m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)).slice(-300).map(m=>({...m,image:m.viewOnce&&m.to===me.id?'':m.image,mine:m.from===me.id,viewed:m.viewedAt||false}));
    return json(res,200,{user:publicUser(other),messages});
  }
  if(req.method==='GET' && url.pathname==='/api/events'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const since=Number(url.searchParams.get('since')||0);
    let latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0);
    if(latest<=since){await waitForMessage(me.id);latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0)}
    return json(res,200,{changed:latest>since,cursor:latest});
  }
  if(req.method==='POST' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),username=String(p.to||'').replace(/^@/,'').toLowerCase(),text=String(p.text||'').trim(),image=String(p.image||''),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Получатель не найден'}); if((!text&&!image)||(text.length>4000)||(image.length>7000000)||(image&&!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(image)))return json(res,400,{error:'Сообщение пустое или изображение некорректно'});
    const messages=readMessages(),replyTo=String(p.replyTo||'');if(replyTo&&!messages.some(m=>m.id===replyTo&&((m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id))))return json(res,400,{error:'Нельзя ответить на это сообщение'});const message={id:crypto.randomUUID(),from:me.id,to:other.id,text,image,viewOnce:Boolean(p.viewOnce),replyTo:replyTo||null,createdAt:Date.now()};messages.push(message);writeMessages(messages);wakeUser(other.id);wakeUser(me.id);return json(res,201,{message:{...message,mine:true}});
  }
  if(req.method==='POST' && url.pathname.startsWith('/api/messages/') && url.pathname.endsWith('/view')){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const id=url.pathname.split('/')[3],messages=readMessages(),m=messages.find(x=>x.id===id&&x.to===me.id&&x.viewOnce); if(!m)return json(res,404,{error:'Изображение не найдено'}); if(m.viewedAt)return json(res,410,{error:'Изображение уже просмотрено'}); const image=m.image;m.viewedAt=Date.now();m.image='';writeMessages(messages);wakeUser(m.from);return json(res,200,{image});
  }
  if(req.method==='PATCH' && url.pathname==='/api/me'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),users=readUsers(),u=users.find(x=>x.id===me.id),username=String(p.username||u.username).replace(/^@/,'').toLowerCase();
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)||users.some(x=>x.id!==u.id&&x.username===username))return json(res,409,{error:'Username некорректен или занят'});
    u.name=String(p.name||u.name).slice(0,32);u.username=username;u.bio=String(p.bio||'').slice(0,100);if(typeof p.notifications==='boolean')u.notifications=p.notifications;if(String(p.avatar||'').length<500000)u.avatar=p.avatar||u.avatar;writeUsers(users);return json(res,200,{user:publicUser(u)});
  }
  return json(res,404,{error:'Не найдено'});
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try { if(url.pathname.startsWith('/api/')) return await api(req,res,url); } catch(e){ console.error('API error:',req.method,url.pathname,e); return json(res,500,{error:'Ошибка сервера',version:APP_VERSION}); }
  const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''), file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript':'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0'});res.end(data)});
});
server.on('error',e=>console.error('Server startup error:',e));
server.listen(PORT,'0.0.0.0',()=>console.log(`Пропал из Интернета ${APP_VERSION}: порт ${PORT}`));
