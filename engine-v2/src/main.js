import { createDemoWorld } from "./model.js";
import { Scene } from "./scene.js";
import { CanvasRenderer, viewRect } from "./renderer.js";

const $ = id => document.getElementById(id);
const canvas = $("world"), scene = new Scene(), renderer = new CanvasRenderer(canvas,scene);
const camera = { x:500, y:500, z:1.18 };
let visibleIds = [], selectedId = null, needQuery = false, queryRunning = false, scheduled = false, generation = 0;
let lastDraw = {drawn:0, ms:0}, lastQuery = {candidates:0,culledByLOD:0,queryMs:0};
const pointers = new Map();
let single=null, pinch=null, interacted=false, noticeTimer=null;
const format=n=>Number(n||0).toLocaleString("en-US");

function notice(message) {
  const node=$("notice");node.textContent=message;node.classList.add("show");
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>node.classList.remove("show"),2400);
}
function markInteraction() {
  if(!interacted){interacted=true;$("intro").style.opacity=".12"}
}
function invalidate(query=true) {
  if(query)needQuery=true;
  if(!scheduled){scheduled=true;requestAnimationFrame(draw)}
}
function draw() {
  scheduled=false;
  if(needQuery&&!queryRunning&&scene.ready){
    needQuery=false;queryRunning=true;
    const stamp=++generation, rect=viewRect(camera,renderer.cssWidth,renderer.cssHeight);
    const worldPerPixel=1100/camera.z/renderer.cssWidth;
    scene.query(rect,worldPerPixel).then(result=>{
      queryRunning=false;
      if(stamp===generation&&!result.stale){
        visibleIds=result.ids||[];
        lastQuery=result;
        updateMetrics();
        invalidate(false);
      }
      if(needQuery)invalidate(true);
    }).catch(error=>{queryRunning=false;notice("Spatial query failed: "+error.message)});
  }
  lastDraw=renderer.render(camera,visibleIds,selectedId);
  updateMetrics();
}
function updateMetrics(){
  $("m-total").textContent=format(scene.nodes.length);
  $("m-visible").textContent=format(lastQuery.candidates);
  $("m-drawn").textContent=format(lastDraw.drawn);
  $("m-ms").textContent=lastDraw.ms;
}
function point(ev) {
  const rect=canvas.getBoundingClientRect();
  return { x:ev.clientX-rect.left, y:ev.clientY-rect.top };
}
function clampZoom(z){return Math.max(1,Math.min(1e9,z))}
function zoomAt(z,x=renderer.cssWidth/2,y=renderer.cssHeight/2) {
  const before=renderer.screenToWorld(x,y,camera);
  camera.z=clampZoom(z);
  const after=renderer.screenToWorld(x,y,camera);
  camera.x+=before.x-after.x;camera.y+=before.y-after.y;
  invalidate();
}
function focus(node){
  if(!node)return;
  const fit=Math.min(renderer.cssWidth,renderer.cssHeight)/renderer.cssWidth;
  camera.x=node.x;camera.y=node.y;
  camera.z=clampZoom(1100*fit/Math.max(1e-8,node.r*2.8));
  markInteraction();invalidate();
}
function inspect(id) {
  selectedId=id;
  const panel=$("inspector");
  if(!id||!scene.byId.has(id)){panel.hidden=true;invalidate(false);return}
  const node=scene.byId.get(id);
  panel.hidden=false;
  $("region-name").textContent=node.name;
  $("region-author").textContent=node.author+" · closed SVG curve";
  $("region-depth").textContent=node.depth;
  $("region-children").textContent=format(scene.childCount(id));
  const ancestry=scene.lineage(id);
  $("region-lineage").textContent=format(ancestry.length);
  $("breadcrumb").textContent=ancestry.slice().reverse().map(x=>scene.byId.get(x)?.name||x).join(" / ");
  markInteraction();invalidate(false);
}
function hit(x,y){
  if(!scene.ready)return;
  const id=renderer.pick(x,y,camera,visibleIds);
  inspect(id);
  if(!id)notice("Tap a visible curve to inspect its related artwork");
}
function onPointerDown(event) {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  const p=point(event);
  pointers.set(event.pointerId,p);
  if(pointers.size===1){
    single={id:event.pointerId,last:p,start:p,moved:false};
    pinch=null;
  } else if(pointers.size===2) {
    const [a,b]=[...pointers.values()];
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    pinch={distance:Math.hypot(a.x-b.x,a.y-b.y)||1,zoom:camera.z,world:renderer.screenToWorld(mid.x,mid.y,camera)};
    single=null;
  }
}
function onPointerMove(event) {
  if(!pointers.has(event.pointerId))return;
  const p=point(event);
  pointers.set(event.pointerId,p);
  markInteraction();
  if(pointers.size===2&&pinch){
    const [a,b]=[...pointers.values()];
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const dist=Math.hypot(a.x-b.x,a.y-b.y);
    camera.z=clampZoom(pinch.zoom*dist/pinch.distance);
    const after=renderer.screenToWorld(mid.x,mid.y,camera);
    camera.x+=pinch.world.x-after.x;camera.y+=pinch.world.y-after.y;
    invalidate();return;
  }
  if(pointers.size===1&&single&&single.id===event.pointerId){
    if(Math.hypot(p.x-single.start.x,p.y-single.start.y)>5)single.moved=true;
    if(single.moved){
      const scale=renderer.scale(camera);
      camera.x-=(p.x-single.last.x)/scale;
      camera.y-=(p.y-single.last.y)/scale;
      invalidate();
    }
    single.last=p;
  }
}
function onPointerUp(event){
  if(!pointers.has(event.pointerId))return;
  const p=point(event);
  const tapped=pointers.size===1&&single&&single.id===event.pointerId&&!single.moved&&Math.hypot(p.x-single.start.x,p.y-single.start.y)<6;
  pointers.delete(event.pointerId);
  if(tapped)hit(p.x,p.y);
  if(pointers.size<2)pinch=null;
  if(pointers.size===1){
    const [id,last]=pointers.entries().next().value;
    single={id,last,start:last,moved:true};
  }else single=null;
}
canvas.addEventListener("pointerdown",onPointerDown);
canvas.addEventListener("pointermove",onPointerMove);
canvas.addEventListener("pointerup",onPointerUp);
canvas.addEventListener("pointercancel",onPointerUp);
canvas.addEventListener("wheel",event=>{
  event.preventDefault();markInteraction();
  const p=point(event);
  zoomAt(camera.z*Math.exp(-event.deltaY*.0013),p.x,p.y);
},{passive:false});
$("zoom-in").onclick=()=>zoomAt(camera.z*1.5);
$("zoom-out").onclick=()=>zoomAt(camera.z/1.5);
$("reset-view").onclick=$("fit-view").onclick=()=>{camera.x=500;camera.y=500;camera.z=1.18;inspect(null);invalidate()};
$("close-inspector").onclick=()=>inspect(null);
$("focus-region").onclick=()=>focus(scene.byId.get(selectedId));
$("sample-count").onchange=event=>loadWorld(+event.target.value);
function resize(){
  renderer.resize();
  invalidate();
}
window.addEventListener("resize",resize);
window.addEventListener("keydown",e=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
  if(e.key==="Escape")inspect(null);
  if(e.key==="+")zoomAt(camera.z*1.5);
  if(e.key==="-")zoomAt(camera.z/1.5);
});
async function loadWorld(count){
  $("mode-label").textContent="BUILDING SPATIAL INDEX…";
  scene.ready=false;visibleIds=[];selectedId=null;$("inspector").hidden=true;
  invalidate(false);
  const start=performance.now();
  try {
    const nodes=createDemoWorld(count);
    await scene.setWorld(nodes);
    $("mode-label").textContent=scene.workerMode?"WORKER INDEX ACTIVE":"MAIN-THREAD INDEX";
    notice(format(nodes.length)+" source curves indexed in "+Math.round(performance.now()-start)+" ms");
    needQuery=true;invalidate();
  } catch(error) {
    $("mode-label").textContent="ENGINE ERROR";
    notice(error.message||"Could not initialize geometry");
    console.error(error);
  }
}
renderer.resize();
loadWorld(14000);
