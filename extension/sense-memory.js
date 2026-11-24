(() => {
  const panel = document.getElementById('sense-memory');
  const list = panel.querySelector('div');
  const prefix = 'ss_sense_attempt:';
  const week = 7 * 86400000;
  const el = (tag,text) => Object.assign(document.createElement(tag), {textContent:text});
  const button = (text,action) => Object.assign(el('button',text),{type:'button',onclick:action});
  const clipKey = clip => clip[0]+'@'+clip[1];
  let drawing = 0;
  function fail(error) { list.textContent = 'Could not load practice. '+error.message; }
  async function sync() {
    const version = ++drawing;
    await SS_TRANSFER.ready;
    const keys = await chrome.storage.local.getKeys();
    const stored = await chrome.storage.local.get(keys.filter(k=>k.startsWith(prefix)||k.startsWith('ss_watched_scene:')||k.startsWith(SS_TRANSFER.prefix)||k.startsWith('ss_sense_source:')));
    const attempts = Object.entries(stored).filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);
    const seen = new Set(attempts.map(a=>a.video));
    for(const [k,rows] of Object.entries(stored)) if(k.startsWith('ss_watched_scene:') && Array.isArray(rows))
      for(const r of rows) if(r.videoKey) seen.add(r.videoKey.replace(/^yt:/,''));
    for (const [k,value] of Object.entries(stored)) {
      if (k.startsWith(SS_TRANSFER.prefix)) for (const video of [value.source,value.clip]) if(video)seen.add(video);
      if (k.startsWith('ss_sense_source:')) seen.add(value);
    }
    const from=new URLSearchParams(location.search).get('fromVideo');
    if(from && /^(yt:)?[\w-]{11}$/.test(from)){
      const video=from.replace(/^yt:/,'');
      if(!seen.has(video))await chrome.storage.local.set({['ss_sense_source:'+video]:video});
      seen.add(video);
    }
    const groups=[];
    for(const lesson of SS_TRANSFER.lessons.filter(l=>Array.isArray(l.practiceClips))){
      for(let i=0;i<lesson.choices.length;i++){
        const meaning=lesson.choices[i];
        const history=attempts.filter(a=>a.form===lesson.form && a.lang===lesson.lang && a.meaning===meaning)
          .sort((a,b)=>(b.at||b.opened)-(a.at||a.opened));
        const last=history.find(a=>a.result && a.result!=='familiar');
        const pending=history.find(a=>!a.result);
        const pool=[...lesson.clips,...lesson.practiceClips].filter(c=>(c[5]||0)===i);
        const clip=pending?pool.find(c=>clipKey(c)===pending.clip):pool.find(c=>!seen.has(c[0]));
        groups.push({lesson,meaning,history,last,pending,clip});
      }
    }
    if(version!==drawing)return;
    list.replaceChildren();
    const due=g=>g.last && Date.now()>=g.last.at+week;
    const priority=g=>g.pending?0:due(g)?({missed:1,hinted:2,unaided:3}[g.last.result]):g.last?5:4;
    groups.sort((a,b)=>priority(a)-priority(b)||(a.last?.at||0)-(b.last?.at||0));
    for(const g of groups){
      const {lesson,meaning,clip,pending,last}=g;
      const row=el('section','');
      row.append(el('h3',lesson.form));
      if(last) row.append(el('p',(due(g)?'Last attempt':meaning)+' · '+({missed:'missed',hinted:'recalled with a hint',unaided:'recalled on your own'}[last.result])));
      if(!pending && last && !due(g)){row.append(el('small','Next check '+new Date(last.at+week).toLocaleDateString()));list.append(row);continue;}
      if(!clip){row.append(el('small','Waiting for another reviewed clip for this meaning.'));list.append(row);continue;}
      const id=prefix+JSON.stringify([lesson.lang,lesson.form,clipKey(clip)]);
      const start=async()=>{
        const old=(await chrome.storage.local.get(id))[id];
        if(!old)await chrome.storage.local.set({[id]:{form:lesson.form,lang:lesson.lang,meaning,clip:clipKey(clip),video:clip[0],opened:Date.now(),hint:false}});
        await sync();
      };
      if(!pending){
        row.append(button(due(g)?'Take week-later quiz':'Try a scene',()=>start().catch(fail)));
      } else {
        // Hide the target sense and other cards before the learner answers.
        const question=el('section','');
        question.append(el('h3',lesson.form),el('blockquote',clip[3]));
        const link=el('a','Play scene');link.href='https://www.youtube.com/watch?v='+clip[0]+'&t='+clip[1]+'s';link.target='_blank';link.rel='noopener noreferrer';question.append(link);
        const update=async(patch)=>{
          await navigator.locks.request(id,async()=>{
            const current=(await chrome.storage.local.get(id))[id];
            if(!current || current.result)return;
            const change={...patch};
            if(change.result==='unaided' && current.hint)change.result='hinted';
            await chrome.storage.local.set({[id]:{...current,...change}});
          });
          await sync();
        };
        const hintText=clip[4] || 'Think back to the other scene where you studied this use.';
        if(pending.hint)question.append(el('p',hintText));
        else question.append(button('Give me a hint',()=>update({hint:true}).catch(fail)));
        const choices=lesson.choices.map((label,index)=>({label,index}));
        if((pending.opened%2)===1)choices.reverse();
        for(const {label,index} of choices)question.append(button(label,async()=>{
          const current=(await chrome.storage.local.get(id))[id];
          const correct=index===(clip[5]||0);
          await update({at:Date.now(),result:correct?(current.hint?'hinted':'unaided'):'missed',selected:label});
          panel.querySelector('[role=status]').textContent=(correct?'Correct':'The intended meaning was')+' · '+meaning;
        }));
        question.append(button('I’ve seen this clip',()=>update({result:'familiar',at:Date.now()}).catch(fail)));
        list.replaceChildren(question);panel.querySelector('[role=status]').textContent='';return;
      }
      list.append(row);
    }
  }
  panel.ontoggle=()=>{if(panel.open)sync().catch(fail);};
  if(location.hash==='#sense-memory')panel.open=true;
  setInterval(()=>{if(panel.open)sync().catch(fail);},60000);
})();
