(() => {
  const panel=document.getElementById('highlight-history'), list=panel.querySelector('ul');
  const box=panel.querySelector('input[type="checkbox"]'), search=panel.querySelector('input[type="search"]');
  let rows=[];
  const send=patch=>chrome.runtime.sendMessage({op:'highlightsManage',...patch});
  function draw(){
    const q=search.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    for(const row of rows.filter(r=>[r.term,r.context,r.title].some(t=>t.toLocaleLowerCase().includes(q)))){
      const li=document.createElement('li'), term=document.createElement('strong'), quote=document.createElement('p');
      term.textContent=row.term; quote.textContent=row.context!==row.term?row.context:'';
      const a=document.createElement('a');a.textContent=row.title;a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';
      const date=document.createElement('small');date.textContent=' · '+new Date(row.last).toLocaleDateString()+' · '+row.count+' lookup'+(row.count===1?'':'s')+' ';
      const remove=document.createElement('button');remove.textContent='Forget';remove.onclick=()=>update({action:'remove',id:row.id});
      li.append(term,quote,a,date,remove);list.append(li);
    }
    panel.querySelector('[role="status"]').textContent=list.children.length+' matching entries';
  }
  async function update(patch={}){const r=await send(patch);if(!r?.ok)return;rows=r.rows;box.checked=r.enabled;draw();}
  panel.ontoggle=()=>{if(panel.open)update();};search.oninput=draw;box.onchange=()=>update({enabled:box.checked});
  panel.querySelector('button').onclick=()=>{if(confirm('Forget all highlighted passages?'))update({action:'clear'});};
  chrome.storage.onChanged.addListener((delta,area)=>{if(panel.open && area==='local' && delta.ss_highlightHistory)update();});
  if(location.hash==='#highlight-history')panel.open=true;
})();
