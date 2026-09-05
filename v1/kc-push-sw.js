self.addEventListener('push',event=>{let d={};try{d=event.data?event.data.json():{}}catch{d={body:event.data?event.data.text():''}}const title=d.title||'KC Communication';const options={body:d.body||d.message||'Neue Nachricht',icon:d.icon||'./icon-192.png',badge:d.badge||'./icon-192.png',data:d.data||{url:d.url||'./'},tag:d.tag||'kc-communication',renotify:true};event.waitUntil(self.registration.showNotification(title,options))});self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'./';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c){c.navigate?.(url);return c.focus()}}return clients.openWindow?clients.openWindow(url):undefined}))});

/* Selbsterneuerung der Push-Anmeldung.
   Ein Browser tauscht die Zustelladresse von sich aus aus und kuendigt das mit
   pushsubscriptionchange an - dafuer laeuft der Service Worker auch bei
   geschlossener Anwendung. Ohne diese Behandlung faellt der Wechsel erst beim
   Fehler 410 auf, also nachdem eine Nachricht schon nicht mehr ankam.
   Berechtigt wird die Erneuerung durch ein Geheimnis, das nur fuer diese eine
   Anmeldung gilt und nur das Eintragen einer neuen Adresse erlaubt. */
const KC_LAGER='kc-comm-push',KC_FACH='anmeldung';
function kcLager(modus){return new Promise((fertig,fehler)=>{const a=indexedDB.open(KC_LAGER,1);a.onupgradeneeded=()=>a.result.createObjectStore(KC_FACH);a.onerror=()=>fehler(a.error);a.onsuccess=()=>fertig(a.result.transaction(KC_FACH,modus).objectStore(KC_FACH))})}
async function kcMerken(werte){const f=await kcLager('readwrite');for(const [n,w] of Object.entries(werte))f.put(w,n)}
async function kcGemerkt(n){const f=await kcLager('readonly');return new Promise(fertig=>{const a=f.get(n);a.onsuccess=()=>fertig(a.result);a.onerror=()=>fertig(undefined)})}
self.addEventListener('message',e=>{if(e.data&&e.data.art==='kc-push-angemeldet'){e.waitUntil(kcMerken({projektUrl:e.data.projektUrl,schluessel:e.data.schluessel,vapid:e.data.vapid,geheimnis:e.data.geheimnis,endpunkt:e.data.endpunkt}).catch(()=>{}))}});
function kcSchluesselBytes(s){const p='='.repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))}
async function kcErneuern(alte){const [projektUrl,schluessel,vapid,geheimnis,gemerkterEndpunkt]=await Promise.all(['projektUrl','schluessel','vapid','geheimnis','endpunkt'].map(kcGemerkt));
  /* Ohne Geheimnis passiert hier bewusst nichts - dann heilt die Selbstpruefung
     beim naechsten Oeffnen der Anwendung. */
  if(!projektUrl||!geheimnis||!vapid)return;
  const alterEndpunkt=(alte&&alte.endpoint)||gemerkterEndpunkt;if(!alterEndpunkt)return;
  const neue=await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:kcSchluesselBytes(vapid)});
  const antwort=await fetch(projektUrl+'/functions/v1/kc-communication-push-devices',{method:'POST',headers:{apikey:schluessel||'','Content-Type':'application/json'},body:JSON.stringify({action:'erneuern',geheimnis,alterEndpunkt,subscription:neue.toJSON()})});
  if(antwort.ok)await kcMerken({endpunkt:neue.endpoint})}
self.addEventListener('pushsubscriptionchange',e=>{e.waitUntil(kcErneuern(e.oldSubscription).catch(()=>{}))});
