/* Infinite Frames Curve Catalog. Browse indexed metadata first, load exact SVG
   only after the user selects a curve. No naming or artwork mutation here. */
(function(root){
"use strict";
root.IFOpenPathSearch=function(backend,onSelect){
  let closed=false,sequence=0,timer=null,loading=false,more=true,next=null,color=null,total=0;
  const PAGE=48;
  const layer=document.createElement("div");
  layer.setAttribute("role","dialog");
  layer.setAttribute("aria-modal","true");
  layer.setAttribute("aria-label","Explore curves");
  layer.style.cssText="position:fixed;inset:0;z-index:2147483640;background:rgba(2,3,7,.97);backdrop-filter:blur(16px);display:flex;flex-direction:column;align-items:center;padding:max(14px,env(safe-area-inset-top)) 10px max(18px,env(safe-area-inset-bottom));color:#edf0f6;font:13px Manrope,system-ui,sans-serif";
  const shell=document.createElement("div");
  shell.style.cssText="width:min(100%,540px);height:100%;min-height:0;display:flex;flex-direction:column;gap:9px";
  const header=document.createElement("div");
  header.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:9px";
  const title=document.createElement("div");
  title.textContent="EXPLORE CURVES";
  title.style.cssText="font:800 16px Syne,system-ui,sans-serif;letter-spacing:.09em";
  const close=document.createElement("button");
  close.textContent="Close";
  close.style.cssText="border:1px solid #59606c;border-radius:12px;background:#1d2027;color:#fff;padding:11px 15px;min-height:42px;font:inherit;cursor:pointer";
  function exit(){if(closed)return;closed=true;sequence++;clearTimeout(timer);document.removeEventListener("keydown",esc);layer.remove()}
  close.onclick=exit;header.append(title,close);
  const input=document.createElement("input");
  input.placeholder="Search names, artists or colors (optional)";
  input.setAttribute("aria-label","Search curves");
  input.autocomplete="off";
  input.style.cssText="width:100%;min-height:46px;border-radius:13px;padding:11px 14px;background:#12161f;color:#fff;border:1px solid #596271;font:14px Manrope,system-ui,sans-serif;outline:none";
  const paletteLabel=document.createElement("div");
  paletteLabel.textContent="BROWSE BY COLOR";
  paletteLabel.style.cssText="font:700 10px 'JetBrains Mono',monospace;letter-spacing:.12em;color:#9da8b9";
  const palette=document.createElement("div");
  palette.setAttribute("aria-label","Available curve colors");
  palette.style.cssText="display:flex;gap:9px;align-items:center;overflow-x:auto;overflow-y:hidden;flex:none;min-height:38px;padding:1px 0 5px;scrollbar-width:thin";
  const status=document.createElement("div");
  status.style.cssText="font:11px 'JetBrains Mono',monospace;color:#a2adbd;min-height:18px";
  const results=document.createElement("div");
  results.setAttribute("role","list");
  results.style.cssText="overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:7px;padding:1px 0 8px;overscroll-behavior:contain";
  const moreButton=document.createElement("button");
  moreButton.textContent="SHOW MORE CURVES";
  moreButton.style.cssText="border:1px solid #596778;border-radius:12px;background:#171f2c;color:#cceeff;padding:12px 14px;min-height:45px;font:700 11px 'JetBrains Mono',monospace;letter-spacing:.09em;cursor:pointer;display:none";
  const foot=document.createElement("div");
  foot.textContent="Colors and names are indexed. Original SVG detail loads only when you open a curve.";
  foot.style.cssText="font-size:10px;line-height:1.35;color:#7e8797;text-align:center";
  function esc(e){if(e.key==="Escape")exit()}
  function isColor(value){return /^#[a-f0-9]{6}$/i.test(value||"")}
  function row(hit){
    const button=document.createElement("button");
    button.setAttribute("role","listitem");
    button.setAttribute("aria-label","Open "+(hit.name||"Unnamed curve")+" in frame "+hit.frameN);
    button.style.cssText="display:flex;gap:12px;align-items:center;width:100%;min-height:63px;padding:9px 12px;text-align:left;border:1px solid #363f4b;border-radius:13px;background:#11171f;color:#f0f4fb;font:inherit;cursor:pointer;flex:none";
    const chip=document.createElement("span");
    const fill=isColor(hit.color)?hit.color:"#777";
    chip.style.cssText="display:block;flex:none;width:34px;height:34px;border-radius:10px;background:"+fill+";border:2px solid rgba(255,255,255,.7);box-shadow:0 0 0 1px rgba(0,0,0,.5)";
    const labels=document.createElement("div");
    labels.style.cssText="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px";
    const name=document.createElement("div");
    name.textContent=hit.name||"Unnamed curve";
    name.style.cssText="font-weight:750;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    const details=document.createElement("div");
    details.textContent="Frame "+(hit.frameN||1)+(hit.author?" · "+hit.author:"")+" · "+(isColor(hit.color)?hit.color.toUpperCase():"Color unknown");
    details.style.cssText="font:10px 'JetBrains Mono',monospace;color:#a6b1c1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    const arrow=document.createElement("span");
    arrow.textContent="⌕";
    arrow.style.cssText="font-size:23px;color:#9fdff5";
    labels.append(name,details);button.append(chip,labels,arrow);
    button.onclick=async()=>{
      if(closed)return;
      button.disabled=true;status.textContent="Retrieving exact SVG path…";
      try{
        const full=await backend.regionById(hit.id);
        if(!full||!full.d)throw Error("Exact curve path is unavailable");
        await onSelect(full);
        exit();
      }catch(e){button.disabled=false;if(!closed)status.textContent="Could not open curve: "+(e.message||e)}
    };
    return button;
  }
  const chips=[];
  function updatePalette(){
    for(const item of chips){
      const active=item.value===color;
      item.el.style.outline=active?"2px solid #d9f5ff":"none";
      item.el.style.outlineOffset="2px";
      item.el.setAttribute("aria-pressed",String(active));
    }
  }
  function addChip(value,label){
    const b=document.createElement("button"),valid=isColor(value);
    b.title=valid?"Show "+value.toUpperCase()+" curves":label;
    b.setAttribute("aria-label",valid?"Filter by "+value.toUpperCase():"Show all curve colors");
    b.style.cssText="display:grid;place-items:center;flex:none;height:32px;min-width:"+(valid?"32px":"62px")+";width:"+(valid?"32px":"auto")+";border-radius:"+(valid?"50%":"17px")+";border:1px solid #a1b0bd;background:"+(valid?value:"#232c3b")+";color:#fff;font-size:10px;font-weight:700;padding:0 9px;cursor:pointer";
    if(!valid)b.textContent=label;
    b.onclick=()=>{color=value;input.value="";updatePalette();loadBrowse(true)};
    chips.push({value,el:b});palette.appendChild(b);
  }
  async function loadBrowse(reset){
    if(closed)return;
    if(reset){sequence++;next=null;more=true;loading=false;total=0;results.replaceChildren();results.scrollTop=0}
    if(loading||!more)return;
    const ticket=sequence;loading=true;moreButton.style.display="none";
    status.textContent="Loading indexed curves…";
    try{
      const page=await backend.browseRegions({limit:PAGE,after:next,color});
      if(closed||ticket!==sequence||input.value.trim())return;
      for(const hit of page.items||[])results.appendChild(row(hit));
      total+=(page.items||[]).length;
      next=page.nextCursor;more=Boolean(page.hasMore);
      status.textContent=total?total+" curves shown"+(more?" · more available":" · end of catalog"):"No curves found"+(color?" in this color":" yet");
      moreButton.style.display=more?"block":"none";
    }catch(e){if(ticket===sequence&&!closed){status.textContent="Could not load catalog: "+(e.message||e);moreButton.style.display="block";moreButton.textContent="RETRY"}}
    finally{if(ticket===sequence)loading=false}
  }
  async function runSearch(){
    if(closed)return;
    const q=input.value.trim();if(!q){loadBrowse(true);return}
    const ticket=++sequence;loading=false;results.replaceChildren();moreButton.style.display="none";status.textContent="Searching metadata…";
    try{
      const hits=await backend.searchRegions(q,{limit:80});
      if(ticket!==sequence||closed)return;
      for(const hit of hits)results.appendChild(row(hit));
      status.textContent=hits.length?hits.length+" matching curves":"No matching curves. Try browsing colors instead.";
    }catch(e){if(ticket===sequence&&!closed)status.textContent="Search failed: "+(e.message||e)}
  }
  input.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(runSearch,160)});
  moreButton.onclick=()=>loadBrowse(false);
  document.addEventListener("keydown",esc);
  shell.append(header,input,paletteLabel,palette,status,results,moreButton,foot);
  layer.append(shell);document.body.append(layer);
  addChip(null,"ALL");
  updatePalette();
  backend.availableColors().then(colors=>{
    if(closed)return;
    for(const c of colors||[])if(isColor(c))addChip(c,null);
    updatePalette();
  }).catch(()=>{paletteLabel.textContent="BROWSE ALL CURVES"});
  loadBrowse(true);
  return exit;
};
})(typeof window!=="undefined"?window:globalThis);