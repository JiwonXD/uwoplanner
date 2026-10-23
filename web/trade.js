// Trade assistant chat. Sends the conversation to the Worker named in <meta name="trade-api"> and renders
// the streamed answer. The conversation lives in this tab only (sessionStorage).
const $ = s => document.querySelector(s);
const API = document.querySelector('meta[name="trade-api"]')?.content.trim().replace(/\/$/, '') || '';
const KEY = 'uwo-trade-chat';
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let messages = load(), busy = false;

function load() { try { const m = JSON.parse(sessionStorage.getItem(KEY)); return Array.isArray(m) ? m : []; } catch { return []; } }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(messages)); } catch { /* private mode */ } }

// Minimal formatting for answers: paragraphs, "- " lists and **bold**. Everything is escaped first.
function format(text) {
  const inline = s => escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; } };
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) { list.push(item[1]); continue; }
    flush();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}
function render() {
  $('#chat-log').innerHTML = messages.map(m => `<div class="msg ${m.role}">${m.role === 'user' ? `<p>${escape(m.content)}</p>` : format(m.content) || '<p class="typing">…</p>'}</div>`).join('')
    || '<p class="chat-empty">대유행이나 부양 일정, 도시를 말해 주면 팔 교역품을 알려 드려요.</p>';
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}
function setBusy(value) { busy = value; $('#chat-send').disabled = value || !API; $('#chat-input').disabled = !API; }

async function ask(question) {
  messages.push({role: 'user', content: question}, {role: 'assistant', content: ''});
  const answer = messages[messages.length - 1];
  render(); setBusy(true);
  try {
    const res = await fetch(`${API}/chat`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({messages: messages.slice(0, -1)})});
    if (!res.ok || !res.body) { const err = await res.json().catch(() => ({})); throw Error(err.error || '답변을 받지 못했어요.'); }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      buffer += value;
      const events = buffer.split('\n\n'); buffer = events.pop();
      for (const event of events) {
        const data = event.replace(/^data: /, '');
        let parsed; try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.text) { answer.content += parsed.text; render(); }
        if (parsed.error) throw Error(parsed.error);
      }
    }
    if (!answer.content) throw Error('답변이 비어 있어요. 다시 물어봐 주세요.');
  } catch (error) {
    messages.splice(-2, 2); // drop the failed turn so the next request stays a clean user/assistant history
    render();
    $('#chat-log').insertAdjacentHTML('beforeend', `<p class="chat-error">${escape(error.message || '연결에 실패했어요.')}</p>`);
    $('#chat-input').value = question;
  } finally {
    save(); setBusy(false); $('#chat-input').focus();
  }
}

$('#chat-form').onsubmit = e => {
  e.preventDefault();
  const question = $('#chat-input').value.trim();
  if (!question || busy || !API) return;
  $('#chat-input').value = ''; resize();
  ask(question);
};
$('#chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); }
});
function resize() { const t = $('#chat-input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px`; }
$('#chat-input').addEventListener('input', resize);
$('#chat-reset').onclick = () => { messages = []; save(); render(); };

if (!API) { $('#chat-input').placeholder = '도우미 서버 연결 준비 중이에요'; }
render(); setBusy(false);
