/* Infinite Frames Spatial Search UI. Searches IndexedDB metadata without
   retrieving the SVG data for every candidate. Full geometry loads on selection. */
(function(root){
"use strict";
root.IFOpenPathSearch=function(backend,onSelect){
  let closed=false,seq=0,timer=null;
  const layer=document.createElement("div");
  layer.setAttribute("role","dialog");layer.setAttribute("aria-modal","true");layer.setAttribute("aria-label","Find curves");
  layer.style.cssText="position:fixed;inset:0;z-index:2147483640;background:rgba(1,2,5,.95);backdrop-filter:blur(16px);display:flex;flex-direction:column;align-items:center;padding:max(22px,env(safe-area-inset-top)) 12px 24px;color:#ecedf2;font:13px Manrope,system-ui,sans-serif";
  const shell=document.createElement("div");shell.style.cssText="width:min(100%,540px);display:flex;flex-direction:column;gap:12px;max-height:100%";
  const row=document.createElement("div");row.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:9px";
  const title=document.createElement("div");title.textContent="FIND A CURVE";title.style.cssText="font:800 16px Syne,system-ui,sans-serif;letter-spacing:.12em";
  const close=document.createElement("button");close.textContent="Close";close.style.cssText="border:1px solid #59606c;border-radius:12px;background:#1d2027;color:#fff;padding:10px 14px;font:inherit";
  function exit(){if(closed)return;closed=true;clearTimeout(timer);document.removeEventListener("keydown",esc);layer.remove()}
  close.onclick=exit;
  row.append(title,close);
  const input=document.createElement("input");input.placeholder="Search by curve name, artist or #color";input.setAttribute("aria-label","Search curve metadata");input.autocomplete="off";input.style.cssText="width:100%;min-height:48px;border-radius:14px;padding:12px 15px;background:#13161d;color:#fff;border:1px solid #66717c;font:14px Manrope,system-ui,sans-serif;outline:none";
  const status=document.createElement("div");status.style.cssText="font-size:11px;color:#929dab;min-height:18px";
  const list=document.createElement("div");list.style.cssText="overflow:auto;flex:1;display:flex;flex-direction:column;gap:6px;min-height:0;padding-bottom:24px";
  function esc(e){if(e.key==="Escape")exit()}
  async function run(){
    const q=input.value.trim(),ticket=++seq;list.replaceChildren();
    if(!q){status.textContent="Enter a name, artist, or color to search the spatial index.";return}
    status.textContent="Searching indexed metadata…";
    try{
      const hits=await backend.searchRegions(q,{limit:40});if(closed||ticket!==seq)return;
      status.textContent=hits.length?hits.length+" matches · SVG geometry loads on selection":"No matching curves";
      for(const hit of hits){
        const btn=document.createElement("button");btn.style.cssText="display:flex;align-items:center;gap:12px;text-align:left;width:100%;min-height:51px;padding:9px 12px;border:1px solid #343c48;border-radius:12px;color:#f0f2f8;background:#151921;font:inherit;cursor:pointer";
        const swatch=document.createElement("span");swatch.style.cssText="display:block;flex:none;width:19px;height:19px;border-radius:7px;border:1px solid #a3a6ad;background:"+(hit.color&&/^#[a-f0-9]{6}$/i.test(hit.color)?hit.color:"#666");
        const label=document.createElement("div");label.style.cssText="flex:1;min-width:0";
        const name=document.createElement("div");name.style.cssText="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";name.textContent=hit.name||"Unnamed curve";
        const sub=document.createElement("div");sub.style.cssText="font-size:11px;color:#929dab";sub.textContent="Frame "+hit.frameN+(hit.author?" · "+hit.author:"");
        label.append(name,sub);
        btn.append(swatch,label);list.append(btn);
        btn.onclick=async()=>{
          btn.disabled=true;status.textContent="Retrieving exact SVG geometry…";
          try{const full=await backend.regionById(hit.id);if(!full)throw Error("Curve geometry is unavailable");exit();await onSelect(full)}
          catch(e){btn.disabled=false;status.textContent="Could not open: "+(e.message||e)}
        };
      }
    }catch(e){if(ticket===seq)status.textContent="Search failed: "+(e.message||e)}
  }
  input.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(run,170)});
  document.addEventListener("keydown",esc);
  shell.append(row,input,status,list);layer.append(shell);document.body.append(layer);input.focus();
  status.textContent="Search names, creators, and colors without loading all SVG paths.";
  return exit;
};
})(typeof window!=="undefined"?window:globalThis);