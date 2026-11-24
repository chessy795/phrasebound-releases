(() => {
  const panel = document.getElementById('transfer-panel');
  const make = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
  const presented = new Map();
  function sourceLink(lesson, clip, label) {
    const timed = Number.isFinite(clip[1]);
    const link = make('a', timed ? label+' at '+Math.floor(clip[1]/60)+':'+String(clip[1]%60).padStart(2,'0') : label);
    const original = lesson.publisherPages?.[clip[0]];
    const href = !timed && original?.startsWith('https://hambaanglaang.hk/') ? original :
      'https://www.youtube.com/watch?v='+clip[0]+(timed ? '&t='+clip[1]+'s' : '');
    return Object.assign(link,{href,target:'_blank',rel:'noopener noreferrer'});
  }
  async function render() {
    await SS_TRANSFER.ready;
    const {lessons,key} = SS_TRANSFER;
    const scheduledKeys = chrome.storage.local.getKeys ?
      await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
    const rows = await chrome.storage.local.get(scheduledKeys.filter(id => id.startsWith(SS_TRANSFER.prefix)));
    const catalogue = new Map(lessons.map(lesson => [key(lesson),lesson]));
    for (const [id, row] of Object.entries(rows)) {
      if (row.lesson && key(row.lesson) === id) catalogue.set(id,row.lesson);
    }
    panel.replaceChildren();
    for (const lesson of catalogue.values()) {
      const id = key(lesson), row = rows[id];
      if (!row) {
        if (lesson.lang !== 'yue' || lesson.kind !== 'sense' || !lesson.publisherPages) continue;
        const details = make('details','');
        const study=lesson.clips[0];
        details.append(make('summary','Cantonese · '+lesson.form),make('blockquote',study[3]),
          make('p',study[4]),sourceLink(lesson,study,'Open publisher scene'));
        const enroll=make('button','Test me in a week');
        enroll.onclick=async()=>{await SS_TRANSFER.schedule(lesson,study);render();};
        details.append(enroll);panel.append(details);
        continue;
      }
      const section = make('section','');
      section.append(make('h3',lesson.form));
      panel.append(section);
      if (row.result) { section.append(make('p','Last new-clip review · '+row.result)); continue; }
      if (Date.now() < row.due) {
        section.append(make('p','New clip due ' + new Date(row.due).toLocaleDateString()));
        continue;
      }
      const patterns = lesson.form.includes(' / ') ? lesson.form.split(' / ') : [lesson.form];
      const histories = await Promise.all(patterns.map(pattern =>
        chrome.runtime.sendMessage({op:'getWatchedScenes',lang:lesson.lang,pattern,exclude:''})));
      if (!histories.every(reply => reply?.ok)) continue;
      const watched = histories.flatMap(reply => reply.rows);
      const clip = presented.get(id) || [...lesson.clips].reverse().find(c => c[0] !== row.source && !watched.some(r => r.videoKey === 'yt:'+c[0]));
      if (!clip) { section.append(make('p','Waiting for another unfamiliar clip.')); continue; }
      section.dataset.transferQuiz='true';
      presented.set(id,clip);
      const link=sourceLink(lesson,clip,clip[1]==null?'Open publisher story':'Play the new clip');
      section.append(link);
      if (lesson.kind==='sense') section.append(make('blockquote',clip[3]));
      section.append(make('p',lesson.kind === 'spelling' ? 'Listen first. Which spelling did the publisher use for '+lesson.reading+'?' : 'What does the expression mean in this clip?'));
      const choices = lesson.choices.map((text,i)=>({text,i}));
      for(let i=choices.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
      for(const choice of [...choices,{text:'I already knew this clip',i:-1}]){
        const button=make('button',choice.text);
        button.onclick=async()=>{
          for(const b of section.querySelectorAll('button')) b.disabled=true;
          const result=choice.i<0?'already seen':choice.i===(clip[5] || 0)?'correct':'incorrect';
          await chrome.storage.local.set({[id]:{...row,result,answeredAt:Date.now(),clip:clip[0]}});
          section.replaceChildren(make('p',result==='already seen'?'Excluded from your score.':result+' · '+lesson.choices[clip[5] || 0]));
        };
        section.append(button);
      }
    }
    panel.hidden=!panel.children.length;
  }
  render();
  window.addEventListener('focus',render);
  setInterval(() => { if (!panel.querySelector('[data-transfer-quiz]')) render(); },60000);
})();
