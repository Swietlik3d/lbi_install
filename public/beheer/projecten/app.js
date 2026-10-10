const $ = id => document.getElementById(id);
const fields = ['title','category','location','date','summary','coverAlt','body','cover'];
let csrf = '', projects = [], selected = '', dirty = false, busy = false, publishing = false, pollTimer;
const statuses = {concept:'Concept',gepubliceerd:'Gepubliceerd',gewijzigd:'Wijzigingen opgeslagen'};
function message(text, kind = 'info') { $('notice').textContent = text; $('notice').dataset.kind = kind; $('notice').hidden = !text; }
function setBusy(value) { busy = value; $('project-form').setAttribute('aria-busy',String(value)); $('project-form').querySelectorAll('input,textarea,select').forEach(field => { field.disabled = value; }); document.querySelectorAll('button').forEach(button => { button.disabled = value || (button.id === 'publish-project' && publishing); }); }
function photo(cover) { $('photo-preview').hidden = !cover; $('photo-placeholder').hidden = !!cover; if (cover) $('photo-preview').src = '/beheer/api/media/' + encodeURIComponent(cover); else $('photo-preview').removeAttribute('src'); }
function loggedOut() { csrf = ''; clearTimeout(pollTimer); $('workspace').hidden = true; $('logout').hidden = true; $('login-view').hidden = false; $('loading').hidden = true; publishing = false; }
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (options.json !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.json); }
  const response = await fetch('/beheer/api' + path, {...options, headers, credentials:'same-origin', cache:'no-store'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && path !== '/login') loggedOut(); throw new Error(data.error?.message || data.message || 'Dat lukte niet. Probeer het opnieuw.'); }
  return data;
}
function reset(project) {
  selected = project?.id || ''; $('project-id').value = selected;
  for (const name of fields) $(name).value = project?.[name] || (name === 'category' ? 'Badkamer' : '');
  $('photo').value = ''; $('photo-consent').checked = false; $('photo-message').textContent = ''; photo(project?.cover);
  $('editor-kicker').textContent = project ? 'PROJECT BEWERKEN' : 'NIEUW PROJECT';
  $('editor-title').textContent = project?.title || 'Van klus naar realisatie.';
  $('editor-status').textContent = statuses[project?.status] || 'Concept';
  $('save-note').textContent = project?.publishedAt ? 'Opslaan bewaart uw wijzigingen. Publiceren werkt de website bij.' : 'Een concept is nog niet zichtbaar op de website.';
  $('save-draft').textContent = project?.publishedAt ? 'Wijzigingen opslaan' : 'Concept opslaan';
  dirty = false; renderList();
}
function maySwitch() { return !dirty || confirm('U heeft nog niet opgeslagen wijzigingen. Wilt u verdergaan zonder deze op te slaan?'); }
function renderList() {
  $('project-list').replaceChildren(); $('project-count').textContent = String(projects.length); $('empty-list').hidden = projects.length > 0;
  for (const project of projects) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'project-choice'; button.disabled = busy; button.setAttribute('aria-pressed',String(project.id === selected));
    if (project.cover) { const img = document.createElement('img'); img.src = '/beheer/api/media/' + encodeURIComponent(project.cover); img.alt = ''; img.loading = 'lazy'; button.append(img); }
    const text = document.createElement('div'), title = document.createElement('strong'), status = document.createElement('small');
    title.textContent = project.title || 'Nieuw project'; status.textContent = statuses[project.status] || 'Concept'; text.append(title,status); button.append(text);
    button.addEventListener('click',() => { if (!busy && maySwitch()) { reset(project); message(''); } }); $('project-list').append(button);
  }
}
async function loadProjects() { projects = (await api('/projects')).projects; renderList(); }
async function signedIn(session) { csrf = session.csrfToken; await loadProjects(); $('login-view').hidden = true; $('loading').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; reset(); await checkPublication(); }
$('password-toggle').addEventListener('click',() => { const visible = $('password').type === 'password'; $('password').type = visible ? 'text' : 'password'; $('password-toggle').textContent = visible ? 'Verberg' : 'Toon'; $('password-toggle').setAttribute('aria-pressed',String(visible)); });
$('login-form').addEventListener('submit',async event => { event.preventDefault(); if (busy) return; setBusy(true); $('login-message').textContent = ''; try { await signedIn(await api('/login',{method:'POST',json:{password:$('password').value}})); } catch (error) { $('login-message').textContent = error.message; } finally { $('password').value = ''; setBusy(false); } });
$('logout').addEventListener('click',async () => { if (!maySwitch()) return; setBusy(true); try { await api('/logout',{method:'POST',json:{}}); dirty = false; loggedOut(); } catch (error) { message(error.message,'error'); } finally { setBusy(false); } });
$('new-project').addEventListener('click',() => { if (maySwitch()) { reset(); message(''); $('title').focus(); } });
$('project-form').addEventListener('input',() => { dirty = true; });
$('photo').addEventListener('change',async () => {
  const file = $('photo').files[0]; if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { $('photo-message').textContent = 'Kies een JPG, PNG of WebP van maximaal 10 MB.'; $('photo').value = ''; return; }
  setBusy(true); $('photo-message').textContent = 'Foto wordt voorbereid…';
  try { const uploaded = await api('/media',{method:'POST',headers:{'Content-Type':file.type},body:file}); $('cover').value = uploaded.cover; photo(uploaded.cover); dirty = true; $('photo-message').textContent = 'Foto klaar. Sla uw project op om deze te bewaren.'; } catch (error) { $('photo-message').textContent = error.message; } finally { setBusy(false); }
});
function validatePublish() {
  for (const name of ['title','location','date','summary','coverAlt']) { if (!$(name).value.trim()) { message('Vul de projectnaam, plaats, datum, omschrijving en fotobeschrijving in voordat u publiceert.','error'); $(name).focus(); return false; } }
  if (!$('cover').value) { message('Kies eerst een projectfoto.','error'); $('photo').focus(); return false; }
  if (!$('photo-consent').checked) { message('Bevestig eerst dat u de foto mag publiceren en dat de gegevens juist zijn.','error'); $('photo-consent').focus(); return false; }
  return true;
}
$('project-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy) return;
  const publish = event.submitter?.id === 'publish-project'; if (publish && (publishing || !validatePublish())) return;
  setBusy(true); message('');
  try {
    const data = Object.fromEntries(fields.map(name => [name,$(name).value.trim()])); if (selected) data.id = selected;
    const {project} = await api('/projects',{method:'POST',json:data}); await loadProjects(); reset(project);
    if (publish) { await api('/publish',{method:'POST',json:{id:project.id}}); publishing = true; message('Uw project wordt op de website gezet. Dit kan even duren.'); await checkPublication(); }
    else message(project.publishedAt ? 'Wijzigingen opgeslagen. Klik op Publiceren om de website bij te werken.' : 'Concept opgeslagen. Het is nog niet zichtbaar op de website.','success');
  } catch (error) { message(error.message,'error'); } finally { setBusy(false); }
});
async function checkPublication() {
  clearTimeout(pollTimer); if (!csrf) return;
  try {
    const {publication} = await api('/publication'); publishing = publication.state === 'publishing'; $('publish-project').disabled = busy || publishing;
    if (publishing) { message('Uw project wordt op de website gezet. U kunt dit panel openlaten.'); pollTimer = setTimeout(checkPublication,1500); }
    else if (publication.state === 'success') { await loadProjects(); if (!dirty && selected) reset(projects.find(project => project.id === selected)); message('Gepubliceerd. Uw project staat nu op de website.','success'); }
    else if (publication.state === 'failed') message('Uw wijzigingen zijn opgeslagen, maar het publiceren is niet gelukt. Probeer opnieuw of neem contact op met uw websitebeheerder.','error');
  } catch (error) { message(error.message,'error'); publishing = false; $('publish-project').disabled = busy; }
}
window.addEventListener('beforeunload',event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try { const session = await api('/session'); if (session.authenticated) await signedIn(session); else loggedOut(); } catch { loggedOut(); $('login-message').textContent = 'Het panel is tijdelijk niet bereikbaar. Probeer later opnieuw of neem contact op met uw websitebeheerder.'; }
