/* KC Update Core
 *
 * Ein Update soll nicht heimlich passieren und nicht uebersehen werden.
 * Deshalb drei Dinge:
 *   1. Nach dem Anmelden erscheint der Hinweis von selbst, nicht erst wenn
 *      jemand auf "Updates pruefen" tippt.
 *   2. Ja oder Nein. "Spaeter" wird gemerkt, damit derselbe Stand nicht bei
 *      jedem Start erneut fragt - ausser das Update ist als verbindlich
 *      gekennzeichnet, dann gibt es kein Spaeter.
 *   3. Ein Zeitbalken beim Installieren. Er zeigt die tatsaechliche Restzeit
 *      bis zum Neustart, keine erfundene Fortschrittsanzeige: die Dauer steht
 *      als estimatedInstallSeconds im Versionsmanifest, und am Ende wird
 *      wirklich neu geladen.
 *
 * Behaelt Dateiname und Element-Kennungen der frueheren Fassung, damit die
 * uebrige Oberflaeche unveraendert bleibt.
 */
(() => {
  'use strict';

  const AKTUELL = String(window.KC_APP_VERSION || '1.0.0');
  const MANIFEST = '../releases/latest.json';
  const SPAETER_SPEICHER = 'kc_update_spaeter';
  const SPAETER_STUNDEN = 12;

  const SUPA = 'https://ptblnpiroqftcvlsrhac.supabase.co';
  const KEY = 'sb_publishable_SqXIeGN-clcZ4gjmpLdSww_4DLfyy24';

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------- Versionen
  const teile = (v) => String(v || '0').replace(/[^0-9.]/g, '').split('.').map((x) => Number(x) || 0);
  function neuer(a, b) {
    const A = teile(a), B = teile(b), n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  // Die Oberflaeche kennt nur die Klassen ok und bad. Die fruehere Fassung
  // setzte success und error - die Meldungen blieben dadurch ungestylt.
  function melde(text, art = '') {
    const n = $('notice');
    if (n) { n.textContent = text; n.className = 'notice ' + art; }
  }

  // ------------------------------------------------------- Spaeter merken
  function spaeterGemerkt(version) {
    try {
      const roh = localStorage.getItem(SPAETER_SPEICHER);
      if (!roh) return false;
      const s = JSON.parse(roh);
      if (s.version !== version) return false;
      return Date.now() - Number(s.zeit || 0) < SPAETER_STUNDEN * 3600 * 1000;
    } catch { return false; }
  }
  function spaeterMerken(version) {
    try { localStorage.setItem(SPAETER_SPEICHER, JSON.stringify({ version, zeit: Date.now() })); } catch { /* egal */ }
  }
  function spaeterVergessen() {
    try { localStorage.removeItem(SPAETER_SPEICHER); } catch { /* egal */ }
  }

  // ---------------------------------------------------------- Zeitbalken
  function balkenAufbauen() {
    if ($('kcUpdateFortschritt')) return;
    const stil = document.createElement('style');
    stil.textContent =
      '#kcUpdateFortschritt{margin:12px 0 4px;display:none}' +
      '#kcUpdateFortschritt.an{display:block}' +
      '#kcUpdateSpur{height:8px;border-radius:999px;background:rgba(0,0,0,.12);overflow:hidden}' +
      '#kcUpdateBalken{height:100%;width:0;border-radius:999px;background:#741521;transition:width .25s linear}' +
      '#kcUpdateRest{margin-top:6px;font-size:12px;opacity:.75}';
    document.head.appendChild(stil);

    const huelle = document.createElement('div');
    huelle.id = 'kcUpdateFortschritt';
    huelle.innerHTML = '<div id="kcUpdateSpur"><div id="kcUpdateBalken"></div></div><div id="kcUpdateRest"></div>';
    const text = $('updateText');
    if (text && text.parentNode) text.parentNode.insertBefore(huelle, text.nextSibling);
  }

  // Zaehlt echte Sekunden herunter. Am Ende wird geladen - der Balken
  // behauptet also nichts, was nicht kommt.
  function balkenLaufenLassen(sekunden, fertig) {
    balkenAufbauen();
    const huelle = $('kcUpdateFortschritt'), balken = $('kcUpdateBalken'), rest = $('kcUpdateRest');
    if (!huelle) { fertig(); return; }
    huelle.classList.add('an');
    const dauer = Math.max(2, Math.min(30, Number(sekunden) || 4)) * 1000;
    const start = Date.now();
    const uhr = setInterval(() => {
      const vergangen = Date.now() - start;
      const anteil = Math.min(1, vergangen / dauer);
      balken.style.width = (anteil * 100).toFixed(1) + '%';
      const uebrig = Math.ceil((dauer - vergangen) / 1000);
      rest.textContent = uebrig > 0
        ? 'Update wird vorbereitet – Neustart in ' + uebrig + ' Sekunde' + (uebrig === 1 ? '' : 'n') + ' …'
        : 'Neustart …';
      if (anteil >= 1) { clearInterval(uhr); fertig(); }
    }, 100);
  }

  // ------------------------------------------------------------- Pruefung
  let laeuft = false;

  async function pruefen(optionen) {
    const zeigeAktuell = optionen && optionen.zeigeAktuell !== undefined ? optionen.zeigeAktuell : true;
    const vonSelbst = !!(optionen && optionen.vonSelbst);
    if (laeuft) return { laeuft: true };
    laeuft = true;
    const knopf = $('updateBtn');
    if (knopf) knopf.disabled = true;
    try {
      const r = await fetch(MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const m = await r.json();
      const dlg = $('updateDialog');

      if (!neuer(m.version, AKTUELL)) {
        if (dlg && dlg.open) dlg.close();
        spaeterVergessen();
        if (zeigeAktuell) melde('KC Communication ' + AKTUELL + ' ist auf dem aktuellen Stand.', 'ok');
        return { aktuell: true, manifest: m };
      }

      // Von selbst darf der Hinweis nicht nerven: ein abgelehnter Stand bleibt
      // eine Weile still. Ein verbindliches Update dagegen nie.
      if (vonSelbst && !m.mandatory && spaeterGemerkt(m.version)) {
        return { aktuell: false, unterdrueckt: true, manifest: m };
      }

      $('updateText').textContent =
        'Version ' + m.version + ' ist verfügbar.' + (m.notes ? ' ' + m.notes : '');
      const spaeterKnopf = $('laterBtn');
      if (spaeterKnopf) {
        spaeterKnopf.removeAttribute('disabled');
        spaeterKnopf.style.display = m.mandatory ? 'none' : '';
      }
      const fortschritt = $('kcUpdateFortschritt');
      if (fortschritt) fortschritt.classList.remove('an');
      const install = $('installBtn');
      if (install) { install.disabled = false; install.textContent = 'Jetzt installieren'; }
      if (dlg && !dlg.open) dlg.showModal();
      return { aktuell: false, manifest: m };
    } catch (e) {
      melde('Update-Prüfung derzeit nicht möglich: ' + (e.message || e), 'bad');
      return { fehler: true };
    } finally {
      laeuft = false;
      if (knopf) knopf.disabled = false;
    }
  }

  async function installieren() {
    const install = $('installBtn');
    if (install) install.disabled = true;

    // Vor dem Installieren nochmal nachsehen: in der Zwischenzeit kann der
    // laufende Stand schon der aktuelle sein.
    const x = await pruefen({ zeigeAktuell: false });
    if (x.aktuell) { if (install) install.disabled = false; return; }

    const ziel = x.manifest && x.manifest.releaseUrl;
    if (!ziel) {
      melde('Update ist angekündigt, aber noch nicht installationsbereit.', 'bad');
      if (install) install.disabled = false;
      return;
    }

    if (install) install.textContent = 'Wird installiert …';
    const spaeterKnopf = $('laterBtn');
    if (spaeterKnopf) spaeterKnopf.setAttribute('disabled', 'disabled');
    spaeterVergessen();

    balkenLaufenLassen(x.manifest.estimatedInstallSeconds, async () => {
      // Alten Zwischenspeicher raeumen, sonst startet der Browser unter
      // Umstaenden wieder in die vorherige Fassung.
      try {
        if (navigator.serviceWorker) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        if (window.caches) {
          const namen = await caches.keys();
          await Promise.all(namen.map((n) => caches.delete(n)));
        }
      } catch { /* ohne Aufraeumen geht es auch, nur langsamer */ }
      location.replace(ziel + (ziel.indexOf('?') >= 0 ? '&' : '?') + 'install=' + Date.now());
    });
  }

  // ------------------------------------------------------------- Aufbau
  function aufbauen() {
    const knopf = $('updateBtn');
    if (knopf) knopf.addEventListener('click', () => pruefen({ zeigeAktuell: true }));

    const spaeterKnopf = $('laterBtn');
    if (spaeterKnopf) spaeterKnopf.addEventListener('click', async () => {
      const r = await pruefen({ zeigeAktuell: false });
      if (r.manifest && r.manifest.version) spaeterMerken(r.manifest.version);
      const dlg = $('updateDialog');
      if (dlg) dlg.close();
    });

    const install = $('installBtn');
    if (install) install.addEventListener('click', installieren);

    // Beim Start einmal, still.
    setTimeout(() => pruefen({ zeigeAktuell: false, vonSelbst: true }), 900);

    // Und nach jeder Anmeldung: genau dann schaut jemand auf den Bildschirm.
    try {
      const sb = window.supabase && window.supabase.createClient(SUPA, KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      if (sb && sb.auth && sb.auth.onAuthStateChange) {
        sb.auth.onAuthStateChange((ereignis) => {
          if (ereignis === 'SIGNED_IN') setTimeout(() => pruefen({ zeigeAktuell: false, vonSelbst: true }), 1200);
        });
      }
    } catch { /* ohne Anmeldeereignis bleibt die Pruefung beim Start */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aufbauen, { once: true });
  else aufbauen();

  window.KCUpdate = { pruefen, installieren, version: AKTUELL };
})();
