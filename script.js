const channels = [
  {name:'THE FIRST TAKE',handle:'@The_FirstTake',subs:11200000,growth:2.4,category:'音楽',color:'#e6b2a8',initial:'TF'},
  {name:'HikakinTV',handle:'@HikakinTV',subs:18900000,growth:1.8,category:'エンタメ',color:'#f2d469',initial:'HK'},
  {name:'東海オンエア',handle:'@TokaiOnAir',subs:7110000,growth:3.7,category:'エンタメ',color:'#b9d9ee',initial:'TO'},
  {name:'料理研究家リュウジのバズレシピ',handle:'@ryuji_foodlabo',subs:4890000,growth:4.2,category:'料理',color:'#efb7c5',initial:'り'},
  {name:"Kevin's English Room",handle:'@KevinsEnglishRoom',subs:2280000,growth:5.1,category:'ライフスタイル',color:'#c5e5bd',initial:'KE'},
  {name:'サワヤンゲームズ',handle:'@SAWAYAN-GAMES',subs:1920000,growth:1.2,category:'ゲーム',color:'#c7c0ee',initial:'SG'},
  {name:'中田敦彦のYouTube大学',handle:'@NKTofficial',subs:5680000,growth:2.9,category:'教育',color:'#f0c78e',initial:'中'},
  {name:'もちまる日記',handle:'@motimaru',subs:2160000,growth:1.6,category:'ペット',color:'#d4c2ad',initial:'も'},
  {name:'VAIENCE',handle:'@vaience',subs:1410000,growth:6.8,category:'サイエンス',color:'#a9d8d1',initial:'VA'},
  {name:'QuizKnock',handle:'@QuizKnock',subs:2350000,growth:2.2,category:'教育',color:'#a8c4e5',initial:'QK'},
  {name:'カジサック KAJISAC',handle:'@kajisac',subs:2470000,growth:1.5,category:'エンタメ',color:'#f1b29f',initial:'KA'},
  {name:'山澤 礼明【筋肉チャンネル】',handle:'@Yamasawa',subs:1290000,growth:3.1,category:'フィットネス',color:'#b9ddb1',initial:'山'}
];
const storedChannels = JSON.parse(localStorage.getItem('subscope-channels') || 'null');
if (storedChannels) channels.splice(0, channels.length, ...storedChannels);
let visibleCount = 7;
const yen = new Intl.NumberFormat('ja-JP');
const rows = document.querySelector('#channelRows');
const search = document.querySelector('#searchInput');
const sort = document.querySelector('#sortSelect');
const thumbnailImages = ['https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1511512578047-dfb367046420?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1542751371-adc38448a05e?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1531058020387-3be344556be6?w=100&h=100&fit=crop','https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop'];
function avatar(channel,index){return `<span class="avatar-image" style="background:${channel.color}"><img src="${channel.thumbnail || thumbnailImages[index % thumbnailImages.length]}" alt="${channel.name}のサムネイル" onerror="this.style.display='none'"><span>${channel.initial}</span></span>`}
function render(){
  const query = search.value.toLowerCase();
  const mode = sort.value;
  const filtered = channels.filter(c => `${c.name}${c.handle}${c.category}`.toLowerCase().includes(query));
  if(mode!=='manual') filtered.sort((a,b)=>mode==='name'?a.name.localeCompare(b.name,'ja'):mode==='growth'?b.growth-a.growth:b.subs-a.subs);
  rows.innerHTML = filtered.slice(0,visibleCount).map((c,index)=>`<div class="channel-row" draggable="true" data-channel="${c.handle}"><div class="drag-handle" aria-hidden="true">⋮⋮</div><div class="channel-info">${avatar(c,index)}<div><div class="channel-name">${c.name}</div><div class="channel-handle">${c.handle}</div></div></div><span class="number">${formatSubs(c.subs)}</span><span class="gain">+${c.growth.toFixed(1)}%</span><span class="category">${c.category}</span><span class="status">Tracking</span><button class="row-menu" aria-label="${c.name}のメニュー">•••</button></div>`).join('');
  rows.querySelectorAll('.channel-row').forEach(row=>{
    row.addEventListener('dragstart',()=>row.classList.add('dragging'));
    row.addEventListener('dragend',()=>{row.classList.remove('dragging');saveDraggedOrder()});
    row.addEventListener('dragover',event=>{event.preventDefault();const dragging=rows.querySelector('.dragging');if(dragging&&dragging!==row){const box=row.getBoundingClientRect();rows.insertBefore(dragging,event.clientY<box.top+box.height/2?row:row.nextSibling)}});
  });
  document.querySelector('#resultCount').textContent = `${filtered.length} channels`;
  document.querySelector('#loadMore').style.display = filtered.length > visibleCount ? 'block' : 'none';
}
function formatSubs(value){return yen.format(value)}
function updateMetrics(){const total=channels.reduce((sum,c)=>sum+c.subs,0);document.querySelector('#totalSubscribers').textContent=formatSubs(total);document.querySelector('#monthlyGrowth').textContent=`+${formatSubs(Math.round(total*.048))}`}
function saveDraggedOrder(){const order=[...rows.querySelectorAll('.channel-row')].map(row=>row.dataset.channel);const reordered=order.map(handle=>channels.find(channel=>channel.handle===handle)).filter(Boolean);channels.splice(0,reordered.length,...reordered);localStorage.setItem('subscope-channels',JSON.stringify(channels));toast('表示順を保存しました')}
function openModal(){document.querySelector('#modal').classList.add('open');document.querySelector('#channelInput').focus()}
function closeModal(){document.querySelector('#modal').classList.remove('open')}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
document.querySelector('#openAdd').onclick=openModal;document.querySelector('#openAddFromSidebar').onclick=openModal;document.querySelector('#closeModal').onclick=closeModal;document.querySelector('#cancelModal').onclick=closeModal;document.querySelector('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});search.addEventListener('input',render);sort.addEventListener('change',render);document.querySelector('#loadMore').onclick=()=>{visibleCount=channels.length;render()};document.querySelector('#dateButton').onclick=()=>toast('期間を変更する機能は準備中です');document.querySelectorAll('.nav-item').forEach(item=>item.onclick=()=>{document.querySelectorAll('.nav-item').forEach(nav=>nav.classList.remove('active'));item.classList.add('active');toast(`${item.textContent.trim()}ビューは準備中です`) });document.querySelector('#addForm').onsubmit=e=>{e.preventDefault();const value=document.querySelector('#channelInput').value.trim();if(value){toast(`${value} を追加しました`);document.querySelector('#addForm').reset();closeModal()}};
updateMetrics();render();
document.querySelector('#addForm').onsubmit=e=>{e.preventDefault();const value=document.querySelector('#channelInput').value.trim();if(value){const handle=value.match(/@[\w-]+/)?.[0] || value.split('/').filter(Boolean).pop() || value;const name=handle.replace(/^@/,'').replace(/[-_]/g,' ');channels.push({name,handle:`@${name.replace(/\s+/g,'')}`,subs:0,growth:0,category:'未分類',color:'#d2e7bd',initial:name.slice(0,2)});localStorage.setItem('subscope-channels',JSON.stringify(channels));visibleCount=channels.length;updateMetrics();render();toast(`${name} を追加しました`);document.querySelector('#addForm').reset();closeModal()}};
