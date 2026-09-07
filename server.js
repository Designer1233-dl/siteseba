const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const APP_BUILD = '18';
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const AUDIT_FILE = path.join(DATA_DIR, 'moderation-audit.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const COMMUNITIES_FILE = path.join(DATA_DIR, 'communities.json');
// The administrator is a separate account; normal user registration remains enabled.
const ADMIN_USERNAME = 'vsevolod67';
const ADMIN_NAME = 'Vsevolod67';
const ADMIN_PASSWORD = 'vsevolodprapal';
const waiters = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '[]');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '{}');
if (!fs.existsSync(COMMUNITIES_FILE)) fs.writeFileSync(COMMUNITIES_FILE, '[]');

const readUsers = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const writeUsers = users => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
const readMessages = () => { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; } };
const writeMessages = items => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(items, null, 2));
const readAudit = () => { try { return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch { return []; } };
const writeAudit = items => fs.writeFileSync(AUDIT_FILE, JSON.stringify(items.slice(-1000), null, 2));
const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } };
const writeSettings = value => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value, null, 2));
const readCommunities = () => { try { return JSON.parse(fs.readFileSync(COMMUNITIES_FILE, 'utf8')); } catch { return []; } };
const writeCommunities = items => fs.writeFileSync(COMMUNITIES_FILE, JSON.stringify(items, null, 2));
const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Expose-Headers':'X-App-Build'};
const withCors = headers => ({...corsHeaders,...headers});
const json = (res, code, value) => { res.writeHead(code, withCors({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-App-Build':APP_BUILD})); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve,reject) => { let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>5e6) reject(Error('too large')); }); req.on('end',()=>{ try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)} }); });
const hashPassword = password => { const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64); return `${salt.toString('hex')}:${hash.toString('hex')}`; };
const passwordOk = (password, saved) => { try { const [s,h]=saved.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(password,Buffer.from(s,'hex'),64)); } catch{return false} };
// Keep verification data consistent at the API boundary. The client renders the
// blue badge next to this username, so every user response must carry the same
// boolean/type pair (including search, dialogs, chat headers, and moderation).
const normalizedVerification = (value, fallback) => {
  const verified = Boolean(value);
  return { verified, verifiedType: verified ? (fallback || 'user') : null };
};
const publicUser = u => {
  const v = normalizedVerification(u.verified, u.verifiedType || (u.role === 'admin' ? 'admin' : 'user'));
  return {id:u.id,name:u.name,username:u.username,avatar:u.avatar||'',bio:u.bio||'',online:false,notifications:u.notifications!==false,role:u.role||'user',verified:v.verified,verifiedType:v.verifiedType,blocked:Boolean(u.blocked)};
};
const readSessions = () => { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8')); } catch { return {}; } };
const saveSession = (token,id) => { const all=readSessions(); all[token]={id,createdAt:Date.now()}; fs.writeFileSync(SESSIONS_FILE,JSON.stringify(all)); };
const authUser = req => { const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); const session=readSessions()[token]; return readUsers().find(u=>u.id===session?.id); };
const isModerator = u => Boolean(u && u.role === 'admin');
const publicCommunity = c => { const v=normalizedVerification(c.verified,c.verifiedType||c.type); return {id:c.id,type:c.type,name:c.name,username:c.username,description:c.description||'',avatar:c.avatar||'',ownerId:c.ownerId,memberCount:(c.members||[]).length,verified:v.verified,verifiedType:v.verifiedType,createdAt:c.createdAt}; };
const audit = (actor, action, details={}) => { const items=readAudit(); items.push({id:crypto.randomUUID(),actorId:actor.id,actorUsername:actor.username,action,details,createdAt:Date.now()}); writeAudit(items); };
const wakeUser = id => { const list=waiters.get(id)||[]; waiters.delete(id); list.forEach(fn=>fn()); };
const waitForMessage = id => new Promise(resolve => { const fn=()=>{clearTimeout(timer);resolve()}; const timer=setTimeout(()=>{const list=waiters.get(id)||[];waiters.set(id,list.filter(x=>x!==fn));resolve()},25000); waiters.set(id,[...(waiters.get(id)||[]),fn]); });
const latestActivityForUser = id => {
  const direct = readMessages().filter(m => m.from === id || m.to === id).reduce((n,m) => Math.max(n,m.createdAt || 0, m.readAt || 0), 0);
  const memberships = readCommunities().filter(c => (c.members || []).includes(id) || c.ownerId === id).map(c => c.id);
  return readMessages().filter(m => m.toType === 'community' && memberships.includes(m.to)).reduce((n,m) => Math.max(n,m.createdAt || 0, m.readAt || 0), direct);
};

// Provision the admin without touching ordinary accounts, messages, or sessions.
function ensureAdminAccount() {
  const users = readUsers();
  const current = users.find(u => u.username === ADMIN_USERNAME);
  const passwordValid = Boolean(current && passwordOk(ADMIN_PASSWORD, current.password));
  const admin = {
    id: current?.id || crypto.randomUUID(), name: ADMIN_NAME, username: ADMIN_USERNAME,
    password: passwordValid ? current.password : hashPassword(ADMIN_PASSWORD), avatar: current?.avatar || '', bio: current?.bio || '',
    role: 'admin', verified: true, verifiedType: 'admin', notifications: current?.notifications !== false,
    createdAt: current?.createdAt || Date.now()
  };
  const others = users.filter(u => u.username !== ADMIN_USERNAME);
  writeUsers([admin, ...others]);
}
ensureAdminAccount();

async function api(req,res,url){
  if(req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,build:APP_BUILD,features:['accounts','communities','messages','verification','read-receipts','view-once-media','admin-journal']});
  if(req.method==='POST' && url.pathname==='/api/register'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim(), name=String(p.name||'').trim(), password=String(p.password||'');
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)) return json(res,400,{error:'Username: латиница, цифры и _ — от 5 символов'});
    if(username===ADMIN_USERNAME) return json(res,409,{error:'Этот username зарезервирован'});
    if(name.length<2 || name.length>32 || password.length<8) return json(res,400,{error:'Проверь имя и пароль'});
    const users=readUsers(), communities=readCommunities();
    if(users.some(u=>u.username===username)||communities.some(c=>c.username===username)) return json(res,409,{error:'Этот username уже занят'});
    const user={id:crypto.randomUUID(),name,username,password:hashPassword(password),avatar:'',bio:'',role:'user',verified:false,verifiedType:null,createdAt:Date.now()}; users.push(user); writeUsers(users);
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,201,{token,user:publicUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login'){
    const p=await body(req), username=String(p.username||'').replace(/^@/,'').toLowerCase(); const user=readUsers().find(u=>u.username===username);
    if(!user || !passwordOk(String(p.password||''),user.password)) return json(res,401,{error:'Неверный username или пароль'});
    if(user.blocked) return json(res,403,{error:'Аккаунт заблокирован модератором'});
    if(user.username===ADMIN_USERNAME && user.role!=='admin'){user.role='admin';user.verified=true;user.verifiedType='admin';const all=readUsers();const saved=all.find(x=>x.id===user.id);Object.assign(saved,user);writeUsers(all)}
    const token=crypto.randomBytes(32).toString('hex'); saveSession(token,user.id); return json(res,200,{token,user:publicUser(user)});
  }
  if(req.method==='GET' && url.pathname==='/api/users'){
    const me=authUser(req); if(!me) return json(res,401,{error:'Нужно войти'}); const q=(url.searchParams.get('q')||'').replace(/^@/,'').toLowerCase();
    const users=readUsers().filter(u=>u.id!==me.id && (!q || u.username.includes(q) || u.name.toLowerCase().includes(q))).slice(0,50).map(publicUser);
    const communities=readCommunities().filter(c=>!q||c.username.includes(q)||c.name.toLowerCase().includes(q)).slice(0,50).map(publicCommunity);
    return json(res,200,{users,communities});
  }
  if(req.method==='GET' && url.pathname==='/api/communities'){
    const me=authUser(req); if(!me) return json(res,401,{error:'Нужно войти'}); const q=(url.searchParams.get('q')||'').replace(/^@/,'').toLowerCase();
    return json(res,200,{communities:readCommunities().filter(c=>!q||c.username.includes(q)||c.name.toLowerCase().includes(q)).map(publicCommunity).slice(0,50)});
  }
  if(req.method==='POST' && url.pathname==='/api/communities'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req), type=p.type==='channel'?'channel':'group', name=String(p.name||'').trim(), username=String(p.username||'').replace(/^@/,'').toLowerCase().trim();
    if(name.length<2||name.length>64||!/^[a-z][a-z0-9_]{4,31}$/.test(username))return json(res,400,{error:'Проверь название и username'});
    if(username===ADMIN_USERNAME||readUsers().some(u=>u.username===username)||readCommunities().some(c=>c.username===username))return json(res,409,{error:'Этот username уже занят'});
    const c={id:crypto.randomUUID(),type,name,username,description:String(p.description||'').slice(0,300),avatar:'',ownerId:me.id,members:[me.id],verified:false,createdAt:Date.now()}; const all=readCommunities(); all.push(c); writeCommunities(all); return json(res,201,{community:publicCommunity(c)});
  }
  const communityMatch=url.pathname.match(/^\/api\/communities\/([^/]+)(?:\/(join|messages))?$/);
  if(communityMatch){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const username=decodeURIComponent(communityMatch[1]).replace(/^@/,'').toLowerCase(), action=communityMatch[2], communities=readCommunities(), c=communities.find(x=>x.username===username);
    if(!c)return json(res,404,{error:'Канал или группа не найдены'});
    if(req.method==='POST'&&action==='join'){if(!c.members.includes(me.id))c.members.push(me.id);writeCommunities(communities);return json(res,200,{community:publicCommunity(c)})}
    if(req.method==='GET'&&!action)return json(res,200,{community:{...publicCommunity(c),isMember:c.members.includes(me.id)}});
    if(action==='messages'&&req.method==='GET'){const users=readUsers(),stored=readMessages();let changed=false;const authors=new Set();stored.forEach(m=>{if(m.toType==='community'&&m.to===c.id&&m.from!==me.id&&!m.readAt){m.readAt=Date.now();changed=true;authors.add(m.from)}});if(changed){writeMessages(stored);authors.forEach(wakeUser)}const all=stored.filter(m=>m.toType==='community'&&m.to===c.id).slice(-300).map(m=>{const mine=m.from===me.id,seen=Array.isArray(m.viewedBy)&&m.viewedBy.includes(me.id);return {...m,mine,image:(m.viewOnce&&!mine&&seen)?'':m.image,fromUser:publicUser(users.find(u=>u.id===m.from)||{id:m.from,name:'Удалённый пользователь',username:'deleted'})}});return json(res,200,{community:{...publicCommunity(c),isMember:c.members.includes(me.id)},messages:all})}
    if(action==='messages'&&req.method==='POST'){if(!c.members.includes(me.id)&&c.type==='group')return json(res,403,{error:'Сначала вступите в группу'});const p=await body(req),text=String(p.text||'').trim(),image=String(p.image||'');if((!text&&!image)||text.length>4000||image.length>3500000)return json(res,400,{error:'Сообщение пустое или файл слишком большой'});const messages=readMessages(),replyTo=String(p.replyTo||'');const m={id:crypto.randomUUID(),from:me.id,to:c.id,toType:'community',text,image,viewOnce:Boolean(p.viewOnce&&image),viewedBy:[],replyTo:replyTo||null,createdAt:Date.now(),readAt:null};messages.push(m);writeMessages(messages);c.members.forEach(wakeUser);return json(res,201,{message:{...m,mine:true}})}
  }
  if(req.method==='GET' && url.pathname==='/api/me'){ const me=authUser(req); return me?json(res,200,{user:publicUser(me)}):json(res,401,{error:'Нужно войти'}); }
  if(req.method==='GET' && url.pathname==='/api/pinned'){const settings=readSettings(),community=readCommunities().find(c=>c.username===settings.pinnedCommunity);return json(res,200,{pinned:settings.pinned||'',community:community?publicCommunity(community):null});}
  if(req.method==='GET' && url.pathname==='/api/moderation/overview'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для администратора'});
    audit(me,'view_overview'); const users=readUsers().map(publicUser), userMap=new Map(users.map(u=>[u.id,u]));
    const messages=readMessages().slice(-500).map(m=>({...m,fromUser:userMap.get(m.from)||null,toUser:userMap.get(m.to)||null}));
    return json(res,200,{users,communities:readCommunities().map(publicCommunity),messages,audit:readAudit().slice(-100).reverse(),settings:readSettings()});
  }
  if(req.method==='POST' && url.pathname==='/api/moderation/action'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для администратора'}); const p=await body(req), action=String(p.action||'');
    const users=readUsers();
    if(action==='verifyCommunity'){
      const communities=readCommunities(), communityUsername=String(p.username||p.communityUsername||'').replace(/^@/,'').toLowerCase(), target=communities.find(c=>c.id===String(p.communityId||'')||(communityUsername&&c.username===communityUsername)); if(!target)return json(res,404,{error:'Сообщество не найдено'});
      target.verified=Boolean(p.value); target.verifiedType=target.type; writeCommunities(communities); audit(me,'verify_community',{communityId:target.id,username:target.username}); return json(res,200,{community:publicCommunity(target)});
    }
    if(action==='pinCommunity'){
      const target=readCommunities().find(c=>c.id===String(p.communityId||'')); if(!target)return json(res,404,{error:'Сообщество не найдено'});
      const settings=readSettings(); settings.pinnedCommunity=target.username; writeSettings(settings); audit(me,'pin_community',{username:target.username}); return json(res,200,{settings});
    }
    if(['verify','block','unblock'].includes(action)){
      const username=String(p.username||'').replace(/^@/,'').toLowerCase(), target=users.find(u=>u.id===String(p.userId||'')||(username&&u.username===username)); if(!target)return json(res,404,{error:'Пользователь не найден'});
      if(action==='verify'){target.verified=Boolean(p.value);target.verifiedType=target.verified?p.type==='channel'?'channel':p.type==='group'?'group':'user':null}
      if(action==='block')target.blocked=true;if(action==='unblock')target.blocked=false;writeUsers(users);audit(me,action,{userId:target.id,username:target.username,type:p.type||null});return json(res,200,{user:publicUser(target)});
    }
    if(action==='pin'){const settings=readSettings();settings.pinned=String(p.text||'').slice(0,300);writeSettings(settings);audit(me,'pin',{text:settings.pinned});return json(res,200,{settings})}
    if(action==='reply'){
      const from=users.find(u=>u.id===String(p.fromUserId||'')), to=users.find(u=>u.username===String(p.to||'').replace(/^@/,'').toLowerCase()), text=String(p.text||'').trim();
      if(!from||!to||!text)return json(res,400,{error:'Нужны отправитель, получатель и текст'});
      const messages=readMessages(), replyTo=String(p.replyTo||''); const message={id:crypto.randomUUID(),from:from.id,to:to.id,text,image:'',viewOnce:false,replyTo:replyTo||null,createdAt:Date.now(),readAt:null,adminAuthored:true}; messages.push(message); writeMessages(messages); wakeUser(to.id); audit(me,'reply_as_user',{from:from.username,to:to.username,replyTo}); return json(res,201,{message});
    }
    return json(res,400,{error:'Неизвестное действие'});
  }
  if(req.method==='GET' && url.pathname==='/api/moderation/audit'){
    const me=authUser(req); if(!isModerator(me)) return json(res,403,{error:'Доступ только для администратора'}); audit(me,'view_audit'); return json(res,200,{audit:readAudit().slice(-200).reverse()});
  }
  if(req.method==='GET' && url.pathname==='/api/conversations'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'});
    const messages=readMessages().filter(m=>!m.toType&&(m.from===me.id||m.to===me.id)&&(String(m.text||'').trim()||m.image)), ids=[...new Set(messages.map(m=>m.from===me.id?m.to:m.from))], users=readUsers();
    const conversations=ids.map(id=>{const user=users.find(u=>u.id===id),last=[...messages].reverse().find(m=>(m.from===me.id&&m.to===id)||(m.from===id&&m.to===me.id));return user&&last?{user:publicUser(user),last}:null}).filter(Boolean).sort((a,b)=>b.last.createdAt-a.last.createdAt);
    const allMessages=readMessages(), communities=readCommunities().filter(c=>(c.members||[]).includes(me.id)||c.ownerId===me.id).map(c=>({community:publicCommunity(c),last:[...allMessages].reverse().find(m=>m.toType==='community'&&m.to===c.id)||null}));
    return json(res,200,{conversations,communities});
  }
  if(req.method==='GET' && url.pathname==='/api/unread'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const unread=readMessages().filter(m=>m.to===me.id&&!m.readAt); return json(res,200,{count:unread.length,messages:unread.slice(-20).map(m=>({...m,mine:false}))});
  }
  const viewMatch=url.pathname.match(/^\/api\/messages\/([^/]+)\/view$/);
  if(req.method==='POST' && viewMatch){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'});
    const id=decodeURIComponent(viewMatch[1]),messages=readMessages(),m=messages.find(x=>x.id===id);
    if(!m||!m.viewOnce||!m.image)return json(res,404,{error:'Фото не найдено'});
    if(m.toType==='community'){
      const c=readCommunities().find(x=>x.id===m.to), allowed=Boolean(c&&((c.members||[]).includes(me.id)||c.ownerId===me.id||m.from===me.id));
      if(!allowed)return json(res,403,{error:'Нет доступа'});
    } else if(!(m.from===me.id||m.to===me.id)) return json(res,403,{error:'Нет доступа'});
    if(m.from===me.id)return json(res,200,{ok:true,image:m.image,alreadyViewed:false});
    m.viewedBy=Array.isArray(m.viewedBy)?m.viewedBy:[];
    if(m.viewedBy.includes(me.id))return json(res,410,{error:'Фото уже открыто'});
    m.viewedBy.push(me.id); writeMessages(messages); wakeUser(m.from);
    return json(res,200,{ok:true,image:m.image,alreadyViewed:false});
  }
  if(req.method==='GET' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const username=(url.searchParams.get('with')||'').replace(/^@/,'').toLowerCase(),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Пользователь не найден'}); const all=readMessages(); let changed=false; all.forEach(m=>{if(m.from===other.id&&m.to===me.id&&!m.readAt){m.readAt=Date.now();changed=true}}); if(changed){writeMessages(all);wakeUser(other.id)}
    const messages=all.filter(m=>(m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)).slice(-300).map(m=>{const mine=m.from===me.id,seen=Array.isArray(m.viewedBy)&&m.viewedBy.includes(me.id);return {...m,mine,image:(m.viewOnce&&!mine&&seen)?'':m.image}});
    return json(res,200,{user:publicUser(other),messages});
  }
  if(req.method==='GET' && url.pathname==='/api/events'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const since=Number(url.searchParams.get('since')||0);
    let latest=latestActivityForUser(me.id);
    if(latest<=since){await waitForMessage(me.id);latest=latestActivityForUser(me.id)}
    return json(res,200,{changed:latest>since,cursor:latest});
  }
  if(req.method==='POST' && url.pathname==='/api/messages'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); if(me.blocked)return json(res,403,{error:'Аккаунт заблокирован'}); const p=await body(req),username=String(p.to||'').replace(/^@/,'').toLowerCase(),text=String(p.text||'').trim(),image=String(p.image||''),other=readUsers().find(u=>u.username===username);
    if(!other)return json(res,404,{error:'Получатель не найден'}); if(other.blocked)return json(res,403,{error:'Получатель заблокирован'}); if((!text&&!image)||text.length>4000||image.length>3500000)return json(res,400,{error:'Сообщение пустое или файл слишком большой'});
    const messages=readMessages(),replyTo=String(p.replyTo||''); if(replyTo&&!messages.some(m=>m.id===replyTo&&((m.from===me.id&&m.to===other.id)||(m.from===other.id&&m.to===me.id)))) return json(res,400,{error:'Неверный ответ'});
    const message={id:crypto.randomUUID(),from:me.id,to:other.id,text,image,viewOnce:Boolean(p.viewOnce&&image),viewedBy:[],replyTo:replyTo||null,createdAt:Date.now(),readAt:null};messages.push(message);writeMessages(messages);wakeUser(other.id);wakeUser(me.id);return json(res,201,{message:{...message,mine:true}});
  }
  if(req.method==='PATCH' && url.pathname==='/api/me'){
    const me=authUser(req); if(!me)return json(res,401,{error:'Нужно войти'}); const p=await body(req),users=readUsers(),u=users.find(x=>x.id===me.id),username=me.role==='admin'?ADMIN_USERNAME:String(p.username||u.username).replace(/^@/,'').toLowerCase();
    if(!/^[a-z][a-z0-9_]{4,31}$/.test(username)||users.some(x=>x.id!==u.id&&x.username===username))return json(res,409,{error:'Username некорректен или занят'});
    u.name=String(p.name||u.name).slice(0,32);u.username=username;u.bio=String(p.bio||'').slice(0,100);if(Object.prototype.hasOwnProperty.call(p,'notifications'))u.notifications=p.notifications!==false;if(String(p.avatar||'').length<500000)u.avatar=p.avatar||u.avatar;writeUsers(users);return json(res,200,{user:publicUser(u)});
  }
  return json(res,404,{error:'Не найдено'});
}

http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS') return res.writeHead(204, withCors({})).end();
  const url=new URL(req.url,'http://localhost');
  try { if(url.pathname.startsWith('/api/')) return await api(req,res,url); } catch(e){ return json(res,500,{error:'Ошибка сервера'}); }
  const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\/+/,''), file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep))return res.writeHead(403).end();
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404, withCors({}));return res.end('Not found')}const ext=path.extname(file).toLowerCase();let out=data;if(ext==='.html')out=Buffer.from(data.toString('utf8').replace('</body>','<script src="/features.js"></script></body>'));const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};res.writeHead(200,withCors({'Content-Type':types[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-store, no-cache, must-revalidate, max-age=0':'public, max-age=3600','Pragma':ext==='.html'?'no-cache':'','Expires':ext==='.html'?'0':''}));res.end(out)});
}).listen(PORT,'0.0.0.0',()=>console.log(`Пропал из Интернета: порт ${PORT}`));
