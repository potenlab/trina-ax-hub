/** @jsxImportSource hono/jsx */
// 회사 파일 (/files): the company's files in the browser. Every person sees only what the folder permissions let them
// see (the same FileService and authorize() as the MCP tools; a hidden folder looks like one that does not exist, a
// person's own folder users/<id>/ included). Upload (several files, a dropped folder, drag and drop, a phone's file
// picker), new folder, download, rename, move and delete (to the trash, with earlier versions kept).
//
//   GET  /files?path=            a folder: breadcrumbs, upload, new folder, the list
//   GET  /files/item?path=       one file or folder: rename, move, delete
//   GET  /files/download?path=   a file (attachment; an image or PDF opens in the browser)
//   POST /files/upload           multipart, streamed to disk (src/files/upload.ts); JSON answer when asked for
//   POST /files/folder | /files/rename | /files/move | /files/delete     forms with _csrf
//
// Session login only: no device, hub or connector token ever reaches these routes. Every response is no-store;
// downloads are served with nosniff and, unless they are a verified image or PDF, as an attachment.
import fs from 'node:fs'
import type { MiddlewareHandler } from 'hono'
import { raw } from 'hono/html'
import type { App, AppEnv, C } from '../http/app'
import { sessionMiddleware } from '../http/app'
import { jsonError } from '../http/errors'
import type { SessionAuth } from '../auth/sessions'
import { audit } from '../audit'
import { lastChange } from '../files/changes'
import { imageMime, isImageName } from '../files/extract'
import { describeFileError } from '../files/messages'
import { boundaryOf, drainBody } from '../files/multipart'
import { fdStream } from '../files/store'
import { FileService, type ListEntry } from '../files/service'
import { receiveUpload, UPLOAD_FILE_MAX, UPLOAD_REQUEST_MAX, UploadRefused, type UploadItem } from '../files/upload'
import { recordToolEvent } from '../mcp/tools'
import { ToolError } from '../policy/errors'
import { Csrf } from '../ui/layout'
import { fmtDateTime } from '../ui/format'
import { csrfOk } from '../auth/sessions'
import { type Web, type Flash, Shell, Empty, ButtonForm, render, takeFlashes, say, field, safeNext, sessionForm, CsrfError, csrfRefused, pageGuard } from './kit'

const KB = 1024, MB = KB * KB
const fmtSize = (n: number) => (n < KB ? `${n} B` : n < MB ? `${(n / KB).toFixed(1)} KB` : n < 1024 * MB ? `${(n / MB).toFixed(1)} MB` : `${(n / (1024 * MB)).toFixed(2)} GB`)

const hrefFor = (p: string) => '/files' + (p ? `?path=${encodeURIComponent(p)}` : '')
const itemHref = (p: string) => `/files/item?path=${encodeURIComponent(p)}`
const downloadHref = (p: string, dl = false) => `/files/download?path=${encodeURIComponent(p)}${dl ? '&dl=1' : ''}`
const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
const baseName = (p: string) => p.split('/').pop() ?? p

/** users/ is "개인 폴더", users/<my id> is "내 폴더"; everything else shows its name. */
const folderLabel = (p: string, me: string) => (p === 'users' ? '개인 폴더' : p === `users/${me}` ? '내 폴더' : baseName(p))

/** Personal folders are private: what is logged about them names the folder, never the file. */
const publicPath = (rel: string) => (rel.startsWith('users/') ? rel.split('/').slice(0, 2).join('/') : rel)

/** The Content-Disposition of a download: an ASCII fallback plus the real name (RFC 5987) for Korean names. */
export function contentDisposition(name: string, type: 'attachment' | 'inline'): string {
  const dot = name.lastIndexOf('.')
  const asciiExt = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : ''
  const stem = dot > 0 ? name.slice(0, dot) : name
  const fallback = (stem.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\%;]/g, '_').trim() || 'file') + asciiExt
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${type}; filename="${fallback}"; filename*=UTF-8''${star}`
}

/** What a download may open in the browser: a verified image (not SVG) or a PDF; everything else is saved. */
function previewType(name: string, head: Uint8Array): string | null {
  const ext = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase()
  if (ext === 'pdf') return head.length >= 5 && Buffer.from(head.subarray(0, 5)).toString('latin1') === '%PDF-' ? 'application/pdf' : null
  return isImageName(name) ? imageMime(head) : null
}

const STYLE = `
.crumbs{margin:0 0 14px;font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 6px;align-items:center}.crumbs b{color:var(--ink)}
.bar2{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin:0 0 12px}
.newfolder{display:flex;gap:8px;align-items:center;margin:0}.newfolder input{width:200px;max-width:100%}
.drop{border:2px dashed var(--line);border-radius:var(--radius);padding:18px 16px;text-align:center;background:var(--bg);transition:border-color .15s,background .15s}
.drop.over{border-color:var(--accent);background:var(--accent-soft)}.drop b{display:block;margin-bottom:6px}
.drop input[type=file]{width:auto;max-width:100%;border:0;padding:6px 0;background:none;font-size:14px}
.drop input[type=file]::file-selector-button{font:inherit;font-size:14px;padding:8px 14px;margin-right:10px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);font-weight:600;cursor:pointer}
.drop .alt{margin-top:6px}
.checkline{display:flex;gap:8px;align-items:flex-start;margin:12px 0 10px;font-size:14px;color:var(--ink)}.checkline input{width:auto;margin-top:4px}
.js #upgo{display:none}
.uplist{list-style:none;margin:12px 0 0;padding:0}.uplist li{padding:8px 0;border-top:1px solid var(--line);font-size:14px;word-break:break-word}
.uplist li:first-child{border-top:0}.uplist .st{color:var(--muted)}.uplist .st.ok{color:var(--good)}.uplist .st.bad{color:var(--bad)}
.uplist .bar{margin-top:6px}
table.files td.name a{font-weight:600;text-decoration:none}table.files td.name a:hover{text-decoration:underline}
table.files td.fa{white-space:nowrap;text-align:right;vertical-align:middle}table.files td.fa a{margin-left:4px}
.meta2{color:var(--muted);font-size:13px;margin-top:2px}
.manage form{margin:0 0 14px}.manage .row{align-items:flex-end}
@media (max-width:640px){table.files td.fa a.dl{display:none}}
`

const UPLOAD_JS = `(function(){
var form=document.getElementById('up');
if(!form||!window.FormData||!window.XMLHttpRequest)return;
document.documentElement.classList.add('js');
var MB=1048576,FILE_MAX=${UPLOAD_FILE_MAX},BATCH_MAX=64*MB,BATCH_FILES=100;
var csrf=form.querySelector('[name=_csrf]').value,dir=form.querySelector('[name=dir]').value;
var over=form.querySelector('[name=overwrite]');
var drop=document.getElementById('drop'),list=document.getElementById('uplist');
var pick=document.getElementById('pick'),pickDir=document.getElementById('pickdir'),dirBtn=document.getElementById('dirwrap');
var queue=[],busy=false,okCount=0,badCount=0;
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function size(n){return n<1024?n+' B':n<MB?(n/1024).toFixed(1)+' KB':(n/MB).toFixed(1)+' MB'}
function addRow(path,file){var li=el('li');li.appendChild(el('div','',path+'  ('+size(file.size)+')'));var st=el('div','st','기다리는 중');li.appendChild(st);list.appendChild(li);return{li:li,st:st}}
function setSt(r,text,cls){r.st.textContent=text;r.st.className='st'+(cls?' '+cls:'')}
if(dirBtn&&('webkitdirectory' in pickDir)&&!(window.matchMedia&&matchMedia('(pointer:coarse)').matches))dirBtn.hidden=false;
function enqueue(entries){
  entries.forEach(function(e){
    var row=addRow(e.path,e.file);
    if(e.file.size>FILE_MAX){setSt(row,'파일이 너무 커요. 한 파일은 '+(FILE_MAX/MB)+'MB까지 올릴 수 있어요.','bad');badCount++;return}
    queue.push({file:e.file,path:e.path,row:row});
  });
  pump();
}
function pump(){
  if(busy||!queue.length){if(!busy)finish();return}
  var batch=[],bytes=0;
  while(queue.length&&batch.length<BATCH_FILES&&(!batch.length||bytes+queue[0].file.size<=BATCH_MAX)){var q=queue.shift();batch.push(q);bytes+=q.file.size}
  busy=true;
  batch.forEach(function(b){setSt(b.row,'올리는 중… 0%')});
  var fd=new FormData();
  fd.append('_csrf',csrf);fd.append('dir',dir);if(over&&over.checked)fd.append('overwrite','1');
  batch.forEach(function(b){fd.append('relpath',b.path);fd.append('files',b.file,b.file.name)});
  var x=new XMLHttpRequest();
  x.open('POST','/files/upload');
  x.setRequestHeader('Accept','application/json');x.setRequestHeader('X-CSRF-Token',csrf);
  x.upload.onprogress=function(e){if(!e.lengthComputable)return;var p=Math.min(99,Math.round(100*e.loaded/e.total));batch.forEach(function(b){setSt(b.row,'올리는 중… '+p+'%')})};
  x.onload=function(){
    var r=null;try{r=JSON.parse(x.responseText)}catch(_){}
    var items=r&&r.items?r.items:null;
    batch.forEach(function(b,i){
      var it=items&&items[i];
      if(it&&it.status!=='error'){setSt(b.row,it.status==='created'?'올렸어요':it.status==='replaced'?'새 파일로 바꿨어요 (이전 파일은 남아 있어요)':'똑같은 파일이라 그대로 뒀어요','ok');okCount++}
      else{var m=it&&it.message?it.message:(r&&r.error&&r.error.message)||(x.status===413?'한 번에 올릴 수 있는 크기를 넘었어요. 나눠서 올려 주세요.':x.status===401||x.status===0||!r?'올리지 못했어요. 로그인이 풀렸거나 연결이 끊겼을 수 있어요. 페이지를 새로 고쳐 주세요.':'올리지 못했어요.');setSt(b.row,m,'bad');badCount++}
    });
    busy=false;pump();
  };
  x.onerror=function(){batch.forEach(function(b){setSt(b.row,'연결이 끊겨서 올리지 못했어요. 다시 올려 주세요.','bad');badCount++});busy=false;pump()};
  x.send(fd);
}
function finish(){
  if(!okCount&&!badCount)return;
  var sum=document.getElementById('upsum');sum.hidden=false;sum.className='notice'+(badCount?' warn':'');
  sum.textContent=(okCount?okCount+'개를 올렸어요. ':'')+(badCount?badCount+'개는 올리지 못했어요. ':'');
  if(okCount&&!badCount){setTimeout(function(){location.reload()},900)}
  else if(okCount){var a=el('a','btn small','목록 새로 고침');a.href=location.href;a.style.marginLeft='8px';sum.appendChild(a)}
  okCount=0;badCount=0;
}
window.addEventListener('beforeunload',function(e){if(busy||queue.length){e.preventDefault();e.returnValue=''}});
function fromInput(inp){var out=[];Array.prototype.forEach.call(inp.files,function(f){out.push({file:f,path:f.webkitRelativePath||f.name})});inp.value='';if(out.length)enqueue(out)}
pick.addEventListener('change',function(){fromInput(pick)});
if(pickDir)pickDir.addEventListener('change',function(){fromInput(pickDir)});
function readAll(reader,cb,acc){reader.readEntries(function(r){if(!r.length)cb(acc);else readAll(reader,cb,acc.concat(Array.prototype.slice.call(r)))},function(){cb(acc)})}
function walk(entry,prefix,out,cb){
  if(entry.isFile)entry.file(function(f){out.push({file:f,path:prefix+f.name});cb()},function(){cb()});
  else if(entry.isDirectory)readAll(entry.createReader(),function(kids){var i=0;(function next(){if(i>=kids.length)return cb();walk(kids[i++],prefix+entry.name+'/',out,next)})()},[]);
  else cb();
}
['dragenter','dragover'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.add('over')})});
['dragleave','drop'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.remove('over')})});
drop.addEventListener('drop',function(e){
  var dt=e.dataTransfer;if(!dt)return;
  var items=dt.items,entries=[];
  if(items&&items.length&&items[0].webkitGetAsEntry){for(var i=0;i<items.length;i++){var en=items[i].webkitGetAsEntry();if(en)entries.push(en)}}
  if(entries.length){var out=[],k=0;(function next(){if(k>=entries.length){if(out.length)enqueue(out);return}walk(entries[k++],'',out,next)})()}
  else{var fs=[];Array.prototype.forEach.call(dt.files,function(f){fs.push({file:f,path:f.name})});if(fs.length)enqueue(fs)}
});
})();`

function Crumbs(p: { path: string; me: string }) {
  const segs = p.path ? p.path.split('/') : []
  return (
    <nav class="crumbs" aria-label="폴더 위치">
      {segs.length ? <a href="/files">전체</a> : <b>전체</b>}
      {segs.map((_, i) => {
        const to = segs.slice(0, i + 1).join('/')
        return <>{'›'}{i === segs.length - 1 ? <b>{folderLabel(to, p.me)}</b> : <a href={hrefFor(to)}>{folderLabel(to, p.me)}</a>}</>
      })}
    </nav>
  )
}

const NotFound = (p: { c: C }) => (
  <Shell c={p.c} title="찾을 수 없어요" active="/files">
    <h1>찾을 수 없어요</h1>
    <p class="lead">없는 폴더이거나, 볼 수 있는 권한이 없어요.</p>
    <a class="btn" href="/files">회사 파일 처음으로</a>
  </Shell>
)
const notFound = (c: C) => render(c, <NotFound c={c} />, 404)

/** Sorted for the list: folders first, then files, each by name (Korean order). */
const sorted = (entries: ListEntry[]) => [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'folder' ? -1 : 1))

function FilesPage(p: { web: Web; c: C; s: SessionAuth; path: string; svc: FileService; flashes: Flash[] }) {
  const { s, path } = p
  const listing = p.svc.list(path)
  const here = listing.path
  const entries = sorted(listing.entries)
  const folders = entries.filter((e) => e.type === 'folder').length
  const canWrite = !listing.readOnly
  const personal = `users/${s.user.id}`
  return (
    <Shell c={p.c} title="회사 파일" active="/files" flashes={p.flashes}>
      <style>{raw(STYLE)}</style>
      <h1>회사 파일</h1>
      <p class="lead">회사 폴더의 파일을 보고, 올리고, 내려받아요. 내가 볼 수 있는 폴더만 보여요. 직원 PC의 Claude도 같은 파일을 같은 권한으로 써요.</p>
      <Crumbs path={here} me={s.user.id} />

      {canWrite ? (
        <>
          <form id="up" class="card" method="post" action="/files/upload" enctype="multipart/form-data">
            <h2>파일 올리기</h2>
            <Csrf token={s.csrf} />
            <input type="hidden" name="dir" value={here} />
            <div id="drop" class="drop">
              <b>여기에 파일이나 폴더를 끌어다 놓으세요</b>
              <input id="pick" type="file" name="files" multiple required aria-label="올릴 파일 고르기" />
              <div id="dirwrap" class="alt" hidden>
                <label class="btn small" for="pickdir">폴더째 올리기</label>
                <input id="pickdir" type="file" webkitdirectory hidden />
              </div>
            </div>
            <label class="checkline"><input type="checkbox" name="overwrite" value="1" /> <span>같은 이름의 파일이 있으면 새 파일로 바꿔요. 바뀌기 전 파일은 90일 동안 남고, 관리자가 되살릴 수 있어요.</span></label>
            <p class="muted small" style="margin:0 0 10px">한 파일은 {UPLOAD_FILE_MAX / MB}MB까지, 한 번에 {UPLOAD_REQUEST_MAX / MB}MB까지 올릴 수 있어요. 같은 이름이 있으면 그 파일은 건너뛰어요.</p>
            <button id="upgo" class="btn primary" type="submit">올리기</button>
            <div id="upsum" class="notice" role="status" hidden style="margin:12px 0 0"></div>
            <ul id="uplist" class="uplist" aria-live="polite"></ul>
          </form>
          <script>{raw(UPLOAD_JS)}</script>
          <div class="bar2">
            <span class="muted small">폴더 {folders}개 · 파일 {entries.length - folders}개</span>
            <form class="newfolder" method="post" action="/files/folder">
              <Csrf token={s.csrf} />
              <input type="hidden" name="dir" value={here} />
              <input name="name" placeholder="새 폴더 이름" required maxlength={80} autocomplete="off" aria-label="새 폴더 이름" />
              <button class="btn" type="submit">새 폴더</button>
            </form>
          </div>
        </>
      ) : (
        <div class="bar2">
          <span class="muted small">폴더 {folders}개 · 파일 {entries.length - folders}개</span>
          {here ? <span class="badge">읽기만 할 수 있어요</span> : null}
        </div>
      )}

      {!here && !s.user.noPersonal ? (
        <div class="notice">
          <b>내 폴더</b>는 나만 볼 수 있는 폴더예요. <a href={hrefFor(personal)}>내 폴더 열기</a>
        </div>
      ) : null}

      {entries.length ? (
        <div class="tablewrap"><table class="files">
          <thead><tr><th>이름</th><th class="hide-sm num">크기</th><th class="hide-sm">고친 시간</th><th class="hide-sm">고친 사람</th><th></th></tr></thead>
          <tbody>{entries.map((e) => {
            const who = e.type === 'file' ? lastChange(p.web.ctx.db, e.path, e.mtimeMs) : null
            const when = fmtDateTime(new Date(e.mtimeMs).toISOString())
            return (
              <tr>
                <td class="name" style="word-break:break-word">
                  {e.type === 'folder'
                    ? <a href={hrefFor(e.path)}>📁 {folderLabel(e.path, s.user.id)}</a>
                    : <a href={downloadHref(e.path)}>📄 {e.name}</a>}
                  {e.readOnly && e.type === 'folder' && e.path !== 'users' ? <> <span class="badge">읽기만</span></> : null}
                  <div class="meta2 show-sm">{e.type === 'file' ? `${fmtSize(e.size ?? 0)} · ` : ''}{when}{who?.userName ? ` · ${who.userName}` : ''}</div>
                </td>
                <td class="hide-sm num" style="white-space:nowrap">{e.type === 'file' ? fmtSize(e.size ?? 0) : '—'}</td>
                <td class="hide-sm" style="white-space:nowrap">{when}</td>
                <td class="hide-sm">{who?.userName ?? <span class="muted">—</span>}</td>
                <td class="fa">
                  {e.type === 'file' ? <a class="btn small dl" href={downloadHref(e.path, true)}>내려받기</a> : null}
                  {!e.readOnly && e.path !== 'users' && e.path !== personal ? <a class="btn small" href={itemHref(e.path)}>관리</a> : null}
                </td>
              </tr>
            )
          })}</tbody>
        </table></div>
      ) : <Empty title="비어 있어요">{canWrite ? '위에서 파일을 올리거나 새 폴더를 만들어 보세요.' : here ? '이 폴더에는 볼 수 있는 파일이 없어요.' : '아직 볼 수 있는 폴더가 없어요. 관리자에게 물어봐 주세요.'}</Empty>}
      {listing.truncated ? <p class="muted small">목록이 길어서 일부만 보여요. 폴더를 나눠 정리하면 다 볼 수 있어요.</p> : null}
    </Shell>
  )
}

function ItemPage(p: { c: C; s: SessionAuth; svc: FileService; entry: ListEntry; flashes: Flash[] }) {
  const { entry: e, s } = p
  const me = s.user.id
  const isFolder = e.type === 'folder'
  const parent = parentOf(e.path)
  const who = !isFolder ? lastChange(p.svc.ctx.db, e.path, e.mtimeMs) : null
  const targets = p.svc.writableFolders().filter((f) => f !== parent && !(isFolder && (f === e.path || f.startsWith(e.path + '/'))))
  return (
    <Shell c={p.c} title={e.name} active="/files" flashes={p.flashes}>
      <style>{raw(STYLE)}</style>
      <Crumbs path={parent} me={me} />
      <h1 style="word-break:break-word">{isFolder ? '📁' : '📄'} {folderLabel(e.path, me)}</h1>
      <div class="card">
        <dl class="kv">
          <dt>종류</dt><dd>{isFolder ? '폴더' : '파일'}</dd>
          {!isFolder ? <><dt>크기</dt><dd>{fmtSize(e.size ?? 0)}</dd></> : null}
          <dt>고친 시간</dt><dd>{fmtDateTime(new Date(e.mtimeMs).toISOString())}</dd>
          {who?.userName ? <><dt>고친 사람</dt><dd>{who.userName}</dd></> : null}
          <dt>위치</dt><dd>{parent ? <a href={hrefFor(parent)}>{parent}</a> : <a href="/files">전체</a>}</dd>
        </dl>
        {!isFolder ? <p style="margin:14px 0 0"><a class="btn primary" href={downloadHref(e.path, true)}>내려받기</a></p> : null}
      </div>

      <div class="card manage">
        <h2>이름 바꾸기</h2>
        <form method="post" action="/files/rename">
          <Csrf token={s.csrf} />
          <input type="hidden" name="path" value={e.path} />
          <div class="row">
            <div class="field"><label for="newname">새 이름</label><input id="newname" name="name" value={e.name} required maxlength={120} autocomplete="off" /></div>
            <div><button class="btn" type="submit" style="margin-bottom:12px">바꾸기</button></div>
          </div>
        </form>
        {!isFolder ? <p class="muted small" style="margin:0">끝의 확장자(.xlsx, .pdf 같은 부분)는 그대로 두세요. 파일 종류가 달라지는 이름으로는 바꿀 수 없어요.</p> : null}
      </div>

      <div class="card manage">
        <h2>다른 폴더로 옮기기</h2>
        {targets.length ? (
          <form method="post" action="/files/move">
            <Csrf token={s.csrf} />
            <input type="hidden" name="path" value={e.path} />
            <div class="row">
              <div class="field"><label for="dest">옮길 폴더</label>
                <select id="dest" name="to">{targets.map((t) => <option value={t}>{t === '' ? '맨 위 (전체)' : t === `users/${me}` ? '내 폴더' : t}</option>)}</select></div>
              <div><button class="btn" type="submit" style="margin-bottom:12px">옮기기</button></div>
            </div>
          </form>
        ) : <p class="muted" style="margin:0">옮길 수 있는 다른 폴더가 없어요. 쓰기 권한이 있는 폴더로만 옮길 수 있어요.</p>}
      </div>

      <div class="card manage danger">
        <h2>지우기</h2>
        <p style="margin-top:0">{isFolder ? '비어 있는 폴더만 지울 수 있어요.' : '지운 파일은 휴지통으로 가요. 90일 동안은 관리자가 되살릴 수 있어요.'}</p>
        <ButtonForm action="/files/delete" csrf={s.csrf} label="지우기" danger small={false} hidden={{ path: e.path }}
          confirm={`'${e.name}' ${isFolder ? '폴더를' : '파일을'} 지울까요?`} />
      </div>
      <p><a href={hrefFor(parent)}>← 돌아가기</a></p>
    </Shell>
  )
}

const noStore: MiddlewareHandler<AppEnv> = async (c, next) => { await next(); c.header('cache-control', 'no-store') }

export function mountFiles(app: App, web: Web) {
  const { ctx } = web
  const guard = pageGuard(web)
  // session login only; a script that lost its session gets JSON instead of the login page
  const filesGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!c.get('session') && (c.req.header('accept') ?? '').includes('application/json')) {
      return jsonError(401, 'unauthorized', '로그인이 풀렸어요. 페이지를 새로 고쳐 다시 로그인해 주세요.')
    }
    return guard(c, next)
  }
  // '/files/*' covers '/files' too
  app.use('/files/*', noStore) // first, so that the login redirect is no-store too
  app.use('/files/*', sessionMiddleware(ctx))
  app.use('/files/*', filesGuard)

  const svcOf = (s: SessionAuth) => new FileService(ctx, s.user, 'web')
  const event = (s: SessionAuth, tool: string, summary: string, ok: boolean) =>
    recordToolEvent(ctx, s.user.id, null, `web:${tool}`, { summary: `웹 · ${summary}`, isError: !ok })

  // ---- the list ----
  app.get('/files', (c) => {
    const s = c.get('session')!
    const svc = svcOf(s)
    const path = (c.req.query('path') ?? '').trim()
    // a person's own folder is made the first time they open it
    if (path === `users/${s.user.id}` && !s.user.noPersonal) { try { svc.makeFolder(path) } catch { /* shown as not found below */ } }
    try {
      return render(c, <FilesPage web={web} c={c} s={s} path={path} svc={svc} flashes={takeFlashes(web, c)} />)
    } catch (e) {
      if (e instanceof ToolError && e.code === 'not_folder') return c.redirect(hrefFor(parentOf(path)), 302)
      const d = describeFileError(e)
      if (d.kind === 'hidden' || d.kind === 'name' || d.kind === 'unsafe') return notFound(c)
      throw e
    }
  })

  // ---- one file or folder ----
  app.get('/files/item', (c) => {
    const s = c.get('session')!
    const svc = svcOf(s)
    const entry = svc.entry((c.req.query('path') ?? '').trim())
    if (!entry || entry.readOnly) return notFound(c)
    return render(c, <ItemPage c={c} s={s} svc={svc} entry={entry} flashes={takeFlashes(web, c)} />)
  })

  // ---- download ----
  app.get('/files/download', (c) => {
    const s = c.get('session')!
    const svc = svcOf(s)
    const input = (c.req.query('path') ?? '').trim()
    let f: ReturnType<FileService['openDownload']>
    try { f = svc.openDownload(input) } catch (e) {
      if (e instanceof ToolError && e.code === 'is_folder') return c.redirect(hrefFor(input), 302)
      return notFound(c) // hidden, missing, a link, a hard link: all the same answer
    }
    const head = Buffer.alloc(16)
    let n = 0
    try { n = fs.readSync(f.fd, head, 0, 16, 0) } catch { /* an empty or unreadable file: saved, not opened */ }
    const preview = c.req.query('dl') === '1' ? null : previewType(f.name, head.subarray(0, n))
    event(s, 'download', `${f.rel} -> ${fmtSize(f.size)}`, true)
    const headers: Record<string, string> = {
      'content-type': preview ?? 'application/octet-stream',
      'content-length': String(f.size),
      'content-disposition': contentDisposition(f.name, preview ? 'inline' : 'attachment'),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    }
    // nothing a downloaded file contains may run on this site (a PDF is shown by the browser's own viewer, which a
    // sandboxed page would break)
    if (preview !== 'application/pdf') headers['content-security-policy'] = "default-src 'none'; sandbox"
    if (c.req.method === 'HEAD') { fs.closeSync(f.fd); return new Response(null, { headers }) }
    return new Response(fdStream(f.fd, f.size), { headers })
  })

  // ---- upload ----
  app.post('/files/upload', async (c) => {
    const s = c.get('session')!
    const boundary = boundaryOf(c.req.header('content-type'))
    const wantsJson = (c.req.header('accept') ?? '').includes('application/json')
    const body = c.req.raw.body
    const refuse = (status: number, message: string) => {
      if (wantsJson) return c.json({ ok: false, error: { code: 'refused', message }, items: [] }, status as 400)
      say(web, s, 'bad', message)
      return c.redirect(hrefFor(safeDir(c.req.query('path'))), 303)
    }
    if (!boundary || !body) {
      if (body) await drainBody(body, c.req.raw.signal)
      return refuse(400, '올릴 파일이 없어요. 파일을 고른 뒤 올려 주세요.')
    }
    const header = c.req.header('x-csrf-token')
    const svc = svcOf(s)
    let outcome
    try {
      outcome = await receiveUpload(svc, {
        stream: body, boundary, dir: c.req.query('path') ?? null, signal: c.req.raw.signal,
        csrfOk: (v) => csrfOk(s, v), csrfGiven: header !== undefined && csrfOk(s, header),
      })
    } catch (e) {
      if (e instanceof UploadRefused) {
        event(s, 'upload', `-> refused (${e.code})`, false)
        if (e.code === 'csrf' && !wantsJson) return csrfRefused(c)
        return refuse(e.status, e.message)
      }
      throw e
    }
    return finishUpload(c, s, outcome.dir, outcome.items, outcome.bytes, wantsJson)
  })

  function finishUpload(c: C, s: SessionAuth, dir: string, items: UploadItem[], bytes: number, wantsJson: boolean) {
    const ok = items.filter((i) => i.status !== 'error')
    const bad = items.filter((i) => i.status === 'error')
    for (const i of items) {
      event(s, 'upload', i.status === 'error' ? `${dir ? dir + '/' : ''}${i.name} -> ${i.kind}` : `${i.path} -> ${i.status} ${fmtSize(i.size ?? 0)}`, i.status !== 'error')
    }
    if (ok.length) {
      const personal = ok.every((i) => i.path?.startsWith('users/'))
      audit(ctx.db, {
        actor: s.user.id, action: 'file.upload', target: personal ? publicPath(ok[0]!.path!) : dir || '/',
        detail: {
          via: 'web', files: ok.length, replaced: ok.filter((i) => i.status === 'replaced').length, failed: bad.length, bytes,
          ...(personal ? {} : { paths: ok.slice(0, 20).map((i) => publicPath(i.path!)) }),
        },
      })
    }
    if (wantsJson) {
      const status = ok.length || !bad.length ? 200 : bad[0]!.httpStatus ?? 400
      return c.json({ ok: ok.length > 0 || bad.length === 0, dir, items, bytes }, status as 200)
    }
    const made = ok.filter((i) => i.status === 'created').length
    const replaced = ok.filter((i) => i.status === 'replaced').length
    const same = ok.filter((i) => i.status === 'unchanged').length
    if (ok.length) {
      say(web, s, 'ok', `${made + replaced}개를 올렸어요.${replaced ? ` 그중 ${replaced}개는 같은 이름의 파일을 새 파일로 바꿨어요. 이전 파일은 90일 동안 남아요.` : ''}${same ? ` ${same}개는 똑같은 파일이라 그대로 뒀어요.` : ''}`)
    }
    for (const i of bad.slice(0, 5)) say(web, s, 'bad', `${i.name}: ${i.message}${i.kind === 'exists' ? ' 바꾸려면 "새 파일로 바꿔요"를 고르고 다시 올려 주세요.' : ''}`)
    if (bad.length > 5) say(web, s, 'bad', `…외 ${bad.length - 5}개도 올리지 못했어요.`)
    if (!items.length) say(web, s, 'warn', '올린 파일이 없어요.')
    return c.redirect(hrefFor(safeDir(dir)), 303)
  }

  // ---- forms ----
  /** Run a form action for the logged-in person: CSRF checked, errors shown in Korean, then back to `back`. */
  async function formAct(c: C, back: (form: Record<string, string | string[]>) => string,
    fn: (form: Record<string, string | string[]>, s: SessionAuth, svc: FileService) => string | Promise<string>) {
    let parsed
    try { parsed = await sessionForm(c) } catch (e) { if (e instanceof CsrfError) return csrfRefused(c); throw e }
    const { form, session } = parsed
    try {
      return c.redirect(await fn(form, session, svcOf(session)), 303)
    } catch (e) {
      const d = describeFileError(e)
      if (d.kind === 'other' && d.status === 500) throw e
      say(web, session, 'bad', d.text)
      return c.redirect(back(form), 303)
    }
  }

  app.post('/files/folder', (c) => formAct(c, (f) => hrefFor(safeDir(field(f, 'dir'))), (f, s, svc) => {
    const dir = safeDir(field(f, 'dir'))
    const name = field(f, 'name').normalize('NFC')
    const next = safeNext(field(f, 'next'))
    const back = next && (next.startsWith('/admin/folders') || next.startsWith('/files')) ? next : hrefFor(dir)
    if (!name) { say(web, s, 'bad', '폴더 이름을 적어 주세요.'); return back }
    if (name.includes('/') || name.includes('\\')) { say(web, s, 'bad', '이름에 / 나 \\ 는 쓸 수 없어요. 폴더 안의 폴더는 그 폴더를 연 다음 만들어 주세요.'); return back }
    const rel = dir ? `${dir}/${name}` : name
    try {
      const r = svc.makeFolder(rel)
      event(s, 'make_folder', `${r.path} -> ${r.created ? 'created' : 'exists'}`, true)
      if (r.created) {
        audit(ctx.db, { actor: s.user.id, action: 'folder.create', target: publicPath(r.path), detail: { via: 'web' } })
        say(web, s, 'ok', `'${name}' 폴더를 만들었어요.`)
      } else say(web, s, 'warn', `'${name}' 폴더는 이미 있어요.`)
    } catch (e) {
      event(s, 'make_folder', `${rel} -> failed`, false)
      throw e
    }
    return back
  }))

  app.post('/files/rename', (c) => formAct(c, (f) => itemHref(field(f, 'path')), (f, s, svc) => {
    const from = field(f, 'path')
    const name = field(f, 'name').normalize('NFC')
    if (!from) throw new ToolError('missing path', 'invalid')
    if (!name) { say(web, s, 'bad', '새 이름을 적어 주세요.'); return itemHref(from) }
    if (name.includes('/') || name.includes('\\')) { say(web, s, 'bad', '이름에 / 나 \\ 는 쓸 수 없어요. 다른 폴더로 옮기려면 "다른 폴더로 옮기기"를 쓰세요.'); return itemHref(from) }
    const parent = parentOf(from)
    return moveTo(s, svc, from, parent ? `${parent}/${name}` : name, '이름을 바꿨어요.')
  }))

  app.post('/files/move', (c) => formAct(c, (f) => itemHref(field(f, 'path')), (f, s, svc) => {
    const from = field(f, 'path')
    const dest = field(f, 'to').replace(/^\/+|\/+$/g, '')
    if (!from) throw new ToolError('missing path', 'invalid')
    return moveTo(s, svc, from, dest ? `${dest}/${baseName(from)}` : baseName(from), '옮겼어요.')
  }))

  function moveTo(s: SessionAuth, svc: FileService, from: string, to: string, done: string): string {
    try {
      const r = svc.move(from, to)
      event(s, 'move', `${r.from} -> ${r.to}`, true)
      if (r.from === r.to) { say(web, s, 'warn', '바뀐 게 없어요.'); return itemHref(r.to) }
      audit(ctx.db, { actor: s.user.id, action: 'file.move', target: publicPath(r.from), detail: { via: 'web', to: publicPath(r.to), type: r.type } })
      say(web, s, 'ok', done)
      return hrefFor(parentOf(r.to))
    } catch (e) {
      event(s, 'move', `${from} -> failed`, false)
      throw e
    }
  }

  app.post('/files/delete', (c) => formAct(c, (f) => itemHref(field(f, 'path')), (f, s, svc) => {
    const p = field(f, 'path')
    if (!p) throw new ToolError('missing path', 'invalid')
    try {
      const r = svc.remove(p)
      event(s, 'delete', `${r.path} -> ${r.type === 'file' ? 'trash' : 'folder removed'}`, true)
      audit(ctx.db, { actor: s.user.id, action: 'file.delete', target: publicPath(r.path), detail: { via: 'web', type: r.type } })
      say(web, s, 'ok', r.type === 'file' ? `'${baseName(r.path)}' 파일을 지웠어요. 휴지통에 90일 동안 남아요.` : `'${baseName(r.path)}' 폴더를 지웠어요.`)
      return hrefFor(parentOf(r.path))
    } catch (e) {
      event(s, 'delete', `${p} -> failed`, false)
      throw e
    }
  }))
}

/** A folder path from a form or URL, for going back to it: a plain relative path or nothing. */
function safeDir(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().normalize('NFC') : ''
  return t && !t.includes('\0') && !t.includes('\\') && !t.startsWith('/') && !t.split('/').some((x) => x === '..') ? t : ''
}
