/* Descriptive accounting only: no sequence search or significance estimates. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimicryCountContext=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const caveat='Descriptive opportunity-normalized counts; not calibrated for amino-acid composition, motif frequency, low complexity or repeats. Not a p-value or q-value.';
  function count(value,name){
    if(!Number.isSafeInteger(value)||value<0)throw new Error(name+' must be a non-negative safe integer');
    return value;
  }
  function summarize(input){
    if(input.complete!==true)throw new Error('Complete evaluation is required; missing results cannot be counted as zero');
    const a=count(input.targetEligibleWindows,'targetEligibleWindows');
    const b=count(input.parentEligibleWindows,'parentEligibleWindows');
    // Supply permitted opportunities explicitly for exclusions such as self-pairs.
    const cartesian=BigInt(a)*BigInt(b);
    const possible=input.permittedWindowPairs===undefined?cartesian:BigInt(input.permittedWindowPairs);
    if(possible<0n||possible>cartesian)throw new Error('Invalid permitted window-pair count');
    const hits=count(input.distinctCoordinatePairs,'distinctCoordinatePairs');
    const ta=count(input.matchedTargetWindows,'matchedTargetWindows');
    const pb=count(input.matchedParentWindows,'matchedParentWindows');
    if(BigInt(hits)>possible||ta>a||pb>b||ta>hits||pb>hits)throw new Error('Matched counts exceed available opportunities');
    if((hits===0)!==(ta===0)||(hits===0)!==(pb===0))throw new Error('Inconsistent zero-hit counts');
    return {
      distinctCoordinatePairs:hits,possibleWindowPairs:possible.toString(),
      matchesPerMillionPossiblePairs:possible?hits/Number(possible)*1e6:null,
      matchedTargetWindows:ta,targetEligibleWindows:a,targetWindowFraction:a?ta/a:null,
      matchedParentWindows:pb,parentEligibleWindows:b,parentWindowFraction:b?pb/b:null,
      caveat
    };
  }
  return {summarize,caveat};
});
