/* Four-column source ledger follows CAAtlas/SeroMap SourcesLicense.jsx. */
(function(){
 'use strict';
 const rows=[
  ['UniProt','https://www.uniprot.org/','See installed release','CC BY 4.0','https://www.uniprot.org/help/license/','The UniProt Consortium. Nucleic Acids Research 2023;51:D523–D531.','10.1093/nar/gkac1052','Swiss-Prot and TrEMBL sequences; subcellular location comments, HumSAVAR variants, modifications, topology and Allergome annotations.'],
  ['Gene Ontology (GO)','https://geneontology.org/',(/*@copy source-licenses.go-release*/`Retained GO annotations`/*@endcopy*/),'CC BY 4.0','https://www.geneontology.org/docs/go-citation-policy/','Ashburner et al. Nature Genetics 2000;25:25–29 (10.1038/75556). The Gene Ontology Consortium. The Gene Ontology knowledgebase in 2026. Nucleic Acids Research.','10.1093/nar/gkaf1292',(/*@copy source-licenses.go-role*/`Cellular-component annotations manually aligned by gene names and synonyms; used when UniProt provides no classifiable location.`/*@endcopy*/)],
  ['HORDB','http://hordb.cpu-bioinfor.org/','Retained peptide-hormone inputs','CC0 1.0','https://creativecommons.org/publicdomain/zero/1.0/','Zhu et al. HORDB a comprehensive database of peptide hormones. Scientific Data 2022;9:187.','10.1038/s41597-022-01287-5','Peptide hormone sequences and annotations.'],
  ['AlphaFold Protein Structure Database','https://alphafold.ebi.ac.uk/','Monomers: model_v6; retained quaternary models: MODEL_V1','CC BY 4.0','https://alphafold.ebi.ac.uk/assets/License-Disclaimer.pdf','Jumper et al. Nature 2021;596:583–589. Varadi et al. Nucleic Acids Research 2024;52:D368–D375.','10.1038/s41586-021-03819-2','Predicted structures and pLDDT. Database citation: 10.1093/nar/gkad1011.'],
  ['FreeSASA','https://freesasa.github.io/','Retained accessibility calculations','MIT (software)','https://freesasa.github.io/1.1/md_license.html','Mitternacht S. FreeSASA. F1000Research 2016;5:189.','10.12688/f1000research.7931.1','rSASA and Surface annotations. Dimer derivation uses relativeTotal; exposed at ≥0.25.'],
  ['pepsickle','https://github.com/pdxgx/pepsickle','0.1.3','MIT (software)','https://github.com/pdxgx/pepsickle/blob/master/LICENSE','pepsickle rapidly and accurately predicts proteasomal cleavage sites for improved neoantigen identification. Bioinformatics 2021;37:3723–3733.','10.1093/bioinformatics/btab628','Proteasomal-cleavage prediction tracks.'],
  ['Immune Epitope Database (IEDB)','https://www.iedb.org/',(/*@copy source-licenses.iedb-download-date*/`Downloaded September 1, 2026`/*@endcopy*/),'CC BY 4.0','https://discuss.iedb.org/t/iedb-coretrustseal-approved-application/205','Vita et al. The Immune Epitope Database: 2018 update. Nucleic Acids Research 2019;47:D339–D343.','10.1093/nar/gky1006',(/*@copy source-licenses.iedb-selection*/`Human-exposure positive protein antigens; Primates and non-protein entries excluded.`/*@endcopy*/)],
  [(/*@copy source-licenses.cdi-name*/`CDI Labs`/*@endcopy*/),'https://www.cdilabs.com/',(/*@copy source-licenses.cdi-release*/`HuProt 4.0; retained HuScan and full VirScan + Exposome content`/*@endcopy*/),(/*@copy source-licenses.cdi-license*/`Not specified`/*@endcopy*/),'',(/*@copy source-licenses.cdi-citation*/`CDI Labs: Library content`/*@endcopy*/),'',(/*@copy source-licenses.cdi-role*/`Antigen sequences and identifiers for HuScan, full VirScan with the Exposome add-on, and HuProt 4.0 assays run by CDI Labs.`/*@endcopy*/),'https://www.cdilabs.com/resources/literature?page=1&category=content',(/*@copy source-licenses.cdi-accessed*/`Accessed April 2026.`/*@endcopy*/)],
 ];
 const body=document.getElementById('sourceLicenseRows');if(!body)return;
 const link=(label,url)=>{const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 rows.forEach(([name,url,release,license,licenseUrl,citation,doi,note,citationUrl,accessed])=>{
  const tr=document.createElement('tr');
  [0,1,2,3].forEach(i=>{
   const td=document.createElement('td');
   if(i===0){td.append(url?link(name,url):document.createTextNode(name));const sub=document.createElement('div');sub.className='source-note';sub.textContent=note;td.append(sub);}
   if(i===1)td.textContent=release;
   if(i===2)td.append(licenseUrl?link(license,licenseUrl):document.createTextNode(license));
   if(i===3){if(citationUrl)td.append(link(citation,citationUrl));else td.textContent=citation;if(doi){td.append(document.createElement('br'),link(doi,'https://doi.org/'+doi));}if(accessed)td.append(document.createElement('br'),document.createTextNode(accessed));}
   tr.append(td);
  });body.append(tr);
 });
 const sourceData=window.MimicrySourceData || Promise.all(['/release-provenance.json','/api/analysis/meta'].map(async u=>{const r=await fetch(u,{cache:'no-cache'});if(!r.ok)throw Error();return r.json();}));
 sourceData.then(([provenance,meta])=>{
  if(!meta.component_releases?.some(c=>c.key==='canonical'&&c.release_fingerprint===provenance.release_fingerprint))return;
  body.rows[0].cells[1].textContent=(/*@copy source-licenses.reviewed-human-sequences-other-sequence.51edf1e*/`Reviewed Human sequences: ${provenance.human.uniprot_release} · ${provenance.human.uniprot_release_date}.`/*@endcopy*/);
 }).catch(()=>{});
})();
