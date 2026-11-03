const CACHE='masroufi-shell-v5';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./icon-32.png'];
const CHART_CDN='https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';
self.addEventListener('install',e=>{
  self.skipWaiting();
  // ملفات التطبيق إلزامية؛ مكتبة الرسم اختيارية (لا يفشل التثبيت إن تعذّر تحميلها)
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all([c.addAll(ASSETS),c.add(new Request(CHART_CDN,{mode:'cors'})).catch(()=>{})])));
});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// الشبكة أولاً (تصل التحديثات فوراً عند وجود اتصال) ثم الكاش دون اتصال
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res.ok&&new URL(e.request.url).origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(()=>caches.match(e.request).then(c=>c||(e.request.mode==='navigate'?caches.match('./index.html'):Response.error()))));
});
