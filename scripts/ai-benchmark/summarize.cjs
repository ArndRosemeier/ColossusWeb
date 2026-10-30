const fs=require('node:fs'),assert=require('node:assert/strict');
const files=process.argv.slice(2);assert.ok(files.length,'Pass raw comparison JSON files');
const data=files.map(file=>({file,...JSON.parse(fs.readFileSync(file,'utf8'))}));
const rows=data.flatMap(d=>d.results);assert.ok(rows.length);
for(const d of data)assert.match(d.harnessRevision,/^isolated-defender-v[23]/,'Contaminated controller protocol cannot support a strength claim');
const wins=rows.filter(r=>r.winner==='candidate').length,losses=rows.filter(r=>r.winner==='baseline').length,draws=rows.filter(r=>r.outcome==='draw').length;
const failures=rows.filter(r=>r.failure).length,unfinished=rows.length-wins-losses-draws;
assert.equal(failures,0);assert.equal(unfinished,0,'Report capped games separately; do not assign them points');
const strata=new Map();
for(const row of rows){const key=`${row.variant}:${row.profile}`,seeds=strata.get(key)||new Map(),pair=seeds.get(row.seed)||[];pair.push(row);seeds.set(row.seed,pair);strata.set(key,seeds);}
const paired=[...strata.values()].map(seeds=>[...seeds.values()].map(pair=>{assert.equal(pair.length,2);assert.deepEqual(pair.map(r=>r.candidateSeat).sort(),[0,1]);return pair.map(r=>r.winner==='candidate'?1:r.outcome==='draw'?.5:0);}));
let randomState=791983;const rng=()=>{randomState=(Math.imul(1664525,randomState)+1013904223)>>>0;return randomState/4294967296};
const samples=[];for(let i=0;i<10000;i++){let score=0,count=0;for(const stratum of paired)for(let j=0;j<stratum.length;j++){const pair=stratum[Math.floor(rng()*stratum.length)];score+=pair[0]+pair[1];count+=2;}samples.push(score/count*100);}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({games:rows.length,wins,losses,draws,unfinished,failures,tournamentScorePercent:(wins+.5*draws)*100/rows.length,approximate95PercentPairedBootstrapInterval:[samples[250],samples[9750]],method:'10000 stratified seed-pair bootstrap resamples; swapped seats remain paired. Diagnostic uncertainty for these seeds/profiles, not an Elo or universal variant claim.',sources:data.map(({file,candidateCommit,opponentCommit,engineCommit,harnessRevision})=>({file,candidateCommit,opponentCommit,engineCommit,harnessRevision}))},null,2));
