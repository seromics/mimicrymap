/** Framework-neutral host API. Each instance owns an isolated native viewer. */
export function createViewer(element, options={}) {
  if (!(element instanceof Element)) throw new TypeError('Supply a container element.');
  const frame=document.createElement('iframe'), channel=crypto.randomUUID();
  const url=new URL(options.viewerUrl || './viewer/index.html',import.meta.url);
  url.hash=new URLSearchParams({channel,origin:location.origin});
  frame.title=options.title || 'MimicryMap Sequence Viewer';
  frame.style.cssText='display:block;border:0;width:100%;height:100%;min-height:440px';
  frame.setAttribute('allow','fullscreen');
  const pending=new Map(), events=new EventTarget();
  let nextId=0,disposed=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const timeout=setTimeout(()=>rejectReady(Error('MimicryMap viewer did not initialize. Check its URL and static assets.')),30000);
  function receive(event){
    if(event.source!==frame.contentWindow || event.origin!==url.origin || event.data?.channel!==channel)return;
    const data=event.data;
    if(data.event==='ready'){clearTimeout(timeout);resolveReady();return;}
    if(data.event){events.dispatchEvent(new CustomEvent(data.event,{detail:data.detail}));return;}
    const waiter=pending.get(data.id);if(!waiter)return;pending.delete(data.id);
    if(data.error){const error=Error(data.error.message);error.name=data.error.name;waiter.reject(error);}else waiter.resolve(data.value);
  }
  addEventListener('message',receive);
  frame.src=url.href;element.append(frame);
  async function call(method,value){
    await ready;if(disposed)throw new DOMException('Viewer destroyed','AbortError');
    return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});frame.contentWindow.postMessage({channel,id,method,value},url.origin);});
  }
  const api={ready,element:frame,
    compare:input=>call('compare',input),loadResult:result=>call('loadResult',result),getResult:()=>call('getResult'),
    cancel:()=>call('cancel'),setTracks:keys=>call('setTracks',keys),setView:view=>call('setView',view),
    selectWindow:start=>call('selectWindow',start),setTheme:theme=>call('setTheme',theme),export:kind=>call('export',kind),
    addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args),
    destroy(){if(disposed)return;disposed=true;clearTimeout(timeout);removeEventListener('message',receive);const error=new DOMException('Viewer destroyed','AbortError');rejectReady(error);for(const waiter of pending.values())waiter.reject(error);pending.clear();frame.remove();}
  };
  if(options.theme)ready.then(()=>api.setTheme(options.theme)).catch(()=>{});
  return api;
}
export default {createViewer};
