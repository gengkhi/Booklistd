// Shared mock helpers — Book Fair Saturday / Painted Bookcase
const INK = { t:'#E2462B', b:'#F4B41A', p:'#2F6FB0', g:'#3E9A5A', w:'#FFFFFF', m:'#7B3F6E', k:'#2B1D14', c:'#F3E0BE' };
const ON  = { t:'#fff', b:'#2B1D14', p:'#fff', g:'#fff', w:'#2B1D14', m:'#fff', k:'#F4B41A', c:'#2B1D14' };

function status(){ return '<div class="status"><span>9:41</span><span>●●● ▮</span></div>'; }

// mood: 'happy' | 'sleep' | 'gasp' | 'smug'
function dewey(mood='happy', size=64){
  const eyes = mood==='sleep'
    ? '<path d="M40 34h6M55 34h6" stroke="#2B1D14" stroke-width="2.5"/>'
    : mood==='smug'
      ? '<path d="M39 33h8M54 33h8" stroke="#2B1D14" stroke-width="3"/>'
      : '<circle cx="44" cy="34" r="2.2" fill="#2B1D14"/><circle cx="59" cy="34" r="2.2" fill="#2B1D14"/>';
  const mouth = mood==='gasp'
    ? '<ellipse cx="51" cy="46" rx="3.2" ry="4" fill="#2B1D14"/>'
    : '<path d="M46 45q5 3 10 0" stroke="#2B1D14" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
  return `<svg class="dewey" width="${size}" height="${size*0.95}" viewBox="0 0 74 70" aria-label="Dewey the bookworm">
    <g stroke="#2B1D14" stroke-width="2.5" fill="#3E9A5A"><circle cx="20" cy="56" r="11"/><circle cx="34" cy="50" r="12"/><circle cx="50" cy="36" r="17" fill="#6BBF7A"/></g>
    <g stroke="#2B1D14" stroke-width="2.5" fill="#fff"><circle cx="43" cy="33" r="6.5"/><circle cx="58" cy="33" r="6.5"/></g>
    <path d="M49.5 33h2" stroke="#2B1D14" stroke-width="2.5"/>${eyes}${mouth}
    <path d="M47 19q-2-8 4-11" stroke="#2B1D14" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function spine([t,c,w,h,x={}]){
  const lean = x.lean ? `transform:rotate(${-x.lean}deg);margin-left:10px;` : '';
  const out = x.ghost
    ? `border-style:dashed;background:transparent;`
    : `background-color:${INK[c]};color:${ON[c]};`;
  return `<div class="sp${x.dots?' dots':''}${x.cls?' '+x.cls:''}" style="width:${w}px;height:${h}px;${out}${lean}">
    ${t?`<span>${t}</span>`:''}${x.band?`<div class="band" style="background:${c==='b'?'#E2462B':'#F4B41A'}"></div>`:''}${x.inner||''}</div>`;
}

function stack(items, plant=true){
  const p = plant ? '<svg width="34" height="34" viewBox="0 0 34 34" stroke="#2B1D14" stroke-width="2"><path d="M9 22h16l-2 11H11z" fill="#E2462B"/><path d="M17 22c0-8-6-12-10-12 0 6 4 10 10 12zM17 22c0-10 6-15 11-15 0 7-5 13-11 15z" fill="#3E9A5A"/></svg>' : '';
  return `<div class="stack">${p}${items.map(([t,c,w])=>`<div class="ly" style="width:${w}px;background:${INK[c]};color:${ON[c]}">${t}</div>`).join('')}</div>`;
}

function tabs(active='Shelves'){
  const ic = {
    Shelves:'<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l3.5-1 3 14.5-3.5 1z"/>',
    Search:'<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
    Wishlist:'<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z"/>',
    Profile:'<circle cx="12" cy="9" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'
  };
  const t = n => `<div class="tab${n===active?' on':''}"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2">${ic[n]}</svg>${n}</div>`;
  return `<div class="tabs">${t('Shelves')}${t('Search')}<div class="tab"><div class="scanbtn"><svg width="28" height="28" fill="none" stroke="#2B1D14" stroke-width="2.6"><path d="M5 9V5h4M19 5h4v4M23 19v4h-4M9 23H5v-4M8 14h12"/></svg></div></div>${t('Wishlist')}${t('Profile')}</div>`;
}

// flat illustrated cover
function cover({title,author,c='p',w=150,h=222,motif='dune'}){
  const motifs = {
    dune:`<path d="M0 ${h*0.62} Q${w*0.3} ${h*0.5} ${w*0.55} ${h*0.6} T${w} ${h*0.55} V${h} H0Z" fill="#F4B41A" stroke="#2B1D14" stroke-width="2"/><path d="M0 ${h*0.74} Q${w*0.4} ${h*0.66} ${w} ${h*0.72} V${h} H0Z" fill="#E2462B" stroke="#2B1D14" stroke-width="2"/><circle cx="${w*0.72}" cy="${h*0.3}" r="${w*0.12}" fill="#FBFAF4" stroke="#2B1D14" stroke-width="2"/>`,
    sea:`<path d="M0 ${h*0.6} q${w/8} -10 ${w/4} 0 t${w/4} 0 t${w/4} 0 t${w/4} 0 V${h} H0Z" fill="#2F6FB0" stroke="#2B1D14" stroke-width="2"/><rect x="${w*0.4}" y="${h*0.25}" width="${w*0.2}" height="${h*0.35}" fill="#FBFAF4" stroke="#2B1D14" stroke-width="2"/>`,
    house:`<path d="M${w*0.2} ${h*0.62} V${h*0.4} L${w*0.5} ${h*0.24} L${w*0.8} ${h*0.4} V${h*0.62}Z" fill="#FBFAF4" stroke="#2B1D14" stroke-width="2"/><rect x="${w*0.44}" y="${h*0.48}" width="${w*0.12}" height="${h*0.14}" fill="#E2462B" stroke="#2B1D14" stroke-width="2"/>`
  };
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;border:2.5px solid #2B1D14;border-radius:3px 6px 6px 3px;background:${INK[c]}">
    ${motifs[motif]||''}
    <text x="12" y="30" font-family="Bagel Fat One" font-size="${w/6}" fill="${ON[c]}">${title}</text>
    <text x="12" y="${30+w/8}" font-family="Figtree" font-weight="800" font-size="${w/15}" fill="${ON[c]}">${author}</text>
    <rect x="0" y="0" width="7" height="${h}" fill="rgba(43,29,20,.22)"/>
  </svg>`;
}
