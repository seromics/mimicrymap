/* Presentation timeline over retained coordinates. No search or result mutation. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimicryPreviewRace=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function build(candidates,options){
    const {metric,direction,targetLength,threshold}=options;
    const lastPosition=Math.max(0,targetLength-9);
    const series=candidates.map(candidate=>{
      const events=candidate.events.filter(h=>h[2]>=threshold).slice().sort((a,b)=>a[0]-b[0]);
      const points=[];
      // Parent coverage needs a bitmap, discarded after its sparse timeline is built.
      // Target intervals arrive in coordinate order and only need the latest end.
      const covered=metric==='parent'?new Uint8Array(candidate.length):null;
      let count=0,end=-1,best=null;
      for(let i=0;i<events.length;){
        const position=events[i][0];
        while(i<events.length&&events[i][0]===position){
          const hit=events[i++];
          if(metric==='target'){
            count+=Math.max(0,position+8-Math.max(end,position-1));
            end=Math.max(end,position+8);
          }else if(metric==='parent'){
            for(let p=hit[1]-1;p<hit[1]+8;p++)if(p>=0&&p<covered.length&&!covered[p]){covered[p]=1;count++;}
          }else{
            const value=metric==='core'?hit[2]:hit[3];
            if(value!=null&&Number.isFinite(value))best=Math.max(best??0,value);
          }
        }
        const score=metric==='target'?100*count/targetLength:metric==='parent'?100*count/candidate.length:best;
        points.push({position,score});
      }
      return points;
    });
    function valuesAt(position){
      return series.map((points,index)=>{
        let low=0,high=points.length;
        while(low<high){const mid=(low+high)>>1;if(points[mid].position<=position)low=mid+1;else high=mid;}
        return {index,seen:low>0,score:low?points[low-1].score:null};
      });
    }
    function orderAt(position){
      // Preserve canonical final ties, including the table's secondary measures.
      if(metric==='protein'||position>=lastPosition)return candidates.map((_,i)=>i);
      return valuesAt(position).filter(row=>row.seen).sort((a,b)=>{
        if(a.score==null||b.score==null)return (a.score==null)-(b.score==null)||a.index-b.index;
        return (direction==='asc'?a.score-b.score:b.score-a.score)||a.index-b.index;
      }).map(row=>row.index);
    }
    return {orderAt,valuesAt};
  }
  return {build};
});
