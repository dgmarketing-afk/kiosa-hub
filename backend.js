/* KIOSA Hub · connects the page to the Google Apps Script backend (Google Sheet + Drive).
   Provides the same small API the page used inside Claude: db, user, assets, downloads. */
(function(){
  const API=window.KIOSA_API;
  const TK="kiosa_token",NM="kiosa_name";
  const store=k=>{try{return localStorage.getItem(k)}catch{return null}};
  const save=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
  let token=store(TK);
  async function call(action,body={}){
    const r=await fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,token,...body})});
    const j=await r.json();
    if(j.error==="unauthorized"){save(TK,null);token=null;showLogin("Your session has ended. Please sign in again.");throw Object.assign(new Error("Please sign in again"),{code:"unauthorized"})}
    if(j.error)throw Object.assign(new Error(j.message||j.error),{code:j.error});
    return j;
  }
  /* ---------- login screen ---------- */
  let ready,readyResolve,resolved=false;ready=new Promise(r=>readyResolve=r);
  function showLogin(msg){
    let ov=document.getElementById("kLogin");
    if(!ov){ov=document.createElement("div");ov.id="kLogin";document.body.appendChild(ov)}
    ov.innerHTML=`<style>#kLogin[hidden]{display:none!important}#kLogin{position:fixed;inset:0;z-index:99;background:#F3F0E9;display:grid;place-items:center;padding:16px;font-family:Manrope,"IBM Plex Sans Thai",sans-serif}
      #kLogin form{background:#fff;border:1px solid #E6DFD1;border-radius:20px;padding:28px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px}
      #kLogin h1{font-family:Georgia,serif;font-weight:400;letter-spacing:.06em;margin:0;font-size:28px;color:#2A251E}
      #kLogin small{color:#7A7266;letter-spacing:.3em;font-size:9px;text-transform:uppercase}
      #kLogin label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#7A7266}
      #kLogin input{border:1px solid #E6DFD1;border-radius:10px;padding:11px 12px;font-size:16px}
      #kLogin button{background:#BFA77B;color:#fff;border:0;border-radius:999px;padding:12px;font-size:15px;font-weight:600;cursor:pointer}
      #kLogin .err{color:#B04A3C;font-size:13px;min-height:1em}</style>
      <form id="kForm"><div><h1>KIOSA</h1><small>Back office</small></div>
      <label>Password<input id="kP" type="password" autocomplete="current-password" required autofocus></label>
      <div class="err" id="kErr">${msg||""}</div><button id="kGo">Sign in</button></form>`;
    ov.hidden=false;
    document.getElementById("kForm").onsubmit=async e=>{e.preventDefault();const b=document.getElementById("kGo");b.disabled=true;b.textContent="Signing in…";
      try{const r=await fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"login",password:document.getElementById("kP").value})}).then(r=>r.json());
        if(r.token){token=r.token;save(TK,r.token);save(NM,r.name);if(resolved){location.reload();return}ov.hidden=true;resolved=true;readyResolve();addLogout()}
        else{document.getElementById("kErr").textContent=r.error==="inactive"?"This account is turned off.":"Wrong password.";b.disabled=false;b.textContent="Sign in"}}
      catch{document.getElementById("kErr").textContent="Can't reach the server. Check the internet connection.";b.disabled=false;b.textContent="Sign in"}};
  }
  function addLogout(){
    const nav=document.querySelector(".nav");if(!nav||document.getElementById("kOut"))return;
    const b=document.createElement("button");b.id="kOut";b.type="button";b.textContent="Sign out ("+(store(NM)||"")+")";
    b.onclick=()=>{save(TK,null);location.reload()};nav.appendChild(b);
  }
  /* ---------- data cache + live refresh ---------- */
  const cache={};let loaded=false;const subs={};
  const docsOf=c=>Object.entries(cache[c]||{}).map(([id,d])=>({id,data:()=>d}));
  const fire=c=>{(subs[c]||[]).forEach(f=>{try{f({docs:docsOf(c)})}catch(e){console.error(e)}});(subs["doc:"+c]||[]).forEach(f=>{})};
  const fireDoc=path=>{const [c,id]=path.split("/");(subs["doc:"+path]||[]).forEach(f=>{const d=cache[c]?.[id];f({exists:!!d,data:()=>d})})};
  async function refresh(){
    const j=await call("all");
    for(const c of Object.keys(j)){const before=JSON.stringify(cache[c]||{});cache[c]={};j[c].forEach(x=>cache[c][x.id]=x.data);
      if(!loaded||before!==JSON.stringify(cache[c])){fire(c);Object.keys(subs).filter(k=>k.startsWith("doc:"+c+"/")).forEach(k=>fireDoc(k.slice(4)))}}
    loaded=true;
  }
  let timer=null;
  function startPolling(){if(timer)return;timer=setInterval(()=>{if(!document.hidden&&token)refresh().catch(()=>{})},30000);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&token)refresh().catch(()=>{})})}
  let first=null;const firstLoad=()=>first||(first=refresh().then(startPolling));
  const local=(c,id,fn)=>{cache[c]=cache[c]||{};fn(cache[c]);fire(c);fireDoc(c+"/"+id)};
  const docRef=(c,id)=>({
    set:async d=>{const data=JSON.parse(JSON.stringify(d));local(c,id,m=>m[id]=data);try{await call("set",{collection:c,id,data})}catch(e){refresh().catch(()=>{});throw e}},
    update:async d=>{const data=JSON.parse(JSON.stringify(d));local(c,id,m=>{const n={...(m[id]||{}),...data};Object.keys(n).forEach(k=>{if(n[k]&&n[k].__delete__)delete n[k]});m[id]=n});try{await call("update",{collection:c,id,data})}catch(e){refresh().catch(()=>{});throw e}},
    delete:async()=>{local(c,id,m=>delete m[id]);try{await call("delete",{collection:c,id})}catch(e){refresh().catch(()=>{});throw e}},
    onSnapshot:(cb,err)=>{const k="doc:"+c+"/"+id;(subs[k]=subs[k]||[]).push(cb);firstLoad().then(()=>fireDoc(c+"/"+id)).catch(e=>err&&err(e));return()=>{}}
  });
  const db={
    collection:c=>({onSnapshot:(cb,err)=>{(subs[c]=subs[c]||[]).push(cb);firstLoad().then(()=>cb({docs:docsOf(c)})).catch(e=>err&&err({code:e.code||"network"}));return()=>{}},doc:id=>docRef(c,id)}),
    doc:path=>{const [c,id]=path.split("/");return docRef(c,id)}
  };
  /* ---------- files ---------- */
  const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(blob)});
  const assets={
    upload:async(blob,o={})=>{if(blob.size>20e6)throw Object.assign(new Error("too large"),{code:"too_large"});const r=await call("upload",{base64:await b64(blob),mime:o.type||blob.type,name:blob.name||("photo-"+Date.now()+".jpg"),folder:o.folder||"Photos"});return {id:r.id}},
    delete:async id=>call("deleteFile",{id})
  };
  const downloads={save:async({filename,data})=>{const blob=data instanceof Blob?data:new Blob([data]);const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);return {status:"saved"}}};
  /* photos: Drive files shared by link; old Claude ids (32 hex) keep the old path */
  window.KIOSA_PHOTO=id=>/^[0-9a-f]{32}$/.test(id)?"/_blob/"+id:`https://lh3.googleusercontent.com/d/${id}=w1600`;
  const dataUrlCache={};
  window.KIOSA={
    call,refresh,
    fileDataUrl:async id=>{if(dataUrlCache[id])return dataUrlCache[id];const r=await call("file",{id});return dataUrlCache[id]=`data:${r.mime};base64,${r.base64}`},
    /* brochure export: swap Drive image links for inline data so the PDF/PNG includes the photos */
    inlineImages:async host=>{const els=[...host.querySelectorAll("*")];const re=/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/;
      await Promise.all(els.map(async el=>{const bg=el.style.backgroundImage||"";const m=bg.match(re);if(m){try{el.style.backgroundImage=`url("${await KIOSA.fileDataUrl(m[1])}")`}catch{}}
        if(el.tagName==="IMG"){const m2=(el.getAttribute("src")||"").match(re);if(m2){try{el.src=await KIOSA.fileDataUrl(m2[1])}catch{}}}}))}
  };
  window.claude={use:async name=>{
    await ready;
    if(name==="db")return db;
    if(name==="user")return {canEdit:async()=>true,name:store(NM)};
    if(name==="assets")return assets;
    if(name==="downloads")return downloads;
    return null;
  }};
  if(!API||API.includes("PASTE")){document.addEventListener("DOMContentLoaded",()=>showLogin("Setup not finished: add the Apps Script URL to config.js."));return}
  if(token){resolved=true;readyResolve();document.addEventListener("DOMContentLoaded",addLogout)}
  else document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>showLogin()):showLogin();
})();
