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
const AUDIT_FILE = path.join(DATA_DIR, 'moderation-audit.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const OWNER_USERNAME = String(process.env.OWNER_USERNAME || 'Vsevolod').replace(/^@/,'').toLowerCase();
const waiters = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '[]');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '{}');

const readUsers = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const writeUsers = users => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
const readMessages = () => { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } };
const writeMessages = items => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(items, null, 2));
const readAudit = () => { try { return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch { return []; } };
const writeAudit = items => fs.writeFileSync(AUDIT_FILE, JSON.stringify(items.slice(-1000), null, 2));
const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } };
const writeSettings = value => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value, null, 2));
const json = (res, code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve,reject) => { let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>5e6) reject(Error('too large')); }); req.on('end',()=>{ try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)} }); });
const hashPassword = password => { const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64); return `${salt.toString('hex')}:${hash.toString('hex')}`; };
const passwordOk = (password, saved) => { try { const [s,h]=saved.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(password,Buffer.from(s,'hex'),64)); } catch{return false} };
const publicUser = u => ({id:u.id,name:u.name,username:u.username,avatar:u.avatar||'',bio:u.bio||'',online:false,notifications:u.notifications!==false,role:u.role||'user',verified:Boolean(u.verified),verifiedType:u.verifiedType||null,blocked:Boolean(u.blocked)});
const readSessions = () => { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8')); } catch { return {}; } };
const saveSession = (token,id) => { const all=readSessions(); all[token]={id,createdAt:Date.now()}; fs.writeFileSync(SESSIONS_FILE,JSON.stringify(all)); };
const authUser = req => { const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const session=readSessions()[token]; return readUsers().find(u=>u.id===session?.id); };
const isModerator = u => Boolean(u && (u.role==='owner' || u.role==='moderator'));
const audit = (actor, action, details={}) => { const items=readAudit(); items.push({id:crypto.randomUUID(),actorId:actor.id,actorUsername:actor.username,action,details,createdAt:Date.now()}); writeAudit(items); };
const wakeUser = id => { const list=waiters.get(id)||[]; waiters.delete(id); list.forEach(fn=>fn()); };
const waitForMessage = id => new Promise(resolve => { const fn=()=>{clearTimeout(timer);resolve()}; const timer=setTimeout(()=>{const list=waiters.get(id)||[];waiters.set(id,list.filter(x=>x!==fn));resolve()},25000); waiters.set(id,[...(waiters.get(id)||[]),fn]); });

async function api(req,res,url){
  if(req.method==='POST' && url.pathname==='/api/register'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(), name=String(p.name||'').trim(), password=String(p.password||'');
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return json(res,400,{error:'Username: латиница, цифры и _ — от 5 символов'});
    if(name.length<2 || name.length>32 || password.length<8) return json(res,400,{error:'Проверь имя и пароль'});
    const users=readUsers(); if(users.some(u=>u.username===username)) return json(res,409,{error:'Этот username уже занят'});
    const user={id:crypto.randomUUID(),name,username,password:hashPassword(password),avatar:'',bio:'',role:username===OWNER_USERNAME?'owner':'user',verified:username===OWNER_USERNAME,verifiedType:username===OWNER_USERNAME?'owner':null,createdAt:Date.now()}; users.push(user); writeUsers(users);
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,201,{token,user:publicUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase(); const user=readUsers().find(u=>u.username===username);
    if(!user || !passwordOk(String(p.password||''),user.password)) return json(res,401,{error:'Неверный username или пароль'});
    if(user.blocked) return json(res,403,{error:'Аккаунт заблокирован модератором'});
    if(user.username===OWNER_USERNAME && !user.role){user.role='owner';user.verified=true;user.verifiedType='owner';const all=readUsers();const saved=all.find(x=>x.id===user.id);Object.assign(saved,user);writeUsers(all)}
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,200,{token,user:publicUser(user)});
  }
  if(req.method==='GET' && url.pathname==='/api/users'){
    const me=authUser(req); if(!me) return json(res,401,{error:'Нужно войти'}); const q=(url.searchParams.get('q')||'').replace(/^@/,'').toLowerCase();
    const users=readUsers().filter(u=>u.id!==me.id && (!q || u.username.includes(q) || u.name.toLowerCase().includes(q))).slice(0,50).map(publicUser); return json(res,200,{users});
  }
  if(req.method==='GET' && url.pathname==='/api/me'){ const me=authUser(req); return me?json(res,200,{user:publicUser(me)}):json(res,401,{error:'Нужно войти'}); }
  if(req.method==='GET' && url.pathname==='/api/pinned') return json(res,200,{pinned:readSettings().pinned||''});
  if(req.method==='GET' && url.pathname==='/api/moderation/overview'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для модераторов'});
    audit(me,'view_overview'); const users=readUsers().map(publicUser), userMap=new Map(users.map(u=>[u.id,u]));
    const messages=readMessages().slice(-500).map(m=>({...m,fromUser:userMap.get(m.from)||null,toUser:userMap.get(m.to)||null}));
    return json(res,200,{users,messages,audit:readAudit().slice(-100).reverse(),settings:readSettings()});
  }
  if(req.method==='POST' && url.pathname==='/api/moderation/action'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для модераторов'}); const p=await body(req), action=String(p.action||'');
    const users=readUsers();
    if(['verify','block','unblock'].includes(action)){
      const target=users.find(u=>u.id===String(p.userId||'')); if(!target)return json(res,404,{error:'Пользователь не найден'});
      if(action==='verify'){target.verified=Boolean(p.value);target.verifiedType=target.verified?p.type==='channel'?'channel':p.type==='group'?'group':'user':null}
      if(action==='block')target.blocked=true;if(action==='unblock')target.blocked=false;writeUsers(users);audit(me,action,{userId:target.id,username:target.username,type:p.type||null});return json(res,200,{user:publicUser(target)});
    }
    if(action==='pin'){const settings=readSettings();settings.pinned=String(p.text||'').slice(0,300);writeSettings(settings);audit(me,'pin',{text:settings.pinned});return json(res,200,{settings})}
    return json(res,400,{error:'Неизвестное действие'});
  }
  if(req.method==='GET' && url.pathname==='/api/moderation/audit'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для модераторов'}); audit(me,'view_audit'); return json(res,200,{audit:readAudit().slice(-200).reverse()});
  }
  if(req.method==='GET' && url.pathname==='/api/conversations'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'});
    const messages=readMessages().filter(m=>m.from===me.id||m.to===me.id), ids=[...new Set(messages.map(m=>m.from===me.id?m.to:m.from))], users=readUsers();
    const conversations=ids.map(id=>{const user=users.find(u=>u.id===id),last=[...messages].reverse().find(m=>(m.from===me.id&&m.to===id)||(m.from===id&&m.to===me.id));return user?{user:publicUser(user),last}:null}).filter(Boolean).sort((a,b)=>b.last.createdAt-a.last.createdAt);
    return json(res,200,{conversations});
  }
  if(req.method==='GET' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const username=(url.searchParams.get('with')||'').replace(/^@/,'').toLowerCase(),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Пользователь не найден'}); const all=readMessages(); let changed=false; all.forEach(m=>{if(m.from===other.id&&m.to===me.id&&!m.readAt){m.readAt=Date.now();changed=true}}); if(changed)writeMessages(all);
    const messages=all.filter(m=>(m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)).slice(-300).map(m=>({...m,mine:m.from===me.id}));
    return json(res,200,{user:publicUser(other),messages});
  }
  if(req.method==='GET' && url.pathname==='/api/events'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const since=Number(url.searchParams.get('since')||0);
    let latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0);
    if(latest<=since){await waitForMessage(me.id);latest=readMessages().filter(m=>m.from===me.id||m.to===me.id).reduce((n,m)=>Math.max(n,m.createdAt),0)}
    return json(res,200,{changed:latest>since,cursor:latest});
  }
  if(req.method==='POST' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); if(me.blocked)return json(res,403,{error:'Аккаунт заблокирован'}); const p=await body(req),username=String(p.to||'').replace(/^@/,'').toLowerCase(),text=String(p.text||'').trim(),image=String(p.image||''),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Получатель не найден'}); if(other.blocked)return json(res,403,{error:'Получатель заблокирован'}); if((!text&&!image)||text.length>4000||image.length>3500000)return json(res,400,{error:'Сообщение пустое или файл слишком большой'});
    const messages=readMessages(),replyTo=String(p.replyTo||''); if(replyTo&&!messages.some(m=>m.id===replyTo&&((m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)))) return json(res,400,{error:'Неверный ответ'});
    const message={id:crypto.randomUUID(),from:me.id,to:other.id,text,image,viewOnce:Boolean(p.viewOnce&&image),replyTo:replyTo||null,createdAt:Date.now(),readAt:null};messages.push(message);writeMessages(messages);wakeUser(other.id);wakeUser(me.id);return json(res,201,{message:{...message,mine:true}});
  }
  if(req.method==='PATCH' && url.pathname==='/api/me'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),users=readUsers(),u=users.find(x=>x.id===me.id),username=String(p.username||u.username).replace(/^@/,'').toLowerCase();
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)||users.some(x=>x.id!==u.id&&x.username===username))return json(res,409,{error:'Username некорректен или занят'});
    u.name=String(p.name||u.name).slice(0,32);u.username=username;u.bio=String(p.bio||'').slice(0,100);if(Object.prototype.hasOwnProperty.call(p,'notifications'))u.notifications=p.notifications!==false;if(String(p.avatar||'').length<500000)u.avatar=p.avatar||u.avatar;writeUsers(users);return json(res,200,{user:publicUser(u)});
  }
  return json(res,404,{error:'Не найдено'});
}

http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try { if(url.pathname.startsWith('/api/')) return await api(req,res,url); } catch(e){ return json(res,500,{error:'Ошибка сервера'}); }
  const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''), file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file);let out=data;if(ext==='.html')out=Buffer.from(data.toString('utf8').replace('</body>','<script src="/features.js"></script></body>'));res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript':'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache','Expires':'0'});res.end(out)});
}).listen(PORT,'0.0.0.0',()=>console.log(`Пропал из Интернета: порт ${PORT}`));
