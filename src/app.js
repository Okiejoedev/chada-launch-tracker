const TASKS = /*TASKS*/[];
const PEOPLE = [
  ["Joseph","Founder and tutor"],["Ope","Management"],["Godson","Management"],["Jemima","Sales"],
  ["Temi","Social media"],["Divine","Graphics"],["Idris","Graphics"],["Motun","Video"],
  ["Olamide","Video"],["Zara","Marketing"],["Victor","Marketing"]
];
const ROLE = Object.fromEntries(PEOPLE);
const DAYS = [...new Map(TASKS.map(t=>[t.day,t.label])).entries()].map(([day,label])=>({day,label}));
const BYID = Object.fromEntries(TASKS.map(t=>[t.id,t]));
const LABEL = {todo:"To do",done:"Done",blocked:"Blocked"};

// ---- state ----
const status = {};                 // id -> {s, note, by, at}
let sb = null, loaded = false, live = false, chanDown = false, pollTimer = null;
const inflight = {}, pending = {};
const store = {
  get(k){try{return localStorage.getItem(k)}catch(e){return null}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
let editor = null;
try{ editor = JSON.parse(store.get('ct-editor')||'null'); }catch(e){ editor=null; }
if(!editor || !editor.pin) editor = null;

const TODAY = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const VIEWS = ['day','blocked','progress'];
let view = (location.hash||'').replace('#',''); if(!VIEWS.includes(view)) view='day';
let selDay = DAYS.some(d=>d.day===TODAY) ? TODAY : (TODAY < DAYS[0].day ? DAYS[0].day : DAYS[DAYS.length-1].day);
let selPerson = store.get('ct-person') || 'all';
if(selPerson!=='all' && !ROLE[selPerson]) selPerson='all';

const st = id => (status[id] && status[id].s) || 'todo';
const $ = s => document.querySelector(s);
const el = (tag, attrs={}, ...kids) => {
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==='class') e.className=v; else if(k==='text') e.textContent=v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2),v);
    else if(k.startsWith('aria-')) e.setAttribute(k,String(v));
    else if(v!==false&&v!=null) e.setAttribute(k,v===true?'':v);
  }
  for(const k of kids) if(k!=null) e.append(k);
  return e;
};
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),2800);}
function setSync(cls,txt){const s=$('#sync');s.className='sync '+cls;s.querySelector('span').textContent=txt;}
function fmtTime(ms){
  if(!ms) return '';
  const d=new Date(ms);
  const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',weekday:'short',day:'numeric',month:'short'}).format(d);
  const tm=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'numeric',minute:'2-digit',hour12:true}).format(d).replace(' ','');
  const dk=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(d);
  return (dk===TODAY?'today':day)+' '+tm;
}
function fromRow(r){
  if(!r || !BYID[r.id] || !['todo','done','blocked'].includes(r.s)) return null;
  return {s:r.s, note:typeof r.note==='string'?r.note:'', by:typeof r.by_name==='string'?r.by_name:'', at:Date.parse(r.updated_at)||0};
}

// ---- editor unlock ----
let unlockThen = null;
function openUnlock(then){
  unlockThen = then || null;
  $('#uName').value = (editor && editor.name) || store.get('ct-lastname') || '';
  $('#uPin').value = '';
  $('#uErr').textContent = '';
  try{$('#unlock').showModal();}catch(e){$('#unlock').setAttribute('open','');}
  setTimeout(()=>($('#uName').value?$('#uPin'):$('#uName')).focus(),30);
}
function closeDlg(d){try{d.close()}catch(e){d.removeAttribute('open')}}
$('#unlockForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const name=$('#uName').value.trim().slice(0,40), pin=$('#uPin').value;
  if(!name){$('#uErr').textContent='Type your name so the team knows who updated it.';return;}
  if(!pin){$('#uErr').textContent='Type the editor passcode.';return;}
  if(!sb){$('#uErr').textContent="The tracker isn't connected yet.";return;}
  const btn=$('#uGo'); btn.disabled=true; btn.textContent='Checking…';
  try{
    const {data,error}=await sb.rpc('check_pin',{p_pin:pin});
    if(error) throw error;
    if(data!==true){$('#uErr').textContent="That passcode isn't right. Ask Joseph for it.";return;}
    editor={name,pin}; store.set('ct-editor',JSON.stringify(editor)); store.set('ct-lastname',name);
    closeDlg($('#unlock')); renderEditor(); toast(`You can now update statuses, ${name}.`);
    const f=unlockThen; unlockThen=null; if(f) f(); else render();
  }catch(err){ $('#uErr').textContent="Couldn't check the passcode. Check your internet and try again."; }
  finally{ btn.disabled=false; btn.textContent='Unlock'; }
});
$('#uCancel').addEventListener('click',()=>{unlockThen=null;closeDlg($('#unlock'));});
function lock(){ editor=null; store.del('ct-editor'); renderEditor(); render(); toast('Locked. Statuses are view only on this device.'); }
function renderEditor(){
  const box=$('#editor'); box.replaceChildren();
  if(editor){ box.append(el('span',{text:`Updating as ${editor.name}`}), el('button',{class:'link',onclick:lock},'Lock')); }
  else { box.append(el('span',{text:'View only'}), el('button',{class:'link',onclick:()=>openUnlock()},'Unlock to update')); }
}

// ---- writes: one at a time per task ----
function setStatus(id, patch){
  if(!sb){toast("The tracker isn't connected yet.");return;}
  if(!editor){openUnlock(()=>setStatus(id,patch));return;}
  const cur=status[id]||{s:'todo',note:''};
  const next={...cur,...patch,by:editor.name,at:Date.now()};
  if(next.s!=='blocked') next.note='';
  status[id]=next; render();
  if(inflight[id]){pending[id]=next;return;}
  flush(id,next);
}
async function flush(id, body){
  inflight[id]=true;
  while(body){
    const ok = await sendOne(id, body);
    if(!ok){ delete pending[id]; break; }
    body=pending[id]; delete pending[id];
  }
  inflight[id]=false;
}
async function sendOne(id, b, retried){
  try{
    const {data,error}=await sb.rpc('set_status',{p_id:id,p_s:b.s,p_note:b.note||'',p_by:b.by||'',p_pin:editor?editor.pin:''});
    if(error) throw error;
    const r=fromRow(data); if(r && !pending[id]) {status[id]=r; render();}
    return true;
  }catch(err){
    const msg=String((err&&err.message)||'');
    if(/passcode/i.test(msg)){
      editor=null; store.del('ct-editor'); renderEditor();
      await refetch();
      toast('The passcode has changed. Unlock again to save.');
      openUnlock(()=>setStatus(id,{s:b.s,note:b.note}));
      return false;
    }
    if(!retried){ await new Promise(r=>setTimeout(r,700+Math.random()*900)); return sendOne(id,b,true); }
    toast("Couldn't save that change. Check your internet and tap again.");
    await refetch();
    return false;
  }
}

// ---- reads ----
async function refetch(){
  if(!sb) return;
  const {data,error}=await sb.from('statuses').select('id,s,note,by_name,updated_at');
  if(error){ if(!loaded) setSync('err','Can’t load statuses'); return; }
  for(const k of Object.keys(status)) if(!inflight[k]) delete status[k];
  for(const row of data||[]){ const r=fromRow(row); if(r && !inflight[row.id]) status[row.id]=r; }
  loaded=true; if(!live && chanDown) setSync('warn','Refreshing every 30s'); render();
}
function subscribe(){
  sb.channel('statuses-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'statuses'},payload=>{
      const row=payload.new&&payload.new.id?payload.new:null;
      if(payload.eventType==='DELETE'){const id=payload.old&&payload.old.id;if(id&&!inflight[id]){delete status[id];render();}return;}
      const r=fromRow(row); if(r && !inflight[row.id]){status[row.id]=r; render();}
    })
    .subscribe(s=>{
      if(s==='SUBSCRIBED'){ live=true; chanDown=false; setSync('live','Live'); refetch(); }
      else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT'||s==='CLOSED'){ live=false; chanDown=true; if(loaded) setSync('warn','Refreshing every 30s'); }
    });
}

// ---- rendering ----
function counts(list){const c={todo:0,done:0,blocked:0};list.forEach(t=>c[st(t.id)]++);return c;}
function renderHeader(){
  const c=counts(TASKS);
  $('#sDone').textContent=c.done;$('#sBlocked').textContent=c.blocked;$('#sTodo').textContent=c.todo;
  $('#sTotal').textContent=TASKS.length;
  const pct=Math.round(c.done*100/TASKS.length);$('#sPct').textContent=pct+'%';$('#bar').style.width=pct+'%';
  const n=$('#tBlocked');n.hidden=!c.blocked;n.textContent=c.blocked;
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',String(t.dataset.view===view)));
}
function renderBars(){
  const dayBar=$('#dayBar');dayBar.replaceChildren();dayBar.hidden=view!=='day';
  for(const d of DAYS){
    const list=TASKS.filter(t=>t.day===d.day&&(selPerson==='all'||t.p===selPerson));
    if(!list.length) continue;
    const c=counts(list);
    dayBar.append(el('button',{class:'chip'+(d.day===TODAY?' today':''),'aria-pressed':d.day===selDay,onclick:()=>{selDay=d.day;render();}},
      d.label, el('small',{text:`${c.done}/${list.length} done${c.blocked?` · ${c.blocked} blocked`:''}`})));
  }
  const pb=$('#peopleBar');pb.replaceChildren();pb.hidden=view==='progress';
  const mk=(key,label)=>el('button',{class:'chip','aria-pressed':selPerson===key,onclick:()=>{
    selPerson=key;store.set('ct-person',key);
    if(!TASKS.some(t=>t.day===selDay&&(key==='all'||t.p===key))){
      const f=TASKS.find(t=>(key==='all'||t.p===key)&&t.day>=TODAY)||TASKS.find(t=>key==='all'||t.p===key); if(f) selDay=f.day;
    }
    render();}},label);
  pb.append(mk('all','Everyone')); PEOPLE.forEach(([p])=>pb.append(mk(p,p)));
  const on=dayBar.querySelector('[aria-pressed=true]');
  if(on&&!renderBars.scrolled&&!dayBar.hidden){on.scrollIntoView({inline:'center',block:'nearest'});renderBars.scrolled=true;}
}
function rowEl(t, showDay){
  const s=st(t.id), rec=status[t.id];
  const seg=el('div',{class:'seg'+(editor?'':' locked'),role:'group','aria-label':'Status'});
  for(const k of ['todo','done','blocked']){
    seg.append(el('button',{'data-s':k,'aria-pressed':s===k,onclick:()=>{
      if(st(t.id)!==k) setStatus(t.id,{s:k});
      if(k==='blocked') setTimeout(()=>{const i=document.querySelector(`[data-note="${t.id}"]`);if(i&&editor)i.focus();},60);
    }},LABEL[k]));
  }
  let meta=null;
  if(rec && rec.at && s!=='todo') meta=el('span',{class:'meta',text:`${LABEL[s]}${rec.by?' by '+rec.by:''} · ${fmtTime(rec.at)}`});
  const row=el('div',{class:'row'+(s==='done'?' is-done':'')},
    el('p',{class:'t'}, showDay?el('span',{class:'day',text:t.label+' · '+t.p}):null, t.t),
    el('div',{class:'ctrl'},seg,meta));
  if(s==='blocked'){
    const inp=el('input',{type:'text',placeholder:editor?"What's blocking it? (optional)":"No reason given",maxlength:'300','data-note':t.id,readonly:!editor,'aria-label':'Reason it is blocked'});
    inp.value=(rec&&rec.note)||'';
    const save=()=>{if(!editor)return;const v=inp.value.trim();if(v!==((status[t.id]||{}).note||''))setStatus(t.id,{s:'blocked',note:v});};
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}});
    inp.addEventListener('blur',save);
    row.append(el('div',{class:'note'},inp));
  }
  return row;
}
function groupEl(title, sub, rows){
  const g=el('section',{class:'group'},el('div',{class:'ghead'},el('b',{text:title}),el('span',{text:sub})));
  rows.forEach(r=>g.append(r)); return g;
}
function renderDay(v){
  const list=TASKS.filter(t=>t.day===selDay&&(selPerson==='all'||t.p===selPerson));
  const c=counts(list);
  const longDay=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(selDay+'T12:00:00Z'));
  v.append(el('div',{class:'toolbar'},
    el('div',{},el('div',{class:'eyebrow',text:selDay===TODAY?'Today':(selDay<TODAY?'Past day':'Coming up')}),el('h2',{text:`${longDay} · ${c.done}/${list.length} done`})),
    el('button',{class:'btn',onclick:()=>copySummary(selDay)},'Copy summary')));
  if(!list.length){v.append(el('div',{class:'empty',text:`${selPerson} has no tasks on this day.`}));return;}
  for(const [p,role] of PEOPLE){
    const items=list.filter(t=>t.p===p); if(!items.length) continue;
    const pc=counts(items);
    v.append(groupEl(p,`${role} · ${pc.done}/${items.length} done`,items.map(t=>rowEl(t,false))));
  }
}
function renderBlocked(v){
  const list=TASKS.filter(t=>st(t.id)==='blocked'&&(selPerson==='all'||t.p===selPerson));
  v.append(el('div',{class:'toolbar'},el('div',{},el('div',{class:'eyebrow',text:'Needs help'}),el('h2',{text:`${list.length} blocked`}))));
  if(!list.length){v.append(el('div',{class:'empty',text:'Nothing is blocked right now.'}));return;}
  v.append(groupEl('Blocked tasks','Unblock these first',list.map(t=>rowEl(t,true))));
}
function renderProgress(v){
  const upto=TODAY<DAYS[0].day?DAYS[0].day:TODAY;
  v.append(el('div',{class:'toolbar'},el('div',{},el('div',{class:'eyebrow',text:'Whole team'}),el('h2',{text:'Progress by person'}))));
  const tb=el('tbody');
  for(const [p,role] of PEOPLE){
    const all=TASKS.filter(t=>t.p===p), c=counts(all);
    const late=all.filter(t=>t.day<=upto&&st(t.id)!=='done').length;
    const pct=Math.round(c.done*100/all.length);
    tb.append(el('tr',{},
      el('td',{},el('b',{text:p}),el('span',{class:'tag',text:role})),
      el('td',{class:'num'},`${c.done}/${all.length}`),
      el('td',{class:'num'+(c.blocked?' red':'')},String(c.blocked)),
      el('td',{class:'num hide-s'+(late?' red':'')},String(late)),
      el('td',{},el('div',{class:'mini'},el('div',{style:`width:${pct}%`})))));
  }
  const c=counts(TASKS);
  tb.append(el('tr',{},el('td',{},el('b',{text:'Whole team'})),el('td',{class:'num'},el('b',{text:`${c.done}/${TASKS.length}`})),el('td',{class:'num'},String(c.blocked)),el('td',{class:'num hide-s'},''),el('td',{},el('div',{class:'mini'},el('div',{style:`width:${Math.round(c.done*100/TASKS.length)}%`})))));
  v.append(el('table',{},el('thead',{},el('tr',{},el('th',{text:'Person'}),el('th',{text:'Done'}),el('th',{text:'Blocked'}),el('th',{class:'hide-s',text:'Not done, due by today'}),el('th',{text:''}))),tb));
}
function render(){
  const a=document.activeElement, fid=a&&a.dataset&&a.dataset.note, fval=fid?a.value:null, fpos=fid?a.selectionStart:null;
  renderHeader(); renderBars();
  const v=$('#view'); v.replaceChildren();
  if(sb && !loaded) v.append(el('div',{class:'empty',text:'Loading statuses…'}));
  if(view==='day') renderDay(v); else if(view==='blocked') renderBlocked(v); else renderProgress(v);
  if(fid){const i=document.querySelector(`[data-note="${fid}"]`);if(i){i.value=fval;i.focus();try{i.setSelectionRange(fpos,fpos)}catch(e){}}}
}

// ---- WhatsApp summary ----
function copySummary(day){
  const d=DAYS.find(x=>x.day===day), list=TASKS.filter(t=>t.day===day), c=counts(list);
  let out=`*Chada Tech · ${d.label} Nov update*\n${c.done}/${list.length} done${c.blocked?`, ${c.blocked} blocked`:''}\n`;
  for(const [p] of PEOPLE){
    const items=list.filter(t=>t.p===p); if(!items.length) continue;
    out+=`\n*${p}*\n`;
    for(const t of items){const s=st(t.id);out+=`${s==='done'?'✅':s==='blocked'?'⛔':'⬜'} ${t.t}${s==='blocked'&&status[t.id].note?` (${status[t.id].note})`:''}\n`;}
  }
  $('#dlgText').value=out.trim();
  try{$('#dlg').showModal();}catch(e){$('#dlg').setAttribute('open','');}
}
$('#dlgCopy').addEventListener('click',async()=>{
  const ta=$('#dlgText');
  try{await navigator.clipboard.writeText(ta.value);toast('Copied. Paste it in the team group.');}
  catch(e){ta.focus();ta.select();try{document.execCommand('copy');toast('Copied. Paste it in the team group.');}catch(e2){toast('Select all and copy it.');}}
});
$('#dlgClose').addEventListener('click',()=>closeDlg($('#dlg')));

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{view=t.dataset.view;try{history.replaceState(null,'','#'+view)}catch(e){location.hash=view}render();}));
window.addEventListener('hashchange',()=>{const h=location.hash.replace('#','');if(VIEWS.includes(h)&&h!==view){view=h;render();}});

// ---- start ----
renderEditor(); render();
(function start(){
  const cfg=window.TRACKER_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabaseKey||!window.supabase){
    setSync('err','Not connected');
    $('#notice').append(el('div',{class:'notice',text:'The tracker database is not connected yet. Add the Supabase URL and key to config.js (see README).'}));
    return;
  }
  sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
  setSync('','Connecting…');
  const timer=setTimeout(()=>{if(!loaded)setSync('warn','Can’t reach the tracker yet');},10000);
  refetch().then(()=>{if(loaded)clearTimeout(timer);});
  subscribe();
  pollTimer=setInterval(()=>{ if(!live && document.visibilityState==='visible') refetch(); },30000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') refetch(); });
})();
