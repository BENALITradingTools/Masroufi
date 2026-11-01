/* مصروفي V1.3 — المحلل الصوتي ودوال النسخ الاحتياطي المحلية منقولة من V1.2 دون تغيير، ما عدا describeClause وupdateBackupStatus وbackupPayload. */
const DB_KEY='masroufi_db_v1', THEME_KEY='masroufi_theme', BACKUP_DB='masroufi_local_backups_v1';
const $=id=>document.getElementById(id);
const currencySymbols={DZD:'دج',EUR:'€',USD:'$'};
let db={transactions:[],recurring:[],currency:'DZD',backupInterval:1,budget:0};
let chart=null,trendChart=null,viewMonth=monthKey(),editingId=null,toastTimer=null;

/* ---------- Dates (local time, not UTC) ---------- */
function pad(n){return String(n).padStart(2,'0');}
function localDate(d=new Date()){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function monthKey(d=new Date()){return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function shiftMonth(key,delta){const [y,m]=key.split('-').map(Number);return monthKey(new Date(y,m-1+delta,1));}
function monthLabel(key,short=false){const [y,m]=key.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('ar-DZ',short?{month:'short'}:{month:'long',year:'numeric'});}
function daysInMonth(key){const [y,m]=key.split('-').map(Number);return new Date(y,m,0).getDate();}
function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}

/* ---------- Storage ---------- */
function load(){
  try{const x=JSON.parse(localStorage.getItem(DB_KEY)||'{}');db={...db,...x};}catch(e){toast('تعذر قراءة البيانات المحلية.');}
  db.transactions=Array.isArray(db.transactions)?db.transactions:[];
  db.recurring=Array.isArray(db.recurring)?db.recurring:[];
  db.backupInterval=[1,7,30].includes(Number(db.backupInterval))?Number(db.backupInterval):1;
  db.budget=Number(db.budget)>0?Number(db.budget):0;
  if(!currencySymbols[db.currency])db.currency='DZD';
}
function save(){try{localStorage.setItem(DB_KEY,JSON.stringify(db));maybeAutoBackup();}catch(e){toast('مساحة التخزين ممتلئة؛ نزّل نسخة احتياطية يدوية.');}}

function money(n){return new Intl.NumberFormat('ar-DZ',{maximumFractionDigits:2}).format(Number(n)||0)+' '+currencySymbols[db.currency];}
function dateText(d){return new Date(d+'T12:00:00').toLocaleDateString('ar-DZ',{year:'numeric',month:'short',day:'numeric'});}
function id(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---------- Toast (with optional action such as Undo) ---------- */
function toast(msg,opt={}){
  const t=$('toast');t.textContent='';
  const s=document.createElement('span');s.textContent=msg;t.appendChild(s);
  if(opt.action){const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=opt.action;b.addEventListener('click',()=>{hideToast();if(opt.onAction)opt.onAction();});t.appendChild(b);}
  t.classList.toggle('has-action',!!opt.action);t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(hideToast,opt.duration||(opt.action?6000:2800));
}
function hideToast(){$('toast').classList.remove('show');}

/* ---------- Calculations ---------- */
function monthTx(key){return db.transactions.filter(t=>t.date&&t.date.startsWith(key));}
function totals(list){let inc=0,exp=0;for(const t of list){if(t.type==='income')inc+=t.amount;else if(t.type==='expense')exp+=t.amount;}return{inc,exp};}
function sortNewest(a,b){return(b.date||'').localeCompare(a.date||'')||(b.createdAt||0)-(a.createdAt||0);}
function spendPct(){return db.budget>0?totals(monthTx(monthKey())).exp/db.budget*100:null;}
function budgetWarning(before,after){
  if(before===null||after===null)return '';
  if(before<100&&after>=100)return '⚠ تجاوزت ميزانية الشهر';
  if(before<80&&after>=80)return '⚠ بلغت 80% من ميزانية الشهر';
  return '';
}

/* ---------- Rendering ---------- */
function render(){
  const now=monthKey(),isNow=viewMonth===now,tx=monthTx(viewMonth),{inc,exp}=totals(tx);
  $('monthLabel').textContent=monthLabel(viewMonth);
  $('nextMonth').disabled=viewMonth>=now;
  $('balanceValue').textContent=money(inc-exp);$('incomeValue').textContent=money(inc);$('expenseValue').textContent=money(exp);
  const note=isNow?'خلال الشهر الحالي':'خلال '+monthLabel(viewMonth);
  $('incomeNote').textContent=note;$('expenseNote').textContent=note;
  $('periodPill').textContent=isNow?'هذا الشهر':monthLabel(viewMonth);
  $('todayLabel').textContent=new Date().toLocaleDateString('ar-DZ',{weekday:'long',day:'numeric',month:'long'});
  renderList('recentList',db.transactions.slice().sort(sortNewest).slice(0,5));
  renderTransactions();renderRecurring();renderReports();renderBudget();renderChart(tx);updateDescList();
  $('currencySelect').value=db.currency;
  if($('backupInterval'))$('backupInterval').value=String(db.backupInterval);
  updateBackupStatus();
}
function transactionRow(t){
  return `<div class="transaction-row"><div class="transaction-icon">${t.type==='income'?'↗':'↘'}</div><div class="transaction-info"><b>${escapeHtml(t.description)}</b><small>${dateText(t.date)}${t.recurringId?' · متكرر':''}</small></div><strong class="transaction-amount ${t.type}">${t.type==='income'?'+':'−'} ${money(t.amount)}</strong><button class="row-btn" data-edit="${escapeHtml(t.id)}" aria-label="تعديل">✎</button><button class="delete-button" data-delete="${escapeHtml(t.id)}" aria-label="حذف">×</button></div>`;
}
function renderList(target,items){$(target).innerHTML=items.length?items.map(transactionRow).join(''):'<div class="empty-state">لا توجد عمليات مسجلة بعد</div>';}
function filterTransactions(){
  const q=$('searchInput').value.trim().toLowerCase(),type=$('typeFilter').value,scope=$('scopeFilter').value,sort=$('sortFilter').value;
  const sorters={newest:sortNewest,oldest:(a,b)=>sortNewest(b,a),high:(a,b)=>b.amount-a.amount,low:(a,b)=>a.amount-b.amount};
  return db.transactions.filter(t=>(scope==='all'||(t.date&&t.date.startsWith(viewMonth)))&&(type==='all'||t.type===type)&&(!q||t.description.toLowerCase().includes(q))).sort(sorters[sort]||sortNewest);
}
function renderTransactions(){
  const list=filterTransactions(),{inc,exp}=totals(list);
  renderList('allTransactions',list);
  $('filterSummary').textContent=list.length?`${list.length} عملية · الدخل ${money(inc)} · المصاريف ${money(exp)}`:'';
}
const freqNames={daily:'يومياً',weekly:'أسبوعياً',monthly:'شهرياً',yearly:'سنوياً'};
function renderRecurring(){
  $('recurringList').innerHTML=db.recurring.length?db.recurring.map(r=>`<div class="transaction-row"><div class="transaction-icon">⟳</div><div class="transaction-info"><b>${escapeHtml(r.description)}</b><small>${freqNames[r.frequency]||''} · ${r.type==='income'?'دخل':'مصروف'} · التالية: ${dateText(r.nextDate)}</small></div><strong class="transaction-amount ${r.type}">${money(r.amount)}</strong><button class="delete-button" data-recurring-delete="${escapeHtml(r.id)}" aria-label="حذف">×</button></div>`).join(''):'<div class="empty-state">لا توجد عمليات متكررة</div>';
}
function renderBudget(){
  const box=$('budgetBody'),input=$('budgetInput'),b=db.budget;
  if(document.activeElement!==input)input.value=b||'';
  if(!b){box.innerHTML='<div class="empty-state">حدّد ميزانية شهرية لتتابع إنفاقك، وسيصلك تنبيه عند بلوغ 80% وعند التجاوز.</div>';return;}
  const {exp}=totals(monthTx(viewMonth)),pct=exp/b*100,state=pct>=100?'over':pct>=80?'warn':'ok',left=b-exp;
  const isNow=viewMonth===monthKey(),dim=daysInMonth(viewMonth),today=new Date().getDate(),daysLeft=dim-today+1;
  const stats=[['المصروف',money(exp)],[left>=0?'المتبقي':'تجاوز بمقدار',money(Math.abs(left))]];
  if(isNow&&left>0)stats.push(['المتاح يومياً',money(left/daysLeft)]);
  if(isNow&&exp>0)stats.push(['تقدير نهاية الشهر',money(exp/today*dim)]);
  box.innerHTML=`<div class="budget-head"><b>${pct.toFixed(0)}%</b><span>من ${money(b)}</span></div><div class="bar-track"><div class="bar-fill budget-${state}" style="width:${Math.min(100,pct)}%"></div></div><div class="budget-stats">${stats.map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>`;
}
function renderReports(){
  const tx=monthTx(viewMonth),{inc,exp}=totals(tx),expenses=tx.filter(t=>t.type==='expense');
  const days=viewMonth===monthKey()?new Date().getDate():daysInMonth(viewMonth);
  $('dailyAverage').textContent=money(exp/days);
  $('transactionCount').textContent=tx.length;
  const by={};expenses.forEach(t=>by[t.description]=(by[t.description]||0)+t.amount);
  const entries=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  $('topCategory').textContent=entries[0]?.[0]||'—';
  $('savingsRate').textContent=inc>0?Math.round((inc-exp)/inc*100)+'%':'—';
  const big=expenses.reduce((m,t)=>t.amount>(m?m.amount:0)?t:m,null);
  $('biggestExpense').textContent=big?money(big.amount):'—';$('biggestNote').textContent=big?big.description:'';
  const prev=totals(monthTx(shiftMonth(viewMonth,-1))).exp,vs=$('vsPrevious');
  if(prev>0){const ch=Math.round((exp-prev)/prev*100);vs.textContent=(ch>0?'+':'')+ch+'%';vs.className=ch>0?'expense-text':ch<0?'income-text':'';}else{vs.textContent='—';vs.className='';}
  $('categoryBreakdown').innerHTML=entries.length?entries.map(([name,val])=>{const p=exp?val/exp*100:0;return `<div class="category-item"><span>${escapeHtml(name)}</span><b>${money(val)} · ${p.toFixed(0)}%</b><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div></div>`;}).join(''):'<div class="empty-state">لا توجد مصاريف لتحليلها في هذا الشهر</div>';
  if($('reportsView').classList.contains('active'))renderTrend();
}
function chartScales(){const m=css('--muted'),g=css('--border');return{x:{grid:{display:false},ticks:{color:m}},y:{beginAtZero:true,grid:{color:g},ticks:{color:m}}};}
function renderChart(tx){
  if(!window.Chart){$('chartEmpty').textContent='تعذر تحميل مكتبة الرسم البياني؛ تحقق من الاتصال';return;}
  const {inc,exp}=totals(tx);$('chartEmpty').style.display=tx.length?'none':'grid';
  if(chart)chart.destroy();
  chart=new Chart($('overviewChart'),{type:'bar',data:{labels:['الدخل','المصاريف'],datasets:[{data:[inc,exp],backgroundColor:['#42c99a','#f07878'],borderRadius:9,maxBarThickness:55}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:chartScales()}});
}
function renderTrend(){
  if(!window.Chart)return;
  const keys=[-5,-4,-3,-2,-1,0].map(d=>shiftMonth(viewMonth,d)),data=keys.map(k=>totals(monthTx(k)));
  if(trendChart)trendChart.destroy();
  trendChart=new Chart($('trendChart'),{type:'bar',data:{labels:keys.map(k=>monthLabel(k,true)),datasets:[{label:'الدخل',data:data.map(d=>d.inc),backgroundColor:'#42c99a',borderRadius:6,maxBarThickness:26},{label:'المصاريف',data:data.map(d=>d.exp),backgroundColor:'#f07878',borderRadius:6,maxBarThickness:26}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:css('--muted')}}},scales:chartScales()}});
}
function updateDescList(){
  const count={};db.transactions.forEach(t=>count[t.description]=(count[t.description]||0)+1);
  $('descList').innerHTML=Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([d])=>`<option value="${escapeHtml(d)}">`).join('');
}

/* ---------- Add / edit modal ---------- */
function openModal(opts={}){
  const t=opts.tx;editingId=t?t.id:null;
  $('entryForm').reset();
  $('entryType').value=t?t.type:(opts.type||'expense');
  $('entryDescription').value=t?t.description:'';$('entryCategory').value=t?t.description:'';
  $('entryAmount').value=t?t.amount:'';$('entryDate').value=t?t.date:localDate();
  $('entryIsRecurring').checked=false;$('recurringOptions').hidden=true;
  $('entryIsRecurring').closest('label').hidden=!!t;
  $('entrySubmit').textContent=t?'حفظ التعديلات':'حفظ العملية';
  updateModalTitle();$('modal').hidden=false;$('entryDescription').focus();
}
function updateModalTitle(){$('modalTitle').textContent=editingId?'تعديل العملية':'إضافة '+($('entryType').value==='income'?'دخل':'مصروف');}
function closeModal(){$('modal').hidden=true;editingId=null;}
function pushTx(data){const t={id:id(),createdAt:Date.now(),...data,amount:Number(data.amount),category:data.description};db.transactions.push(t);return t;}
function addTransaction(data){const t=pushTx(data);save();render();return t;}
$('entryType').addEventListener('change',updateModalTitle);
$('entryDescription').addEventListener('input',e=>$('entryCategory').value=e.target.value);
$('entryIsRecurring').addEventListener('change',e=>$('recurringOptions').hidden=!e.target.checked);
$('entryForm').addEventListener('submit',e=>{
  e.preventDefault();
  const description=$('entryDescription').value.trim();
  const data={type:$('entryType').value,description,amount:Number($('entryAmount').value),date:$('entryDate').value,category:description};
  if(!data.description||!data.date||!(data.amount>0))return toast('تحقق من البيانات المدخلة');
  if(editingId){
    const t=db.transactions.find(x=>x.id===editingId);
    if(t)Object.assign(t,data);
    save();render();closeModal();toast('تم تعديل العملية');return;
  }
  if($('entryIsRecurring').checked){
    const freq=$('entryFrequency').value;
    db.recurring.push({id:id(),...data,frequency:freq,anchorDay:Number(data.date.slice(8,10)),nextDate:nextDate(data.date,freq,Number(data.date.slice(8,10)))});
  }
  const before=spendPct();addTransaction(data);const w=budgetWarning(before,spendPct());
  closeModal();toast('تم حفظ العملية بنجاح'+(w?' · '+w:''));
});
function deleteTransaction(txId){
  const i=db.transactions.findIndex(t=>t.id===txId);if(i<0)return;
  const [removed]=db.transactions.splice(i,1);save();render();
  toast('تم حذف العملية',{action:'تراجع',onAction:()=>{db.transactions.push(removed);save();render();toast('تمت استعادة العملية');}});
}

/* ---------- Recurring ---------- */
function nextDate(date,freq,anchor){
  const d=new Date(date+'T12:00:00'),day=anchor||d.getDate();
  if(freq==='daily')d.setDate(d.getDate()+1);
  else if(freq==='weekly')d.setDate(d.getDate()+7);
  else if(freq==='monthly'){d.setDate(1);d.setMonth(d.getMonth()+1);d.setDate(Math.min(day,daysInMonth(monthKey(d))));}
  else if(freq==='yearly'){const m=d.getMonth();d.setDate(1);d.setFullYear(d.getFullYear()+1);d.setMonth(m);d.setDate(Math.min(day,daysInMonth(monthKey(d))));}
  return localDate(d);
}
function processRecurring(){
  const today=localDate();
  db.recurring.forEach(r=>{let guard=0;while(r.nextDate<=today&&guard++<500){
    const exists=db.transactions.some(t=>t.recurringId===r.id&&t.date===r.nextDate);
    if(!exists)db.transactions.push({id:id(),createdAt:Date.now(),type:r.type,description:r.description,category:r.description,amount:r.amount,date:r.nextDate,recurringId:r.id});
    r.nextDate=nextDate(r.nextDate,r.frequency,r.anchorDay);
  }});
  save();
}

/* ---------- Voice parser (V1.2, unchanged except describeClause) ---------- */
const numberWords={'صفر':0,'واحد':1,'واحدة':1,'وحدة':1,'اثنين':2,'إثنين':2,'اثنان':2,'زوج':2,'ثلاثة':3,'ثلاث':3,'أربعة':4,'اربعة':4,'أربع':4,'خمسة':5,'خمس':5,'ستة':6,'ست':6,'سبعة':7,'سبع':7,'ثمانية':8,'ثمان':8,'تسعة':9,'تسع':9,'عشرة':10,'عشر':10,'أحد عشر':11,'اثنا عشر':12,'ثلاثة عشر':13,'أربعة عشر':14,'خمسة عشر':15,'عشرين':20,'عشرون':20,'ثلاثين':30,'أربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تسعين':90,'مية':100,'مئة':100,'مائة':100,'مئتين':200,'ميتين':200,'ثلاثمية':300,'ربعمية':400,'خمسمية':500,'ستمية':600,'سبعمية':700,'ثمانمية':800,'تسعمية':900};
function spokenNumber(text){const digitMatch=text.match(/(?:\d[\d.,٬٫]*)/);if(digitMatch)return Number(digitMatch[0].replace(/[٬,]/g,'').replace('٫','.'));const words=text.toLowerCase().replace(/[،,.!?]/g,' ').split(/\s+/);let total=0,group=0,found=false;for(let i=0;i<words.length;i++){let w=words[i];if(w==='و'&&i+1<words.length)continue;if(numberWords[w]!==undefined){group+=numberWords[w];found=true;continue;}if(['ألفين','الفين'].includes(w)){total+=(group||1)*2000;group=0;found=true;continue;}if(['ألف','الف','آلاف'].includes(w)){total+=group?group*1000:1000;group=0;found=true;continue;}if(['مليون','مليونين','ملايين'].includes(w)){total+=group?group*1000000:(w==='مليونين'?2000000:1000000);group=0;found=true;continue;}}return found?total+group:null;}
function normalizeSpeech(s){return s.replace(/[إأآ]/g,'ا').replace(/[ًٌٍَُِّْ]/g,'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,'');}
function amountFromClause(clause){const m=clause.match(/(?:\d[\d.,]*)/);if(m)return Number(m[0].replace(/[.,](?=\d{3}(?:\D|$))/g,'').replace(',','.'));return spokenNumber(clause);}
function inferType(clause,lastType){const income=/(دخلتلي|دخل لي|دخل|ربحت|قبضت|استلمت|راتب|مدخول|باع|بعت|مداخيل|تحصلت على)/.test(clause);const expense=/(صرف|صرفت|خلصت|دفعت|شريت|اشتريت|شراء|كلفني|مصاريف|مصروف|استهلكت)/.test(clause);if(income&&expense)return null;if(income)return'income';if(expense)return'expense';return lastType;}
function parseVoiceBatch(raw){const text=normalizeSpeech(raw).replace(/[؛;]/g,'،');const chunks=text.split(/،|\s+و(?=\s*(?:\d|واحد|واحدة|زوج|اثنين|ثلاث|اربعة|خمسة|ست|سبع|ثمان|تسع|عشرة|عشرين|ثلاثين|اربعين|خمسين|مية|مئتين|ميتين|خمسمية|الف|ألف|مليون))/).map(x=>x.trim()).filter(Boolean);const items=[];let inheritedType=null;for(const clause of chunks){const amount=amountFromClause(clause);if(!amount||!Number.isFinite(amount)||amount<=0)continue;const type=inferType(clause,inheritedType);if(!type)continue;inheritedType=type;let description=describeClause(clause);if(!description){const rawDesc=clause.replace(/\d[\d.,]*/g,'').replace(/(دينار|دج|da)/g,'').trim();description=rawDesc|| (type==='income'?'دخل':'مصروف');}items.push({type,amount,description:description.slice(0,90)});}return items;}

/* describeClause: كان V1.2 يحذف الحروف المفردة (ب، و، ...) من داخل الكلمات فيشوّه الوصف (بنزين -> نزين). الآن تُحذف الكلمات الكاملة فقط. */
const DESCRIPTION_STOPWORDS=new Set(['دينار','جزائري','دج','da','الفين','ألفين','الف','ألف','آلاف','مليونين','مليون','ملايين','خمسمية','خمسماية','ربعمية','ثلاثمية','ميتين','مئتين','ستمية','سبعمية','ثمانمية','تسعمية','مية','مئة','مائة','عشرين','عشرون','ثلاثين','أربعين','خمسين','ستين','سبعين','ثمانين','تسعين','واحدة','واحد','زوج','اثنين','اثنان','ثلاثة','ثلاث','أربعة','اربعة','أربع','خمسة','خمس','ستة','ست','سبعة','سبع','ثمانية','ثمان','تسعة','تسع','عشرة','عشر','صفر','من','على','في','ب','بـ','صرف','صرفت','خلصت','دفعت','شريت','اشتريت','دخلتلي','دخل','لي','ربحت','قبضت','استلمت','مصاريف','مصروف','كلفني','اليوم','هذا','هاذ','ليوم','و','ثم'].map(w=>normalizeSpeech(w).toLowerCase()));
function describeClause(clause){
  return clause.replace(/\d+(?:[.,]\d+)?/g,' ').split(/\s+/).map(w=>w.replace(/^[،,.\-]+|[،,.\-]+$/g,'')).filter(w=>w&&!DESCRIPTION_STOPWORDS.has(w.toLowerCase())).join(' ').trim();
}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
function exportCSV(){const rows=[['النوع','الوصف/التصنيف','المبلغ','العملة','التاريخ'],...db.transactions.map(t=>[t.type==='income'?'دخل':'مصروف',t.description,t.amount,db.currency,t.date])];download('masroufi-transactions.csv','\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('تم تجهيز ملف CSV')}$('exportButton').addEventListener('click',exportCSV);
function openBackupDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(BACKUP_DB,1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('snapshots'))d.createObjectStore('snapshots',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function storeSnapshot(){if(!('indexedDB'in window))throw Error('IndexedDB unavailable');const d=await openBackupDB();await new Promise((resolve,reject)=>{const tx=d.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({id:Date.now(),createdAt:new Date().toISOString(),payload:backupPayload()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});const all=await listSnapshots();for(const old of all.slice(12)){await deleteSnapshot(old.id);}localStorage.setItem('masroufi_last_auto_backup',String(Date.now()));d.close();updateBackupStatus();}
async function listSnapshots(){const d=await openBackupDB();const items=await new Promise((resolve,reject)=>{const r=d.transaction('snapshots','readonly').objectStore('snapshots').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.id-a.id));r.onerror=()=>reject(r.error);});d.close();return items;}
async function deleteSnapshot(key){const d=await openBackupDB();await new Promise((resolve,reject)=>{const tx=d.transaction('snapshots','readwrite');tx.objectStore('snapshots').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});d.close();}
async function maybeAutoBackup(force=false){if(!('indexedDB'in window))return;const last=Number(localStorage.getItem('masroufi_last_auto_backup')||0),interval=(Number(db.backupInterval)||1)*86400000;if(force||!last||Date.now()-last>=interval){try{await storeSnapshot();if(force)toast('تم إنشاء نسخة احتياطية محلية على هذا الجهاز');}catch(e){console.warn('Automatic backup failed',e);if(force)toast('تعذر إنشاء النسخة المحلية؛ نزّل نسخة JSON يدوياً.');}}}
$('backupButton').addEventListener('click',()=>download('masroufi-backup.json',JSON.stringify(backupPayload(),null,2),'application/json'));
$('autoBackupNow').addEventListener('click',()=>maybeAutoBackup(true));

/* ---------- Voice input: push-to-talk (records only while the button is held) ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const PTT_MIN_MS=400,PTT_MAX_MS=60000,PTT_STOP_WAIT_MS=8000;
let rec=null,pttState='idle',pressAt=0,startTimer=null,maxTimer=null,tickTimer=null,stopTimer=null,voiceResults=[],voiceCancelled=false,voiceErrored=false,diag=[];
const recordBtn=$('recordButton');

function resetRecord(){
  recordBtn.classList.remove('listening','processing');
  $('recordLabel').textContent='اضغط مطولاً وتحدث';$('recordHint').textContent='اترك الزر عند الانتهاء · ar-DZ';
}
function tickRecord(){
  const s=Math.floor((Date.now()-pressAt)/1000);
  $('recordHint').textContent='● '+pad(Math.floor(s/60))+':'+pad(s%60)+' · اترك الزر للإنهاء';
}
function liveTranscript(){
  const text=voiceResults.map(a=>a[0]||'').join(' ').trim();
  $('transcriptBox').hidden=false;$('confirmVoice').hidden=true;$('transcriptText').textContent=text||'…';
}
function dlog(n){diag.push(n+'@'+((Date.now()-pressAt)/1000).toFixed(1)+'s');}
function releaseRecognizer(r){if(!r)return;r.onresult=r.onerror=r.onend=r.onstart=r.onaudiostart=r.onspeechstart=r.onnomatch=null;try{r.abort();}catch(e){}}
function forceReset(){clearTimeout(maxTimer);clearInterval(tickTimer);clearTimeout(stopTimer);clearTimeout(startTimer);const r=rec;rec=null;pttState='idle';resetRecord();releaseRecognizer(r);}
function beginPress(){
  if(pttState==='processing')finishVoice(rec);
  else if(pttState==='listening'){if(Date.now()-pressAt<PTT_MIN_MS)return;forceReset();}
  if(pttState!=='idle')forceReset();
  if(!SR){toast('التعرف الصوتي غير متاح في هذا المتصفح. جرّب Chrome أو Edge.');return;}
  let r;try{r=new SR();}catch(e){toast('تعذر تهيئة التعرف الصوتي');return;}
  voiceResults=[];voiceCancelled=false;voiceErrored=false;diag=[];
  r.lang='ar-DZ';r.continuous=true;r.interimResults=true;r.maxAlternatives=3;
  r.onresult=ev=>{if(r!==rec)return;voiceResults=Array.from(ev.results).map(res=>Array.from(res).map(a=>a.transcript));liveTranscript();};
  r.onerror=ev=>{
    if(r!==rec)return;
    voiceErrored=true;dlog('error:'+ev.error);
    const msg={'no-speech':'لم أسمع أي كلام. اضغط مطولاً وتحدث ثم اترك الزر.','not-allowed':'الميكروفون غير مسموح. فعّله من إعدادات المتصفح للموقع.','service-not-allowed':'الميكروفون غير مسموح. فعّله من إعدادات المتصفح للموقع.','audio-capture':'لم يُعثر على ميكروفون.','network':'التعرف الصوتي يحتاج اتصالاً بالإنترنت.','aborted':'انقطع التسجيل. حاول مرة أخرى.'}[ev.error];
    toast(msg||'تعذر التعرف على الصوت: '+ev.error);
  };
  r.onend=()=>{dlog('end');finishVoice(r);};
  r.onstart=()=>{clearTimeout(startTimer);dlog('start');};
  r.onaudiostart=()=>{dlog('audio');if(r===rec&&pttState==='listening')$('recordLabel').textContent='تحدث الآن… اترك الزر عند الانتهاء';};
  r.onspeechstart=()=>dlog('speech');
  r.onnomatch=()=>dlog('nomatch');
  rec=r;
  try{r.start();}catch(e){rec=null;toast('تعذر بدء التسجيل');return;}
  pttState='listening';pressAt=Date.now();
  recordBtn.classList.add('listening');$('recordLabel').textContent='جارٍ تشغيل الميكروفون… انتظر لحظة';tickRecord();
  tickTimer=setInterval(tickRecord,250);maxTimer=setTimeout(endPress,PTT_MAX_MS);
  startTimer=setTimeout(()=>{if(pttState==='listening'&&r===rec){toast('لم يبدأ الميكروفون. تحقق من إذن الميكروفون ثم حاول مجدداً.');forceReset();}},3000);
}
function endPress(){
  if(pttState!=='listening')return;
  clearTimeout(maxTimer);clearInterval(tickTimer);
  const held=Date.now()-pressAt,r=rec;
  if(held<PTT_MIN_MS){voiceCancelled=true;try{r.abort();}catch(e){}toast('اضغط مع الاستمرار أثناء الكلام، ثم اترك الزر.');finishVoice(r);return;}
  pttState='processing';recordBtn.classList.remove('listening');recordBtn.classList.add('processing');
  $('recordLabel').textContent='جارٍ المعالجة…';$('recordHint').textContent='';
  try{r.stop();}catch(e){finishVoice(r);return;}
  stopTimer=setTimeout(()=>finishVoice(r),PTT_STOP_WAIT_MS);
}
function finishVoice(r){
  if(!r||r!==rec)return;
  rec=null;clearTimeout(maxTimer);clearInterval(tickTimer);clearTimeout(stopTimer);clearTimeout(startTimer);
  pttState='idle';resetRecord();releaseRecognizer(r);
  if(voiceCancelled||voiceErrored){if($('transcriptText').textContent==='…')$('transcriptBox').hidden=true;return;}
  processVoice(voiceResults);
}
function processVoice(results){
  const joined=results.map(a=>a[0]||'').join(' ').replace(/\s+/g,' ').trim();
  if(!joined){$('transcriptBox').hidden=false;$('transcriptText').textContent='لم يصل أي كلام من المتصفح.\nتشخيص: '+(diag.join(' ')||'لا أحداث');toast('لم أسمع أي كلام. انتظر ظهور «تحدث الآن» ثم تحدث.');return;}
  const cands=[joined];if(results.length===1)cands.push(...results[0].slice(1));
  let best=null;
  for(const c of cands){const items=parseVoiceBatch(c);if(items.length&&(!best||items.length>best.items.length))best={text:c,items};}
  $('transcriptBox').hidden=false;$('confirmVoice').hidden=true;$('cancelVoice').textContent='إغلاق';
  if(!best){$('transcriptText').textContent=joined+'\n\nلم أتمكن من استخراج عملية واضحة؛ لم يتم حفظ أي شيء.';toast('لم أفهم المبلغ أو نوع العملية؛ لم يتم الحفظ.');return;}
  const date=localDate(),before=spendPct();
  const added=best.items.map(i=>pushTx({type:i.type,description:i.description,amount:i.amount,date}));
  save();render();
  const warn=budgetWarning(before,spendPct()),n=added.length;
  $('transcriptText').textContent=best.text+'\n\n'+best.items.map(x=>(x.type==='income'?'دخل':'مصروف')+' · '+x.description+' · '+money(x.amount)).join('\n');
  toast(`تم حفظ ${n} ${n===1?'عملية':'عمليات'} تلقائياً`+(warn?' · '+warn:''),{action:'تراجع',onAction:()=>{const ids=new Set(added.map(t=>t.id));db.transactions=db.transactions.filter(t=>!ids.has(t.id));save();render();toast('تم التراجع عن الإدخال الصوتي');}});
}
recordBtn.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();try{recordBtn.setPointerCapture(e.pointerId);}catch(err){}beginPress();});
recordBtn.addEventListener('pointerup',endPress);
recordBtn.addEventListener('pointercancel',endPress);
recordBtn.addEventListener('contextmenu',e=>e.preventDefault());
recordBtn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();beginPress();}});
recordBtn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();endPress();}});
recordBtn.addEventListener('blur',endPress);
document.addEventListener('visibilitychange',()=>{if(document.hidden)endPress();});
$('cancelVoice').addEventListener('click',()=>{$('transcriptBox').hidden=true;});

/* ---------- Events ---------- */
document.addEventListener('click',e=>{
  const del=e.target.closest('[data-delete]');if(del){deleteTransaction(del.dataset.delete);return;}
  const ed=e.target.closest('[data-edit]');if(ed){const t=db.transactions.find(x=>x.id===ed.dataset.edit);if(t)openModal({tx:t});return;}
  const rd=e.target.closest('[data-recurring-delete]');
  if(rd&&confirm('حذف العملية المتكررة؟')){db.recurring=db.recurring.filter(r=>r.id!==rd.dataset.recurringDelete);save();render();return;}
  const sn=e.target.closest('[data-snapshot]');if(sn)restoreSnapshot(sn.dataset.snapshot);
});
const viewTitles={dashboard:'نظرة عامة',transactions:'العمليات',recurring:'العمليات المتكررة',reports:'التقارير'};
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$(name+'View').classList.add('active');
  document.querySelectorAll('.nav-link[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('pageTitle').textContent=viewTitles[name];$('monthNav').hidden=name==='recurring';
  if(name==='transactions')renderTransactions();
  if(name==='reports')renderTrend();
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.goto)));
$('prevMonth').addEventListener('click',()=>{viewMonth=shiftMonth(viewMonth,-1);render();});
$('nextMonth').addEventListener('click',()=>{if(viewMonth<monthKey()){viewMonth=shiftMonth(viewMonth,1);render();}});
$('openAdd').addEventListener('click',()=>openModal());$('addFromTransactions').addEventListener('click',()=>openModal());
$('addRecurring').addEventListener('click',()=>{openModal();$('entryIsRecurring').checked=true;$('recurringOptions').hidden=false;});
$('closeModal').addEventListener('click',closeModal);$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)closeModal();});
['searchInput','typeFilter','scopeFilter','sortFilter'].forEach(k=>$(k).addEventListener(k==='searchInput'?'input':'change',renderTransactions));
$('saveBudget').addEventListener('click',()=>{const v=Number($('budgetInput').value);db.budget=Number.isFinite(v)&&v>0?v:0;save();render();toast(db.budget?'تم حفظ الميزانية':'تم إلغاء الميزانية');});
$('budgetInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('saveBudget').click();}});
$('printReport').addEventListener('click',()=>window.print());
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem(THEME_KEY,t);}
function toggleTheme(){setTheme(document.documentElement.dataset.theme==='light'?'dark':'light');render();}
setTheme(localStorage.getItem(THEME_KEY)||'dark');$('themeToggle').addEventListener('click',toggleTheme);$('mobileTheme').addEventListener('click',toggleTheme);
$('currencySelect').addEventListener('change',e=>{db.currency=e.target.value;save();render();});
$('exportButton').addEventListener('click',exportCSV);

/* ---------- Backup ---------- */
function backupPayload(){return{version:3,exportedAt:new Date().toISOString(),transactions:db.transactions,recurring:db.recurring,currency:db.currency,backupInterval:db.backupInterval,budget:db.budget};}
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
function cleanTx(list){
  const out=[];let dropped=0;
  for(const t of list){
    const amount=Number(t&&t.amount),desc=t&&typeof t.description==='string'?t.description.trim().slice(0,90):'';
    if(t&&(t.type==='income'||t.type==='expense')&&Number.isFinite(amount)&&amount>0&&DATE_RE.test(t.date||'')&&desc){out.push({...t,id:String(t.id||id()),amount,description:desc,category:desc,createdAt:Number(t.createdAt)||Date.now()});}else dropped++;
  }
  return{out,dropped};
}
function cleanRecurring(list){
  const out=[];let dropped=0;
  for(const r of list){
    const amount=Number(r&&r.amount),desc=r&&typeof r.description==='string'?r.description.trim().slice(0,90):'';
    if(r&&(r.type==='income'||r.type==='expense')&&Number.isFinite(amount)&&amount>0&&freqNames[r.frequency]&&DATE_RE.test(r.nextDate||'')&&desc){out.push({...r,id:String(r.id||id()),amount,description:desc,category:desc});}else dropped++;
  }
  return{out,dropped};
}
function applyPayload(x){
  if(!x||!Array.isArray(x.transactions)||!Array.isArray(x.recurring))throw new Error('invalid backup');
  const a=cleanTx(x.transactions),r=cleanRecurring(x.recurring);
  db={transactions:a.out,recurring:r.out,currency:currencySymbols[x.currency]?x.currency:'DZD',backupInterval:[1,7,30].includes(Number(x.backupInterval))?Number(x.backupInterval):1,budget:Number(x.budget)>0?Number(x.budget):0};
  save();render();return a.dropped+r.dropped;
}
async function updateBackupStatus(){
  const el=$('backupStatus'),box=$('snapshotList');if(!el)return;
  try{
    const list=await listSnapshots(),last=list[0];
    el.textContent=last?'آخر نسخة تلقائية: '+new Date(last.id).toLocaleString('ar-DZ')+' · '+list.length+' نسخة محفوظة':'سيتم إنشاء أول نسخة تلقائية الآن';
    box.innerHTML=list.map(s=>`<div class="snapshot-row"><div class="transaction-info"><b>${escapeHtml(new Date(s.id).toLocaleString('ar-DZ'))}</b><small>${(s.payload&&s.payload.transactions&&s.payload.transactions.length)||0} عملية</small></div><button class="ghost-button" data-snapshot="${s.id}">استعادة</button></div>`).join('');
  }catch(e){el.textContent='النسخ المحلية غير مدعومة في هذا المتصفح.';if(box)box.innerHTML='';}
}
async function restoreSnapshot(key){
  let s;try{s=(await listSnapshots()).find(x=>x.id===Number(key));}catch(e){}
  if(!s)return toast('تعذر العثور على النسخة');
  if(!confirm('سيتم استبدال البيانات الحالية بنسخة '+new Date(s.id).toLocaleString('ar-DZ')+'. سيُحفظ نسخة من بياناتك الحالية أولاً. متابعة؟'))return;
  try{await storeSnapshot();}catch(e){}
  try{const dropped=applyPayload(s.payload);toast('تمت استعادة النسخة'+(dropped?` (تم تجاهل ${dropped} سجلاً غير صالح)`:''));}catch(e){toast('النسخة غير صالحة');}
}
$('backupInterval').addEventListener('change',e=>{db.backupInterval=Number(e.target.value);save();maybeAutoBackup(true);toast('تم تحديث فترة النسخ الاحتياطي');});
$('restoreInput').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const x=JSON.parse(await f.text());
    if(!x||!Array.isArray(x.transactions)||!Array.isArray(x.recurring))throw new Error('invalid');
    if(!confirm('سيتم استبدال البيانات الحالية بالنسخة المستوردة. سيُحفظ نسخة من بياناتك الحالية أولاً. متابعة؟')){e.target.value='';return;}
    try{await storeSnapshot();}catch(err){}
    const dropped=applyPayload(x);toast('تم استيراد النسخة الاحتياطية'+(dropped?` (تم تجاهل ${dropped} سجلاً غير صالح)`:''));
  }catch(err){toast('ملف النسخة الاحتياطية غير صالح');}
  e.target.value='';
});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

/* ---------- Init ---------- */
load();processRecurring();render();maybeAutoBackup();setInterval(()=>maybeAutoBackup(),15*60*1000);
