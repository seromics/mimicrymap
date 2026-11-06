// Loading belongs to a visible result area, independently of SVG size or zoom.
// Shared with the standalone/native MimicryMap player through prepare-assets.
const key=Symbol.for('seromap.loading-layout')
const state=globalThis[key]||(globalThis[key]={entries:new Map(),frame:0,observer:null,resize:null,observed:new Map()})
const paneSelector='[data-loading-area],.desktop-inspector-scroll,.desktop-analysis-scroll,.desktop-canvas-stack,.desktop-explorer,[data-loading-main]'
const clipped=/auto|scroll|hidden|clip/
const box=node=>{
  while(node&&(!node.getBoundingClientRect().width||getComputedStyle(node).display==='contents'))node=node.parentElement
  return node?.getBoundingClientRect()
}
function visible(node){
  return node.isConnected&&node.getClientRects().length&&!node.closest('[hidden]')&&
    (!node.parentElement||getComputedStyle(node.parentElement).visibility!=='hidden')
}
function bounds(node){
  const r=box(node)
  if(!r)return null
  const style=getComputedStyle(document.documentElement)
  let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right)
  let top=Math.max(parseFloat(style.getPropertyValue('--app-loading-top'))||0,r.top)
  let bottom=Math.min(innerHeight-(parseFloat(style.getPropertyValue('--app-loading-bottom'))||0),r.bottom)
  for(let p=node.parentElement;p;p=p.parentElement){
    const s=getComputedStyle(p),b=p.getBoundingClientRect()
    if(clipped.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.top+p.clientHeight)}
    if(clipped.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.left+p.clientWidth)}
  }
  return {left,right,top,bottom}
}
function layoutTop(node){
  let top=node.getBoundingClientRect().top+window.scrollY
  for(let p=node.parentElement;p&&p!==document.scrollingElement;p=p.parentElement)top+=p.scrollTop
  return Math.round(top)
}
function area(entry){
  const {node,scope}=entry,root=scope==='overlay'?node.parentElement:node
  const explicit=root.closest('[data-loading-area]')
  let pane=explicit||root.closest(paneSelector)
  if(scope==='panel')pane=explicit||root
  const local=scope==='panel'||explicit?.dataset.loadingArea==='panel'||!pane
  // Independent panels belong to their result box, not the viewport. Render
  // their indicator inside the loading element so scrolling and clipping are
  // handled by the browser without a detached, screen-fixed overlay.
  if(local){
    const owner=pane||root,r=box(owner),n=node.getBoundingClientRect()
    if(!r||!r.width||!r.height)return null
    return {owner,root,local:true,x:r.left+r.width/2-n.left,y:r.top+r.height/2-n.top,width:r.width}
  }
  const owner=pane||root,r=bounds(owner)
  if(!r)return null
  // A web surface can be shorter than the free space below its controls.
  if(!local&&owner.matches('[data-loading-main]')&&!owner.matches('.desktop-analysis-main')){
    r.bottom=innerHeight-(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-loading-bottom'))||0)
    for(let p=owner.parentElement;p;p=p.parentElement)if(clipped.test(getComputedStyle(p).overflowY))r.bottom=Math.min(r.bottom,p.getBoundingClientRect().top+p.clientHeight)
  }
  if(!local)r.top=Math.max(r.top,root.getBoundingClientRect().top)
  if(r.right<=r.left||r.bottom<=r.top)return null
  // Main result panes own a screen anchor independent of their figure's scroll
  // and zoom. Local panels above instead stay attached to their result box.
  const geometry=[innerWidth,innerHeight,owner.clientWidth,owner.clientHeight,layoutTop(owner),layoutTop(root)].join(':')
  if(entry.anchor?.owner===owner&&entry.anchor.geometry===geometry)return {owner,root,...entry.anchor.bounds}
  entry.anchor={owner,geometry,bounds:{...r}}
  return {owner,root,...r}
}
function update(){
  state.frame=0
  const active=[...state.entries.values()].filter(e=>visible(e.node))
  const pages=active.filter(e=>e.scope==='page')
  const page=pages.find(e=>e.node.closest('[data-surface-loading]'))||pages[0]
  const areas=new Map()
  if(!page)for(const entry of active){
    if(entry.scope==='page'||entry.scope==='inline')continue
    // An outer pending result owns its nested loaders.
    if(active.some(other=>other!==entry&&other.node.parentElement?.classList.contains('app-busy-region')&&other.node.parentElement.contains(entry.node)))continue
    const r=area(entry)
    if(!r)continue
    const prior=areas.get(r.owner)
    if(!prior||r.top<prior.area.top)areas.set(r.owner,{entry,area:r})
  }
  for(const entry of state.entries.values()){
    const selected=page?null:[...areas.values()].find(v=>v.entry===entry),r=selected?.area
    entry.onChange(page?entry===page?{page:true}:null:r?r.local?{local:true,x:r.x,y:r.y,width:r.width}:{x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,width:r.right-r.left}:null)
  }
}
function schedule(){if(!state.frame)state.frame=requestAnimationFrame(update)}
function start(){
  if(state.observer)return
  state.resize=new ResizeObserver(schedule)
  state.observer=new MutationObserver(records=>{
    if(records.some(r=>!r.target.closest?.('[data-loading-indicator]')&&!(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.matches('[data-loading-indicator]')))))schedule()
  })
  state.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style','aria-busy','data-player-state','data-structure-state']})
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true)
}
export function registerLoading(node,scope,onChange){
  start()
  state.entries.set(node,{node,scope,onChange})
  const observed=[]
  for(let p=node;p;p=p.parentElement){observed.push(p);state.observed.set(p,(state.observed.get(p)||0)+1);state.resize.observe(p)}
  schedule()
  const timer=setTimeout(schedule,180)
  return()=>{
    clearTimeout(timer);state.entries.delete(node)
    for(const p of observed){const n=state.observed.get(p)-1;if(n)state.observed.set(p,n);else{state.observed.delete(p);state.resize.unobserve(p)}}
    if(!state.entries.size){state.observer.disconnect();state.resize.disconnect();state.observer=null;state.resize=null;cancelAnimationFrame(state.frame);state.frame=0;window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true)}
    else schedule()
  }
}

// Native local panels retain their indicators; main results use a portal.
export function watchNativeLoading(root=document){
  const releases=new Map()
  const scan=()=>{
    for(const node of root.querySelectorAll('.sbox[data-structure-state="loading"]'))if(!node.querySelector('.structure-loading')){
      node.dataset.loadingArea='panel'
      const wait=document.createElement('div');wait.className='app-loading app-loading--overlay structure-loading';wait.setAttribute('role','status');wait.setAttribute('aria-label','Loading');node.append(wait)
    }
    for(const node of root.querySelectorAll('.structure-loading'))if(node.parentElement.dataset.structureState!=='loading')node.remove()
    for(const node of root.querySelectorAll('.app-loading:not([data-react-loading]):not([data-loading-indicator])')){
      if(releases.has(node)||!visible(node))continue
      const page=node.classList.contains('app-loading--page'),scope=page?'page':node.classList.contains('app-loading--overlay')?'overlay':'panel'
      let indicator
      const release=registerLoading(node,scope,position=>{
        if(page){node.toggleAttribute('data-loading-suppressed',!position);return}
        node.dataset.loadingManaged='true'
        if(!position){indicator?.remove();indicator=null;return}
        if(!indicator){indicator=document.createElement('div');indicator.dataset.loadingIndicator='';indicator.setAttribute('aria-hidden','true');indicator.innerHTML='<p class="app-loading-label">Loading<span class="app-loading-dots"><span>.</span><span>.</span><span>.</span></span></p>'}
        const container=position.local?node:document.body,classes=`app-loading-content ${position.local?'app-loading-local':'app-loading-floating'}`
        if(indicator.className!==classes)indicator.className=classes
        if(indicator.parentElement!==container)container.append(indicator)
        for(const [key,value] of Object.entries({left:position.x,top:position.y,maxWidth:position.width}))if(indicator.style[key]!==value+'px')indicator.style[key]=value+'px'
      })
      releases.set(node,()=>{release();indicator?.remove()})
    }
    for(const [node,release] of releases)if(!visible(node)){release();releases.delete(node)}
  }
  let frame=0
  const observer=new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('[data-loading-indicator]'))&&!frame)frame=requestAnimationFrame(()=>{frame=0;scan()})});observer.observe(root===document?document.documentElement:root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-structure-state','data-player-state','data-startup','data-atlas-native','hidden']});scan()
  return()=>{observer.disconnect();cancelAnimationFrame(frame);for(const release of releases.values())release()}
}
