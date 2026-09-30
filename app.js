'use strict';
/* =================================================================
   PONTO DO GRUPO DE ESTUDOS – APP
   Não é preciso alterar este arquivo. O link do servidor fica em config.js
   ================================================================= */

const SERVIDOR = String(window.SERVIDOR || '').trim();
const FACE_JS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const MODELOS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
};

const st = {
  token: LS.get('token'),
  dados: null,
  timer: null,
  admin: { senha: LS.get('senhaCoord') || null, dados: null, aba: 'agora', filtroAtiv: 'abertas', mes: null, rel: null }
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const espera = ms => new Promise(r => setTimeout(r, ms));
const app = () => $('#app');

/* ------------------------- formatação ------------------------- */
const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
const diaSem = iso => iso ? DIAS[new Date(iso).getDay()].slice(0, 3) : '';
function fh(h) {
  if (h == null || isNaN(h)) return '–';
  const m = Math.round(Number(h) * 60);
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}
function desde(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}
const iniciais = n => String(n || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
function pctClasse(p) { return p == null ? '' : p >= 90 ? 'bom' : p >= 70 ? 'medio' : 'ruim'; }

/* ------------------------- comunicação ------------------------- */
function erroRede(msg) { const e = new Error(msg); e.rede = true; return e; }
async function api(acao, dados = {}, opts = {}) {
  if (!SERVIDOR || SERVIDOR.indexOf('COLE_AQUI') >= 0) throw new Error('O link do servidor ainda não foi colocado no arquivo config.js.');
  if (navigator.onLine === false) throw erroRede('Você está sem internet. Vá para um lugar com sinal e tente de novo.');
  const ctl = window.AbortController ? new AbortController() : null;
  const limite = setTimeout(() => ctl && ctl.abort(), opts.tempo || 40000);
  let r, j;
  try {
    r = await fetch(SERVIDOR, { method: 'POST', body: JSON.stringify(Object.assign({ acao }, dados)), signal: ctl ? ctl.signal : undefined });
    j = await r.json();
  } catch (e) {
    throw erroRede(e && e.name === 'AbortError'
      ? 'A internet está muito lenta e o servidor não respondeu. Tente de novo num lugar com sinal melhor.'
      : 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  } finally { clearTimeout(limite); }
  if (!j.ok) {
    const err = new Error(String(j.erro || 'Erro').replace(/^TOKEN:\s*/, ''));
    err.token = String(j.erro || '').indexOf('TOKEN:') === 0;
    throw err;
  }
  return j.dados;
}

/* ------------------------- dados guardados no celular (uso sem internet) ------------------------- */
function lerJSON(k) { try { return JSON.parse(LS.get(k) || 'null'); } catch (e) { return null; } }
function salvarCache(d) { const c = Object.assign({}, d); delete c._offline; LS.set('cacheStatus', JSON.stringify({ token: st.token, dados: c })); }
function lerCache() { const c = lerJSON('cacheStatus'); return c && c.token === st.token ? c.dados : null; }
const chaveSessao = ab => ab ? dataCurta(ab.entrada) + ' ' + hora(ab.entrada) : '';
function lerRasc(ab) {
  const r = lerJSON('rascunhoSaida');
  const ok = r && r.sessao === chaveSessao(ab) ? r : { sessao: chaveSessao(ab), feitas: [], obs: '' };
  ok.terminou = ok.terminou || [];
  return ok;
}

/* ------------------------- ponto sem internet ------------------------- */
const Fila = {
  ler() { return lerJSON('filaPontos') || []; },
  salvar(f) { LS.set('filaPontos', JSON.stringify(f)); },
  add(it) { const f = this.ler(); f.push(it); this.salvar(f); }
};
function offsetRelogio() { const v = LS.get('offsetRelogio'); return v === null || !isFinite(Number(v)) ? null : Number(v); }
function guardaRelogio(servidorAgora) { if (servidorAgora && isFinite(servidorAgora)) LS.set('offsetRelogio', String(servidorAgora - Date.now())); }
function novoUid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
function distM(la1, lo1, la2, lo2) {
  const R = 6371000, rad = Math.PI / 180, dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Confere rosto e local no próprio celular (o servidor confere de novo quando o ponto chegar)
function conferirNoCelular(desc, loc, off) {
  if (!off) throw new Error('Sem internet. Abra o app uma vez com internet para liberar o ponto offline.');
  if (!off.permitido) throw new Error('Sem internet, e o ponto offline está desativado pelo coordenador. Vá para um lugar com sinal.');
  if (!off.rosto || !off.rosto.length) throw new Error('Sem internet. Abra o app uma vez com internet para liberar o ponto offline.');
  const dist = Math.min.apply(null, off.rosto.map(r => Math.sqrt(r.reduce((s, v, i) => s + (v - desc[i]) * (v - desc[i]), 0))));
  if (dist > off.limiar) throw new Error('Rosto não reconhecido. Tente em um lugar mais iluminado, de frente para a câmera.');
  let melhor = null;
  (off.locais || []).forEach(l => {
    const d = Math.round(distM(loc.lat, loc.lng, l.lat, l.lng));
    if (!melhor || d - l.raio < melhor.folga) melhor = { folga: d - l.raio, nome: l.nome, dist: d };
  });
  if (off.exigirLocal) {
    if (!melhor) throw new Error('Nenhum local cadastrado pelo coordenador.');
    if (melhor.folga > 0) throw new Error('Você está a ' + melhor.dist + ' m de "' + melhor.nome + '". Bata o ponto dentro do setor.');
  }
  return melhor && melhor.folga <= 0 ? melhor.nome : '';
}
function aplicarFila(d) {
  Fila.ler().forEach(it => {
    const h = new Date(it.horaCelular + (it.offsetAntes || 0)).toISOString();
    d.aberto = it.tipo === 'entrada' ? { entrada: h, local: it.local || '', offline: true } : null;
  });
  return d;
}
let sincronizando = null;
function sincronizar(silencioso) {
  if (sincronizando) return sincronizando;
  const fila = Fila.ler();
  if (!fila.length || !st.token) return Promise.resolve(null);
  sincronizando = (async () => {
    try {
      const r = await api('sincronizar', { token: st.token, celularAgora: Date.now(), itens: fila }, { tempo: 40000 });
      guardaRelogio(r.servidorAgora);
      const feitos = new Set(r.resultados.map(x => x.uid));
      Fila.salvar(Fila.ler().filter(it => !feitos.has(it.uid)));
      const recusados = r.resultados.filter(x => !x.ok);
      if (recusados.length) {
        const av = lerJSON('avisosPonto') || [];
        recusados.forEach(x => { const it = fila.find(f => f.uid === x.uid); av.push({ tipo: x.tipo, erro: x.erro, hora: it ? new Date(it.horaCelular + (it.offsetAntes || 0)).toISOString() : '' }); });
        LS.set('avisosPonto', JSON.stringify(av.slice(-10)));
      }
      const aceitos = r.resultados.filter(x => x.ok && !x.repetido).length;
      if (!silencioso || aceitos) toast(aceitos + ' ponto(s) guardado(s) enviado(s) ✓', 'ok');
      return r;
    } catch (e) {
      if (e.token) { sairDoCelular(); render(); }
      return null;
    } finally { sincronizando = null; }
  })();
  return sincronizando;
}
function podeRedesenhar() { return st.token && location.hash !== '#coordenador' && !$('.tela') && !$('.cam') && !$('.carregando'); }
window.addEventListener('online', () => { if (st.token && Fila.ler().length) sincronizar(true).then(r => { if (r && podeRedesenhar()) telaAluno(); }); });
setInterval(() => {
  if (st.token && Fila.ler().length && navigator.onLine !== false) sincronizar(true).then(r => { if (r && podeRedesenhar()) telaAluno(); });
}, 60000);
function salvarRasc(r) { LS.set('rascunhoSaida', JSON.stringify(r)); }

/* ------------------------- avisos e telas ------------------------- */
let toastT;
function toast(msg, tipo) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo || '');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 3500);
}
function carregando(msg) {
  $$('.carregando').forEach(e => e.remove());
  if (msg === false) return;
  const d = document.createElement('div');
  d.className = 'carregando';
  d.innerHTML = '<div class="giro"></div><div>' + esc(msg || 'Carregando…') + '</div>';
  document.body.appendChild(d);
}
function abrirTela(titulo, html, opts = {}) {
  const t = document.createElement('div');
  t.className = 'tela';
  t.innerHTML = '<div class="cab"><h3>' + esc(titulo) + '</h3>' + (opts.semFechar ? '' : '<button data-fechar>Fechar</button>') +
    '</div><div class="corpo">' + html + '</div>';
  document.body.appendChild(t);
  const f = $('[data-fechar]', t);
  if (f) f.onclick = () => { t.remove(); if (opts.aoFechar) opts.aoFechar(); };
  return t;
}
function fecharTelas() { $$('.tela').forEach(t => t.remove()); }
function confirmar(msg, sim = 'Confirmar', perigo = false) {
  return new Promise(res => {
    const t = abrirTela('Confirmar', '<p style="font-size:17px">' + esc(msg) + '</p><div class="linha-btn" style="margin-top:20px">' +
      '<button class="btn ' + (perigo ? 'verm' : '') + '" data-s>' + esc(sim) + '</button><button class="btn cinza" data-n>Cancelar</button></div>',
      { aoFechar: () => res(false) });
    $('[data-s]', t).onclick = () => { t.remove(); res(true); };
    $('[data-n]', t).onclick = () => { t.remove(); res(false); };
  });
}
async function acao(msg, fn) {
  carregando(msg);
  try { return await fn(); }
  catch (e) { toast(e.message, 'erro'); throw e; }
  finally { carregando(false); }
}

/* ------------------------- rosto (câmera) ------------------------- */
const Rosto = {
  prom: null,
  carregar() {
    if (!this.prom) {
      this.prom = (async () => {
        if (!window.faceapi) await carregaScript(FACE_JS);
        if (faceapi.tf && faceapi.tf.ready) await faceapi.tf.ready();
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS)
        ]);
      })().catch(e => { this.prom = null; throw e; });
    }
    return this.prom;
  }
};
function carregaScript(src) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => erro(new Error('falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}
function giroRosto(lm) {
  const p = lm.positions;
  const nariz = p[30], olhoE = p[36], olhoD = p[45];
  return (nariz.x - olhoE.x) / ((olhoD.x - olhoE.x) || 1);
}
function recorte(video, box) {
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const lado = Math.max(box.width, box.height) * 1.45;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  c.getContext('2d').drawImage(video, cx - lado / 2, cy - lado / 2, lado, lado, 0, 0, 120, 120);
  return c.toDataURL('image/jpeg', 0.7);
}

/* Abre a câmera, confere o rosto de frente e pede para virar (prova de que não é foto) */
function capturarRosto(modo) {
  const precisa = modo === 'cadastro' ? 3 : 1;
  const el = document.createElement('div');
  el.className = 'cam';
  el.innerHTML = '<div class="vid"><video playsinline muted autoplay></video><div class="guia"></div></div>' +
    '<div class="painel"><div class="msg">Abrindo a câmera…</div>' +
    '<div class="passos"><span data-p="1" class="on">1. Olhe de frente</span><span data-p="2">2. Vire o rosto</span></div>' +
    '<button class="btn cinza" data-cancelar>Cancelar</button></div>';
  document.body.appendChild(el);
  const video = $('video', el), msgEl = $('.msg', el), guia = $('.guia', el);
  const msg = t => { if (msgEl.textContent !== t) msgEl.textContent = t; };

  return new Promise(async (resolve, reject) => {
    let stream = null, fim = false;
    const sair = (err, val) => {
      if (fim) return;
      fim = true;
      if (stream) stream.getTracks().forEach(t => t.stop());
      el.remove();
      err ? reject(err) : resolve(val);
    };
    $('[data-cancelar]', el).onclick = () => sair(Object.assign(new Error('Cancelado'), { cancelado: true }));

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      return sair(new Error('Não foi possível abrir a câmera. Permita o acesso à câmera para este app nas configurações do celular.'));
    }
    if (fim) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* alguns celulares iniciam sozinhos */ }

    msg('Preparando o reconhecimento facial…');
    try { await Rosto.carregar(); } catch (e) {
      return sair(new Error('Não foi possível carregar o reconhecimento facial. Verifique a internet e tente de novo.'));
    }

    const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const descritores = [];
    let foto = '', fase = 1, ultimo = 0;
    const t0 = Date.now();

    while (!fim) {
      if (Date.now() - t0 > 45000) return sair(new Error('Tempo esgotado. Tente de novo em um lugar bem iluminado.'));
      if (video.readyState < 2 || !video.videoWidth) { await espera(150); continue; }
      let det = null;
      try {
        det = fase === 1
          ? await faceapi.detectSingleFace(video, opt).withFaceLandmarks().withFaceDescriptor()
          : await faceapi.detectSingleFace(video, opt).withFaceLandmarks();
      } catch (e) { det = null; }
      if (fim) return;
      if (!det) { guia.classList.remove('ok'); msg(fase === 1 ? 'Coloque o rosto dentro do contorno' : 'Vire o rosto devagar, sem sair do contorno'); await espera(100); continue; }

      const box = det.detection.box;
      const giro = giroRosto(det.landmarks);
      if (fase === 1) {
        if (box.width / video.videoWidth < 0.2) { guia.classList.remove('ok'); msg('Aproxime o rosto da câmera'); await espera(60); continue; }
        if (giro < 0.38 || giro > 0.62) { guia.classList.remove('ok'); msg('Olhe de frente para a câmera'); await espera(60); continue; }
        guia.classList.add('ok');
        if (Date.now() - ultimo < 350) { await espera(80); continue; }
        descritores.push(Array.from(det.descriptor).map(v => Math.round(v * 100000) / 100000));
        ultimo = Date.now();
        if (modo === 'cadastro' && !foto) foto = recorte(video, box);
        msg(precisa > 1 ? 'Segure assim… ' + descritores.length + '/' + precisa : 'Rosto encontrado');
        if (descritores.length >= precisa) {
          fase = 2;
          $('[data-p="1"]', el).className = 'feito';
          $('[data-p="2"]', el).className = 'on';
          msg('Agora vire o rosto devagar para um dos lados ↔');
        }
      } else {
        if (giro < 0.3 || giro > 0.7) {
          $('[data-p="2"]', el).className = 'feito';
          msg('Pronto! ✓');
          await espera(350);
          return sair(null, { descritores, foto });
        }
        await espera(60);
      }
    }
  });
}

/* ------------------------- localização ------------------------- */
function obterLocal() {
  return new Promise((ok, erro) => {
    if (!navigator.geolocation) return erro(new Error('Este celular não informa a localização.'));
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy) }),
      e => erro(new Error(e.code === 1
        ? 'Permita o acesso à localização para este app (o ponto só vale dentro do setor).'
        : 'Não foi possível pegar sua localização. Ligue o GPS e tente de novo.')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  });
}

/* ================================================================
   ROTEAMENTO
   ================================================================ */
function render() {
  clearInterval(st.timer);
  fecharTelas();
  if (location.hash === '#coordenador') return st.admin.senha ? telaAdmin() : telaLoginAdmin();
  if (!st.token) return telaAtivacao();
  return telaAluno();
}
window.addEventListener('hashchange', render);

function topo(titulo, sub, botao) {
  return '<header class="topo"><div style="flex:1;min-width:0"><h1>' + esc(titulo) + '</h1>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
    '</div>' + (botao || '') + '</header>';
}

/* ================================================================
   ALUNO – ATIVAÇÃO DO CELULAR
   ================================================================ */
async function telaAtivacao() {
  app().innerHTML = topo('Ponto do Grupo', 'Primeiro acesso') + '<main><div class="card"><div class="vazio">Carregando…</div></div></main>';
  let info;
  try { info = await api('info'); }
  catch (e) {
    app().innerHTML = topo('Ponto do Grupo') + '<main><div class="aviso erro">' + esc(e.message) + '</div><button class="btn" id="tentar">Tentar de novo</button>' + rodape() + '</main>';
    $('#tentar').onclick = render; ligaRodape(); return;
  }
  app().innerHTML = topo(info.grupo, 'Primeiro acesso neste celular') +
    '<main><div class="card"><h2>Quem é você?</h2><div class="campo busca"><input id="busca" placeholder="Digite seu nome" autocomplete="off"></div><div id="nomes"></div></div>' + rodape() + '</main>';
  const pinta = () => {
    const q = $('#busca').value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lista = info.alunos.filter(a => a.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
    $('#nomes').innerHTML = lista.length ? lista.map(a => '<button class="nome-item" data-id="' + esc(a.id) + '"><span class="avatar">' + esc(iniciais(a.nome)) + '</span><b>' + esc(a.nome) + '</b></button>').join('')
      : '<div class="vazio">Nome não encontrado. Peça ao coordenador para cadastrar você.</div>';
    $$('#nomes [data-id]').forEach(b => b.onclick = () => passoCodigo(info, info.alunos.find(a => a.id === b.dataset.id)));
  };
  $('#busca').oninput = pinta;
  pinta();
  ligaRodape();
}

function passoCodigo(info, aluno) {
  const t = abrirTela('Ativar celular',
    '<div class="card"><p style="margin-top:0">Olá, <b>' + esc(aluno.nome) + '</b>! Digite o <b>código de 6 números</b> que o coordenador te passou.</p>' +
    '<div class="campo"><input id="cod" class="codigo-in" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"></div>' +
    '<div class="aviso">Na próxima etapa a câmera vai abrir para cadastrar seu rosto. Fique num lugar iluminado, sem boné e sem óculos escuros.</div>' +
    '<button class="btn" id="seguir">Cadastrar meu rosto</button></div>');
  const inp = $('#cod', t);
  inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); };
  setTimeout(() => inp.focus(), 250);
  $('#seguir', t).onclick = async () => {
    if (inp.value.length !== 6) return toast('Digite os 6 números do código.', 'erro');
    let cap;
    try { cap = await capturarRosto('cadastro'); }
    catch (e) { if (!e.cancelado) toast(e.message, 'erro'); return; }
    try {
      const r = await acao('Enviando cadastro…', () => api('ativar', { alunoId: aluno.id, codigo: inp.value, rosto: cap.descritores, foto: cap.foto }));
      LS.set('token', r.token);
      st.token = r.token;
      toast('Cadastro enviado! ✓', 'ok');
      render();
    } catch (e) { /* toast já mostrado */ }
  };
}

/* ================================================================
   ALUNO – TELA PRINCIPAL
   ================================================================ */
async function telaAluno() {
  if (!st.dados) st.dados = lerCache();
  if (st.dados) mostrarAluno(st.dados, true);   // mostra na hora o que está guardado no celular
  else app().innerHTML = topo('Ponto do Grupo') + '<main><div class="card"><div class="vazio">Carregando…</div></div></main>';
  try {
    if (Fila.ler().length) await sincronizar(true);
    const d = await api('status', { token: st.token }, { tempo: 20000 });
    guardaRelogio(d.servidorAgora);
    d._salvoEm = Date.now();
    st.dados = aplicarFila(d);
    salvarCache(st.dados);
  } catch (e) {
    if (e.token) { sairDoCelular(); toast(e.message, 'erro'); return render(); }
    if (st.dados && e.rede) { st.dados._offline = true; return mostrarAluno(st.dados); }
    app().innerHTML = topo('Ponto do Grupo') + '<main><div class="aviso erro">' + esc(e.message) + '</div><button class="btn" id="tentar">Tentar de novo</button></main>';
    $('#tentar').onclick = render;
    return;
  }
  mostrarAluno(st.dados);
}
function mostrarAluno(d, atualizando) {
  if (d.aluno.rostoStatus !== 'Aprovado') return telaAguardando(d);
  pintaAluno(d, atualizando);
  Rosto.carregar().catch(() => {}); // deixa o reconhecimento facial pronto (fica guardado para usar sem internet)
}
function sairDoCelular() {
  ['token', 'cacheStatus', 'filaPontos', 'rascunhoSaida', 'avisosPonto', 'offsetRelogio'].forEach(k => LS.del(k));
  st.token = null; st.dados = null;
}

function telaAguardando(d) {
  app().innerHTML = topo(d.grupo, d.aluno.nome) +
    '<main><div class="card sucesso"><div class="icone">⏳</div><h2>Aguardando aprovação</h2>' +
    '<p>Seu rosto foi cadastrado. Assim que o coordenador aprovar, você já pode bater o ponto.</p></div>' +
    '<button class="btn" id="verificar">Verificar novamente</button>' + rodape() + '</main>';
  $('#verificar').onclick = () => { st.dados = null; render(); };
  ligaRodape();
}

function pintaAluno(d, atualizando) {
  const ab = d.aberto;
  const m = d.mes;
  const pctMes = m.planejado > 0 ? Math.min(100, Math.round(m.realizado / m.planejado * 100)) : 0;
  const hojeTxt = d.horarioHoje.length ? d.horarioHoje.map(h => h.inicio + '–' + h.fim).join(' e ') : 'Sem horário planejado hoje';
  const pend = d.pendentes;
  const fila = Fila.ler();
  const avisos = lerJSON('avisosPonto') || [];

  app().innerHTML = topo(d.grupo, 'Olá, ' + d.aluno.nome.split(' ')[0] + '!', '<button id="atualizar" aria-label="Atualizar">↻</button>') +
    '<main>' +
    (d._offline ? '<div class="aviso">📴 <b>Sem internet.</b> Mostrando as informações salvas em ' + dataCurta(d._salvoEm) + ' às ' + hora(d._salvoEm) + '. <a href="#" id="tentarNet">Tentar atualizar</a></div>'
      : atualizando ? '<div class="mini" style="text-align:center;margin:-4px 0 10px">Atualizando…</div>' : '') +
    (fila.length ? '<div class="aviso azul">⏳ <b>' + fila.length + ' ponto(s) guardado(s) no celular</b> esperando internet. Eles são enviados sozinhos quando o sinal voltar. <a href="#" id="enviarFila">Enviar agora</a></div>' : '') +
    (avisos.length ? '<div class="aviso erro"><b>Ponto(s) não aceito(s) pelo servidor:</b><ul style="margin:6px 0 6px 18px;padding:0">' +
      avisos.map(a => '<li>' + (a.tipo === 'saida' ? 'Saída' : 'Entrada') + ' de ' + dataCurta(a.hora || a.quando) + ' ' + hora(a.hora || a.quando) + ': ' + esc(a.erro) + '</li>').join('') +
      '</ul>Procure o coordenador se precisar corrigir. <a href="#" id="okAvisos">Entendi</a></div>' : '') +
    '<div class="card">' +
      '<div class="status ' + (ab ? 'dentro' : '') + '"><div class="bola"></div><div><b>' + (ab ? 'No setor desde ' + hora(ab.entrada) : 'Fora do setor') + '</b>' +
      '<span id="tempo">' + (ab ? 'Há ' + desde(ab.entrada) + (ab.local ? ' · ' + esc(ab.local) : '') + (ab.offline ? ' · sem internet' : '') : 'Hoje: ' + esc(hojeTxt)) + '</span></div></div>' +
      (ab ? '<button class="btn gigante saida" id="bater">Bater saída</button>' : '<button class="btn gigante" id="bater">Bater entrada</button>') +
    '</div>' +

    '<div class="card"><h2>Atividades <span class="dir"><button class="btn sec peq" id="novaAtiv">+ Nova</button></span></h2>' +
      (!pend.length ? '<div class="vazio">Nenhuma atividade em aberto 🎉</div>'
        : ab ? '<p class="mini" style="margin-top:0">Marque o que você trabalhou hoje. Funciona sem internet e é enviado junto com a sua saída. Quem dá a baixa final é o coordenador.</p>' + checklist(pend, lerRasc(ab))
        : '<ul class="lista">' + pend.map(itemAtividade).join('') + '</ul>') +
    '</div>' +

    '<div class="card"><h2>Meu mês</h2>' +
      '<div class="nums"><div><b>' + fh(m.realizado) + '</b><span>realizadas</span></div><div><b>' + fh(m.planejado) + '</b><span>planejadas até hoje</span></div>' +
      '<div><b class="pct ' + pctClasse(m.cumprimento) + '">' + (m.cumprimento == null ? '–' : m.cumprimento + '%') + '</b><span>no horário</span></div></div>' +
      '<div class="barra"><i style="width:' + pctMes + '%"></i></div>' +
      '<div class="mini">' + fh(m.noHorario) + ' dentro do seu horário · ' + fh(m.fora) + ' fora dele' +
        (m.aguardando ? ' · ' + fh(m.aguardando) + ' aguardando conferência' : '') +
        (m.faltas ? ' · <b style="color:var(--verm)">' + m.faltas + ' dia(s) sem ponto</b>' : '') + '</div>' +
    '</div>' +

    '<div class="card"><h2>Meu horário da semana</h2>' + gradeSemana(d.horarioSemana) + '</div>' +

    '<div class="card"><h2>Últimos pontos</h2>' +
      (d.historico.length ? '<ul class="lista">' + d.historico.map(p => '<li><div class="info"><div class="t">' + diaSem(p.entrada) + ' ' + dataCurta(p.entrada) + ' · ' + hora(p.entrada) + ' – ' + (p.saida ? hora(p.saida) : '…') + '</div>' +
        (p.atividades ? '<div class="m">✓ ' + esc(p.atividades) + '</div>' : '') + '</div>' + chipPonto(p) + '</li>').join('') + '</ul>'
        : '<div class="vazio">Nenhum ponto ainda.</div>') +
    '</div>' + rodape() + '</main>';

  $('#bater').onclick = ab ? () => fluxoSaida(d) : fluxoEntrada;
  if (ab) ligaChecklist(app(), ab);
  const tn = $('#tentarNet'); if (tn) tn.onclick = ev => { ev.preventDefault(); render(); };
  const ef = $('#enviarFila'); if (ef) ef.onclick = async ev => {
    ev.preventDefault();
    const r = await acao('Enviando…', () => sincronizar(false)).catch(() => null);
    if (!r) toast('Ainda sem internet. Os pontos continuam guardados.', 'erro');
    telaAluno();
  };
  const oa = $('#okAvisos'); if (oa) oa.onclick = ev => { ev.preventDefault(); LS.del('avisosPonto'); mostrarAluno(st.dados); };
  $('#novaAtiv').onclick = () => d._offline ? toast('Para cadastrar atividade precisa de internet.', 'erro') : novaAtividade(false, () => { render(); });
  $('#atualizar').onclick = () => render();
  ligaRodape();
  if (ab) st.timer = setInterval(() => { const e = $('#tempo'); if (e) e.textContent = 'Há ' + desde(ab.entrada) + (ab.local ? ' · ' + ab.local : '') + (ab.offline ? ' · sem internet' : ''); }, 30000);
}

function chipPonto(p) {
  if (p.validacao === 'Recusado') return '<span class="chip verm">recusado</span>';
  if (p.status === 'Aberto') return '<span class="chip amar">aberto</span>';
  if (p.status === 'Sem saída') return '<span class="chip verm">sem saída</span>';
  if (p.validacao === 'Pendente') return '<span class="chip amar">' + fh(p.horas) + ' · conferir</span>';
  return '<span class="chip ok">' + fh(p.horas) + (p.origem === 'offline' ? ' · offline' : '') + '</span>';
}
function infoAtividade(t) {
  const partes = [];
  if (t.setor) partes.push(esc(t.setor));
  if (t.aguardandoBaixa) partes.push('<b style="color:#8d6e00">aguardando baixa do coordenador</b>');
  else if (t.participantes && t.participantes.length) partes.push('em andamento · ' + t.participantes.length + ' aluno(s)');
  return partes.join(' · ');
}
function checklist(pend, rasc) {
  return pend.map(p => {
    const on = rasc.feitas.indexOf(String(p.id)) >= 0;
    const term = rasc.terminou.indexOf(String(p.id)) >= 0;
    return '<div class="check' + (on ? ' on' : '') + '" data-id="' + esc(p.id) + '"><input type="checkbox" class="cb-feito"' + (on ? ' checked' : '') + ' aria-label="Trabalhei nesta atividade">' +
      '<div style="flex:1"><div style="font-weight:600">' + esc(p.descricao) + ' <span class="chip ' + esc(p.prioridade) + '">' + esc(p.prioridade) + '</span></div>' +
      '<div class="mini">' + infoAtividade(p) + '</div>' +
      '<label class="term"><input type="checkbox" class="cb-term"' + (term ? ' checked' : '') + '> Terminei esta atividade (avisar o coordenador)</label></div></div>';
  }).join('');
}
function ligaChecklist(el, ab) {
  const salvar = () => {
    const r = lerRasc(ab);
    r.feitas = $$('.check', el).filter(c => $('.cb-feito', c).checked).map(c => c.dataset.id);
    r.terminou = $$('.check', el).filter(c => $('.cb-feito', c).checked && $('.cb-term', c).checked).map(c => c.dataset.id);
    salvarRasc(r);
  };
  $$('.check', el).forEach(c => {
    const cb = $('.cb-feito', c);
    c.onclick = ev => {
      if (ev.target.closest('.term')) return;
      if (ev.target !== cb) cb.checked = !cb.checked;
      c.classList.toggle('on', cb.checked);
      salvar();
    };
    $('.cb-term', c).onchange = salvar;
  });
}
function itemAtividade(t) {
  return '<li><div class="info"><div class="t">' + esc(t.descricao) + '</div><div class="m">' + (infoAtividade(t) || 'criada por ' + esc(t.criadaPor) + ' em ' + dataCurta(t.criadaEm)) + '</div></div>' +
    '<span class="chip ' + esc(t.prioridade) + '">' + esc(t.prioridade) + '</span></li>';
}
function gradeSemana(slots) {
  if (!slots || !slots.length) return '<div class="vazio">Seu horário ainda não foi cadastrado pelo coordenador.</div>';
  return ORDEM_DIAS.filter(d => slots.some(s => s.d === d || s.dia === d)).map(d => {
    const ss = slots.filter(s => s.d === d || s.dia === d);
    return '<div class="grade-dia"><b>' + DIAS[d] + ':</b> ' + ss.map(s => s.inicio + '–' + s.fim).join(', ') + '</div>';
  }).join('');
}

/* ------------------------- registrar ponto (com ou sem internet) ------------------------- */
async function registrarPonto(tipo, extra) {
  const locP = obterLocal(); locP.catch(() => {});
  const cap = await capturarRosto('ponto');
  carregando('Conferindo localização…');
  const loc = await locP;
  const base = Object.assign({ uid: novoUid(), tipo, descritor: cap.descritores[0], vivacidade: true, lat: loc.lat, lng: loc.lng, precisao: loc.prec }, extra || {});
  const horaCelular = Date.now();

  if (navigator.onLine !== false) {
    carregando(tipo === 'entrada' ? 'Registrando entrada…' : 'Registrando saída…');
    try {
      if (Fila.ler().length && !(await sincronizar(true))) throw erroRede('fila');
      const r = await api('baterPonto', Object.assign({ token: st.token }, base), { tempo: 25000 });
      guardaRelogio(Date.parse(r.hora));
      return { online: true, r };
    } catch (e) {
      if (!e.rede) throw e; // erro de verdade (rosto, local...): não guarda
    }
  }
  // Sem internet: confere aqui no celular e guarda na fila
  const local = conferirNoCelular(base.descritor, loc, st.dados && st.dados.offline);
  const it = Object.assign({ horaCelular, offsetAntes: offsetRelogio(), local }, base);
  Fila.add(it);
  return { online: false, hora: new Date(horaCelular + (it.offsetAntes || 0)).toISOString(), local };
}

async function fluxoEntrada() {
  try {
    const res = await registrarPonto('entrada');
    carregando(false);
    const d = st.dados;
    const hr = res.online ? res.r.hora : res.hora;
    const loc = res.online ? res.r.local : res.local;
    if (d) {
      d.aberto = { entrada: hr, local: loc, offline: !res.online };
      if (res.online) d.pendentes = res.r.pendentes;
      d._salvoEm = d._salvoEm || Date.now(); salvarCache(d);
    }
    const pend = d ? d.pendentes : [];
    const t = abrirTela('Entrada registrada',
      '<div class="sucesso"><div class="icone">' + (res.online ? '✓' : '⏳') + '</div><h2>Entrada às ' + hora(hr) + '</h2><p>' + (loc ? esc(loc) + ' · ' : '') + 'Bom trabalho!</p></div>' +
      (res.online ? '' : '<div class="aviso azul" style="margin-top:14px">Você está sem internet. A entrada ficou <b>guardada no celular</b> e será enviada sozinha quando o sinal voltar.</div>') +
      (res.online && res.r.pendente ? '<div class="aviso" style="margin-top:14px">Este ponto vai passar pela conferência do coordenador.</div>' : '') +
      '<div class="card" style="margin-top:20px"><h2>O que tem para fazer</h2>' +
      (pend.length ? '<ul class="lista">' + pend.map(itemAtividade).join('') + '</ul>' : '<div class="vazio">Nenhuma atividade em aberto.</div>') +
      '</div><button class="btn" data-ok>Começar</button>', { semFechar: true });
    $('[data-ok]', t).onclick = () => { t.remove(); mostrarAluno(st.dados); };
  } catch (e) {
    carregando(false);
    if (!e.cancelado) { toast(e.message, 'erro'); if (e.token) { sairDoCelular(); render(); } }
  }
}

function fluxoSaida(d) {
  const pend = d.pendentes;
  const ab = d.aberto;
  const rasc = lerRasc(ab);
  const t = abrirTela('Bater saída',
    '<div class="card"><h2>O que você fez hoje?</h2>' +
    (pend.length ? '<p class="mini" style="margin-top:0">Marque as atividades em que você trabalhou. Se terminou alguma, marque também “Terminei”.</p>' + checklist(pend, rasc)
      : '<div class="vazio">Nenhuma atividade em aberto.</div>') +
    '<div class="campo" style="margin-top:14px"><label>Observação (opcional)</label><textarea id="obs" rows="3" placeholder="Ex.: faltou arame para terminar a cerca">' + esc(rasc.obs) + '</textarea></div></div>' +
    '<div class="mini" style="text-align:center;margin-bottom:10px">Funciona com ou sem internet. Sem sinal, a saída fica guardada e é enviada depois.</div>' +
    '<button class="btn gigante saida" id="confirma">Confirmar saída com o rosto</button>',
    { aoFechar: () => mostrarAluno(st.dados) });
  ligaChecklist(t, ab);
  $('#obs', t).oninput = () => { const r = lerRasc(ab); r.obs = $('#obs', t).value; salvarRasc(r); };
  $('#confirma', t).onclick = async () => {
    const r0 = lerRasc(ab);
    const marcadas = r0.feitas.slice(), terminou = r0.terminou.filter(x => marcadas.indexOf(x) >= 0);
    const obs = $('#obs', t).value;
    try {
      const res = await registrarPonto('saida', { atividades: marcadas, terminou, observacao: obs });
      carregando(false);
      t.remove();
      LS.del('rascunhoSaida');
      if (st.dados) { st.dados.aberto = null; salvarCache(st.dados); }
      const nomes = pend.filter(p => marcadas.indexOf(String(p.id)) >= 0).map(p => p.descricao + (terminou.indexOf(String(p.id)) >= 0 ? ' (terminei)' : ''));
      const hr = res.online ? res.r.hora : res.hora;
      const s = abrirTela('Saída registrada',
        '<div class="sucesso"><div class="icone">' + (res.online ? '✓' : '⏳') + '</div><h2>Saída às ' + hora(hr) + '</h2>' +
        (res.online ? '<p>Hoje: <b>' + fh(res.r.horas) + '</b> (' + fh(res.r.noHorario) + ' no seu horário' + (res.r.fora > 0 ? ', ' + fh(res.r.fora) + ' fora' : '') + ')</p>' : '<p>Guardada no celular</p>') + '</div>' +
        (res.online ? '' : '<div class="aviso azul" style="margin-top:14px">Você está sem internet. A saída e as atividades foram <b>guardadas no celular</b> e serão enviadas sozinhas quando o sinal voltar.</div>') +
        (nomes.length ? '<div class="card" style="margin-top:20px"><h2>Você trabalhou em</h2><ul class="lista">' + nomes.map(f => '<li>✓ ' + esc(f) + '</li>').join('') + '</ul></div>' : '') +
        '<button class="btn" data-ok style="margin-top:16px">Até a próxima!</button>', { semFechar: true });
      $('[data-ok]', s).onclick = () => { s.remove(); res.online ? render() : mostrarAluno(st.dados); };
    } catch (e) {
      carregando(false);
      if (!e.cancelado) toast(e.message, 'erro');
    }
  };
}

function novaAtividade(comoCoord, depois) {
  const t = abrirTela('Nova atividade',
    '<div class="card"><div class="campo"><label>O que precisa ser feito?</label><input id="aDesc" maxlength="200" placeholder="Ex.: Conserto da cerca do piquete 10"></div>' +
    '<div class="campo"><label>Setor / local</label><input id="aSetor" maxlength="60" placeholder="Ex.: Bovinocultura"></div>' +
    '<div class="campo"><label>Prioridade</label><select id="aPrio"><option>Normal</option><option>Urgente</option><option>Baixa</option></select></div>' +
    '<button class="btn" id="aSalvar">Salvar atividade</button></div>');
  $('#aSalvar', t).onclick = async () => {
    const dados = { descricao: $('#aDesc', t).value, setor: $('#aSetor', t).value, prioridade: $('#aPrio', t).value };
    if (comoCoord) dados.senha = st.admin.senha; else dados.token = st.token;
    try {
      await acao('Salvando…', () => api('criarAtividade', dados));
      t.remove(); toast('Atividade cadastrada ✓', 'ok'); depois && depois();
    } catch (e) { /* */ }
  };
}

function rodape() {
  return '<div class="rodape"><button data-coord>Área do coordenador</button>' +
    (st.token && location.hash !== '#coordenador' ? ' · <button data-sair>Desativar este celular</button>' : '') + '</div>';
}
function ligaRodape() {
  $$('[data-coord]').forEach(b => b.onclick = () => { location.hash = '#coordenador'; });
  $$('[data-sair]').forEach(b => b.onclick = async () => {
    if (await confirmar('Desativar este celular? Para usar de novo você vai precisar de um novo código do coordenador.', 'Desativar', true)) {
      sairDoCelular(); render();
    }
  });
}

/* ================================================================
   COORDENADOR
   ================================================================ */
function telaLoginAdmin() {
  app().innerHTML = topo('Área do coordenador', '', '<button id="voltar">Voltar</button>') +
    '<main><div class="card"><div class="campo"><label>Senha do coordenador</label><input id="senha" type="password" autocomplete="current-password"></div>' +
    '<label class="check" style="border:0;padding:0 0 14px"><input type="checkbox" id="lembrar" checked><span>Lembrar neste aparelho</span></label>' +
    '<button class="btn" id="entrar">Entrar</button></div></main>';
  $('#voltar').onclick = () => { location.hash = ''; };
  const entrar = async () => {
    const senha = $('#senha').value;
    try {
      await acao('Entrando…', () => api('adminLogin', { senha }));
      st.admin.senha = senha;
      if ($('#lembrar').checked) LS.set('senhaCoord', senha);
      render();
    } catch (e) { /* */ }
  };
  $('#entrar').onclick = entrar;
  $('#senha').onkeydown = e => { if (e.key === 'Enter') entrar(); };
}

async function telaAdmin(silencioso) {
  if (!st.admin.dados || !silencioso || Date.now() - (st.admin.t || 0) > 30000) {
    if (!st.admin.dados) app().innerHTML = topo('Coordenador') + '<main><div class="card"><div class="vazio">Carregando…</div></div></main>';
    try { st.admin.dados = await api('adminPainel', { senha: st.admin.senha }); st.admin.t = Date.now(); st.admin.rel = null; }
    catch (e) {
      if (/senha/i.test(e.message)) { st.admin.senha = null; LS.del('senhaCoord'); toast(e.message, 'erro'); return render(); }
      app().innerHTML = topo('Coordenador') + '<main><div class="aviso erro">' + esc(e.message) + '</div><button class="btn" id="tentar">Tentar de novo</button></main>';
      $('#tentar').onclick = () => render();
      return;
    }
  }
  const D = st.admin.dados;
  const pendRosto = D.alunos.filter(a => a.rostoStatus === 'Pendente').length + (D.paraValidar || []).length;
  const aguardBaixa = D.atividades.filter(t => t.status !== 'Concluída' && t.aguardandoBaixa).length;
  const abas = [['agora', 'Agora' + (pendRosto ? ' •' : '')], ['alunos', 'Alunos'], ['atividades', 'Atividades' + (aguardBaixa ? ' (' + aguardBaixa + ')' : '')], ['relatorio', 'Horas'], ['ajustes', 'Ajustes']];
  app().innerHTML = topo(D.config.NOME_GRUPO || 'Coordenador', 'Painel do coordenador', '<button id="atualizarAdm" aria-label="Atualizar">↻</button><button id="sairAdm">Sair</button>') +
    '<nav class="abas">' + abas.map(a => '<button data-aba="' + a[0] + '" class="' + (st.admin.aba === a[0] ? 'on' : '') + '">' + a[1] + '</button>').join('') + '</nav>' +
    '<main id="conteudo"></main>';
  $('#atualizarAdm').onclick = () => telaAdmin(false);
  $('#sairAdm').onclick = () => { st.admin.senha = null; st.admin.dados = null; LS.del('senhaCoord'); location.hash = ''; };
  $$('[data-aba]').forEach(b => b.onclick = () => { st.admin.aba = b.dataset.aba; telaAdmin(true); });
  ({ agora: abaAgora, alunos: abaAlunos, atividades: abaAtividades, relatorio: abaRelatorio, ajustes: abaAjustes })[st.admin.aba]();
}
const recarregaAdmin = () => telaAdmin(false);
const S = () => ({ senha: st.admin.senha });

/* ---------- Aba Agora ---------- */
function abaAgora() {
  const D = st.admin.dados;
  const agora = new Date();
  const dia = agora.getDay(), min = agora.getHours() * 60 + agora.getMinutes();
  const toMin = s => { const p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  const presentes = new Set(D.noSetor.map(p => p.alunoId));
  const deveriam = D.alunos.filter(a => a.status !== 'Inativo' && a.horarios.some(h => h.dia === dia && toMin(h.inicio) <= min && min < toMin(h.fim)));
  const pend = D.alunos.filter(a => a.rostoStatus === 'Pendente');

  $('#conteudo').innerHTML =
    (pend.length ? '<div class="card"><h2>Rostos aguardando aprovação</h2><ul class="lista">' + pend.map(a =>
      '<li>' + (a.foto ? '<img class="foto-aprov" src="' + esc(a.foto) + '" alt="">' : '<span class="avatar">' + esc(iniciais(a.nome)) + '</span>') +
      '<div class="info"><div class="t">' + esc(a.nome) + '</div><div class="m">Cadastrado em ' + dataCurta(a.dataCadastro) + ' às ' + hora(a.dataCadastro) + '</div>' +
      '<div class="linha-btn" style="margin-top:8px"><button class="btn peq" data-aprovar="' + esc(a.id) + '">Aprovar</button><button class="btn peq cinza" data-recusar="' + esc(a.id) + '">Recusar</button></div></div></li>').join('') +
      '</ul><div class="mini" style="margin-top:8px">A foto serve só para você conferir e é apagada assim que você aprova ou recusa.</div></div>' : '') +

    (D.paraValidar.length ? '<div class="card"><h2>Pontos sem internet para conferir (' + D.paraValidar.length + ')</h2><ul class="lista">' + D.paraValidar.map(p =>
      '<li><div class="info"><div class="t">' + esc(p.aluno) + '</div><div class="m">' + diaSem(p.entrada) + ' ' + dataCurta(p.entrada) + ' · ' + hora(p.entrada) + ' – ' + (p.saida ? hora(p.saida) : '…') + (p.horas != null ? ' · ' + fh(p.horas) : '') + '</div>' +
      (p.alerta ? '<div class="m" style="color:var(--verm)">⚠ ' + esc(p.alerta) + '</div>' : '<div class="m">Registrado sem internet</div>') +
      '<div class="linha-btn" style="margin-top:8px"><button class="btn peq" data-val="' + esc(p.id) + '">Validar</button><button class="btn peq cinza" data-rec="' + esc(p.id) + '">Recusar</button></div></div></li>').join('') +
      '</ul><div class="mini" style="margin-top:8px">Horas desses pontos só entram no relatório depois de validadas.</div></div>' : '') +

    '<div class="card"><h2>No setor agora (' + D.noSetor.length + ')</h2>' +
      (D.noSetor.length ? '<ul class="lista">' + D.noSetor.map(p => '<li><span class="avatar">' + esc(iniciais(p.aluno)) + '</span><div class="info"><div class="t">' + esc(p.aluno) + '</div><div class="m">desde ' + hora(p.entrada) + ' · há ' + desde(p.entrada) + (p.local ? ' · ' + esc(p.local) : '') + '</div></div></li>').join('') + '</ul>'
        : '<div class="vazio">Ninguém no setor agora.</div>') + '</div>' +

    '<div class="card"><h2>Deveriam estar agora (' + deveriam.length + ')</h2>' +
      (deveriam.length ? '<ul class="lista">' + deveriam.map(a => {
        const h = a.horarios.find(h => h.dia === dia && toMin(h.inicio) <= min && min < toMin(h.fim));
        return '<li><div class="info"><div class="t">' + esc(a.nome) + '</div><div class="m">horário ' + h.inicio + '–' + h.fim + '</div></div>' +
          (presentes.has(a.id) ? '<span class="chip ok">presente</span>' : '<span class="chip verm">ausente</span>') + '</li>';
      }).join('') + '</ul>' : '<div class="vazio">Nenhum aluno com horário planejado agora.</div>') + '</div>' +

    '<div class="card"><h2>Pontos de hoje (' + D.hoje.length + ')</h2>' +
      (D.hoje.length ? '<ul class="lista">' + D.hoje.map(p => '<li><div class="info"><div class="t">' + esc(p.aluno) + '</div><div class="m">' + hora(p.entrada) + ' – ' + (p.saida ? hora(p.saida) : '…') + (p.atividades ? ' · ✓ ' + esc(p.atividades) : '') + (p.obs ? ' · “' + esc(p.obs) + '”' : '') + '</div></div>' + chipPonto(p) + '</li>').join('') + '</ul>'
        : '<div class="vazio">Nenhum ponto hoje.</div>') + '</div>' +

    (D.semSaida.length ? '<div class="card"><h2>Esqueceram de bater a saída</h2><ul class="lista">' + D.semSaida.map(p =>
      '<li><div class="info"><div class="t">' + esc(p.aluno) + '</div><div class="m">' + diaSem(p.entrada) + ' ' + dataCurta(p.entrada) + ' · entrada ' + hora(p.entrada) + '</div>' +
      '<div class="linha-btn" style="margin-top:8px"><button class="btn peq sec" data-ajustar="' + esc(p.id) + '">Informar saída</button><button class="btn peq cinza" data-excluir-ponto="' + esc(p.id) + '">Excluir ponto</button></div></div></li>').join('') + '</ul></div>' : '');

  $$('[data-aprovar]').forEach(b => b.onclick = async () => { await acao('Aprovando…', () => api('adminRosto', Object.assign(S(), { id: b.dataset.aprovar, aprovar: true }))).catch(() => {}); recarregaAdmin(); });
  $$('[data-recusar]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Recusar este cadastro? Um novo código será gerado para o aluno refazer.', 'Recusar', true)) return;
    try { const r = await acao('Recusando…', () => api('adminRosto', Object.assign(S(), { id: b.dataset.recusar, aprovar: false }))); toast('Novo código: ' + r.codigo, 'ok'); } catch (e) { /* */ }
    recarregaAdmin();
  });
  $$('[data-ajustar]').forEach(b => b.onclick = () => {
    const t = abrirTela('Informar saída', '<div class="card"><div class="campo"><label>Hora de saída</label><input type="time" id="hs"></div><button class="btn" id="ok">Salvar</button></div>');
    $('#ok', t).onclick = async () => {
      try { await acao('Salvando…', () => api('adminPonto', Object.assign(S(), { id: b.dataset.ajustar, op: 'saida', saida: $('#hs', t).value }))); t.remove(); recarregaAdmin(); } catch (e) { /* */ }
    };
  });
  $$('[data-val]').forEach(b => b.onclick = async () => { await acao('Validando…', () => api('adminPonto', Object.assign(S(), { id: b.dataset.val, op: 'validar' }))).catch(() => {}); recarregaAdmin(); });
  $$('[data-rec]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Recusar este ponto? As horas dele não vão contar.', 'Recusar', true)) return;
    await acao('Recusando…', () => api('adminPonto', Object.assign(S(), { id: b.dataset.rec, op: 'recusar' }))).catch(() => {});
    recarregaAdmin();
  });
  $$('[data-excluir-ponto]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir este ponto?', 'Excluir', true)) return;
    await acao('Excluindo…', () => api('adminPonto', Object.assign(S(), { id: b.dataset.excluirPonto, op: 'excluir' }))).catch(() => {});
    recarregaAdmin();
  });
}

/* ---------- Aba Alunos ---------- */
function abaAlunos() {
  const D = st.admin.dados;
  $('#conteudo').innerHTML = '<div class="linha-btn" style="margin-bottom:12px"><button class="btn" id="novoAluno">+ Cadastrar aluno</button></div>' +
    '<div class="campo busca"><input id="buscaA" placeholder="Buscar aluno"></div><div class="card"><ul class="lista" id="listaA"></ul></div>';
  const pinta = () => {
    const q = $('#buscaA').value.toLowerCase();
    const l = D.alunos.filter(a => a.nome.toLowerCase().includes(q));
    $('#listaA').innerHTML = l.length ? l.map(a =>
      '<li class="rel-item" data-aluno="' + esc(a.id) + '"><span class="avatar">' + esc(iniciais(a.nome)) + '</span><div class="info"><div class="t">' + esc(a.nome) + (a.status === 'Inativo' ? ' <span class="chip">inativo</span>' : '') + '</div>' +
      '<div class="m">' + (a.horarios.length ? a.horarios.length + ' horário(s) na semana' : 'sem horário cadastrado') + (a.codigo ? ' · código <b style="letter-spacing:.1em">' + esc(a.codigo) + '</b>' : '') + '</div></div>' +
      '<span class="chip ' + esc(a.rostoStatus) + '">' + (a.rostoStatus === 'Aprovado' ? 'ativo' : a.rostoStatus === 'Pendente' ? 'aprovar' : 'sem rosto') + '</span></li>').join('')
      : '<div class="vazio">Nenhum aluno.</div>';
    $$('[data-aluno]').forEach(li => li.onclick = () => editarAluno(D.alunos.find(a => a.id === li.dataset.aluno)));
  };
  $('#buscaA').oninput = pinta;
  pinta();
  $('#novoAluno').onclick = () => editarAluno(null);
}

function editarAluno(a) {
  const novo = !a;
  a = a || { nome: '', matricula: '', status: 'Ativo', horarios: [] };
  const t = abrirTela(novo ? 'Cadastrar aluno' : a.nome,
    '<div class="card"><div class="campo"><label>Nome completo</label><input id="eNome" value="' + esc(a.nome) + '"></div>' +
    '<div class="campo"><label>Matrícula (opcional)</label><input id="eMat" value="' + esc(a.matricula) + '"></div>' +
    '<div class="campo"><label>Situação</label><select id="eSt"><option' + (a.status !== 'Inativo' ? ' selected' : '') + '>Ativo</option><option' + (a.status === 'Inativo' ? ' selected' : '') + '>Inativo</option></select></div>' +
    '<button class="btn" id="eSalvar">Salvar dados</button></div>' +
    (novo ? '' :
      '<div class="card"><h2>Acesso ao app</h2>' +
      (a.codigo ? '<p style="margin-top:0">Código de ativação:</p><div style="font-size:34px;font-weight:800;letter-spacing:.3em;text-align:center;margin:6px 0 14px">' + esc(a.codigo) + '</div><p class="mini">Passe este código ao aluno. Ele usa uma única vez para cadastrar o rosto no celular dele.</p>'
        : '<p style="margin-top:0">Situação: <span class="chip ' + esc(a.rostoStatus) + '">' + esc(a.rostoStatus) + '</span></p>') +
      '<button class="btn sec" id="eCodigo">Gerar novo código (trocou de celular / refazer rosto)</button></div>' +
      '<div class="card"><h2>Horário planejado do semestre</h2><div id="slots"></div>' +
      '<div class="linha-btn"><button class="btn sec peq" id="addSlot">+ Adicionar horário</button></div>' +
      '<button class="btn" id="salvarSlots" style="margin-top:14px">Salvar horários</button></div>'));

  $('#eSalvar', t).onclick = async () => {
    try {
      const r = await acao('Salvando…', () => api('adminSalvarAluno', Object.assign(S(), { id: novo ? '' : a.id, nome: $('#eNome', t).value, matricula: $('#eMat', t).value, status: $('#eSt', t).value })));
      t.remove();
      await recarregaAdmin();
      if (novo) {
        toast('Aluno cadastrado ✓', 'ok');
        const na = st.admin.dados.alunos.find(x => x.id === r.id);
        if (na) editarAluno(na);
      } else toast('Salvo ✓', 'ok');
    } catch (e) { /* */ }
  };
  if (novo) return;

  $('#eCodigo', t).onclick = async () => {
    if (!await confirmar('Gerar novo código? O celular atual do aluno será desativado e ele precisará cadastrar o rosto de novo.', 'Gerar código', true)) return;
    try {
      await acao('Gerando…', () => api('adminNovoCodigo', Object.assign(S(), { id: a.id })));
      t.remove(); await recarregaAdmin();
      editarAluno(st.admin.dados.alunos.find(x => x.id === a.id));
    } catch (e) { /* */ }
  };

  const slots = a.horarios.map(h => Object.assign({}, h));
  const pintaSlots = () => {
    $('#slots', t).innerHTML = slots.length ? slots.map((s, i) =>
      '<div class="slot"><select data-i="' + i + '" data-k="dia">' + ORDEM_DIAS.map(d => '<option value="' + d + '"' + (Number(s.dia) === d ? ' selected' : '') + '>' + DIAS[d] + '</option>').join('') + '</select>' +
      '<input type="time" data-i="' + i + '" data-k="inicio" value="' + esc(s.inicio) + '"><input type="time" data-i="' + i + '" data-k="fim" value="' + esc(s.fim) + '">' +
      '<button data-rem="' + i + '" aria-label="Remover">×</button></div>').join('')
      : '<div class="vazio">Nenhum horário. Toque em “Adicionar horário”.</div>';
    $$('[data-k]', t).forEach(inp => inp.onchange = () => { slots[inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'dia' ? Number(inp.value) : inp.value; });
    $$('[data-rem]', t).forEach(b => b.onclick = () => { slots.splice(Number(b.dataset.rem), 1); pintaSlots(); });
  };
  pintaSlots();
  $('#addSlot', t).onclick = () => {
    const u = slots[slots.length - 1];
    slots.push(u ? { dia: (Number(u.dia) % 6) + 1, inicio: u.inicio, fim: u.fim } : { dia: 1, inicio: '07:30', fim: '11:30' });
    pintaSlots();
  };
  $('#salvarSlots', t).onclick = async () => {
    try {
      await acao('Salvando horários…', () => api('adminSalvarHorarios', Object.assign(S(), { alunoId: a.id, slots })));
      toast('Horários salvos ✓', 'ok');
      t.remove(); recarregaAdmin();
    } catch (e) { /* */ }
  };
}

/* ---------- Aba Atividades ---------- */
function abaAtividades() {
  const D = st.admin.dados;
  const f = st.admin.filtroAtiv || 'abertas';
  const ordemP = p => ['Urgente', 'Normal', 'Baixa'].indexOf(p);
  const aguard = D.atividades.filter(t => t.status !== 'Concluída' && t.aguardandoBaixa);
  const lista = D.atividades.filter(t => f === 'baixa' ? (t.status !== 'Concluída' && t.aguardandoBaixa) : f === 'abertas' ? t.status !== 'Concluída' : t.status === 'Concluída')
    .sort((x, y) => f === 'Concluída' ? (new Date(y.concluidaEm) - new Date(x.concluidaEm)) : ((y.aguardandoBaixa ? 1 : 0) - (x.aguardandoBaixa ? 1 : 0)) || (ordemP(x.prioridade) - ordemP(y.prioridade)));
  const bt = (k, txt) => '<button class="btn peq ' + (f === k ? '' : 'cinza') + '" data-f="' + k + '">' + txt + '</button>';
  $('#conteudo').innerHTML = '<button class="btn" id="novaA" style="margin-bottom:12px">+ Nova atividade</button>' +
    '<div class="linha-btn" style="margin-bottom:12px">' + bt('baixa', 'Aguardando baixa (' + aguard.length + ')') + bt('abertas', 'Em aberto') + bt('Concluída', 'Finalizadas') + '</div>' +
    '<div class="card">' + (lista.length ? '<ul class="lista">' + lista.map(t => {
      const regs = t.registros || [];
      return '<li><div class="info"><div class="t">' + esc(t.descricao) + ' <span class="chip ' + esc(t.prioridade) + '">' + esc(t.prioridade) + '</span>' +
        (t.status !== 'Concluída' && t.aguardandoBaixa ? ' <span class="chip amar">aguardando baixa</span>' : '') + '</div>' +
        '<div class="m">' + (t.setor ? esc(t.setor) + ' · ' : '') + 'criada por ' + esc(t.criadaPor) + ' em ' + dataCurta(t.criadaEm) +
        (t.status === 'Concluída' ? ' · <b>finalizada em ' + dataCurta(t.concluidaEm) + '</b>' : '') + '</div>' +
        (regs.length ? '<div class="part">Quem trabalhou: ' + regs.map(r => '<span>' + esc(r.aluno) + ' ' + dataCurta(r.data) + (r.terminou ? ' ✓ terminou' : '') + '</span>').join('') + '</div>'
          : '<div class="part">Ninguém registrou trabalho ainda.</div>') +
        '<div class="linha-btn" style="margin-top:8px">' +
        (t.status === 'Concluída' ? '<button class="btn peq sec" data-op="reabrir" data-id="' + esc(t.id) + '">Reabrir</button>'
          : '<button class="btn peq" data-op="concluir" data-id="' + esc(t.id) + '">✓ Dar baixa (finalizar)</button>' +
            (t.aguardandoBaixa ? '<button class="btn peq sec" data-op="continuar" data-id="' + esc(t.id) + '">Ainda não terminou</button>' : '')) +
        '<button class="btn peq cinza" data-op="excluir" data-id="' + esc(t.id) + '">Excluir</button></div></div></li>';
    }).join('') + '</ul>'
      : '<div class="vazio">Nada por aqui.</div>') + '</div>' +
    '<p class="mini">Os alunos marcam no ponto de saída em que atividades trabalharam (e se acham que terminaram). Só você dá a baixa final.</p>';
  $('#novaA').onclick = () => novaAtividade(true, recarregaAdmin);
  $$('[data-f]').forEach(b => b.onclick = () => { st.admin.filtroAtiv = b.dataset.f; abaAtividades(); });
  $$('[data-op]').forEach(b => b.onclick = async () => {
    if (b.dataset.op === 'excluir' && !await confirmar('Excluir esta atividade? O histórico de quem trabalhou nela continua na aba Registros da planilha.', 'Excluir', true)) return;
    await acao('Salvando…', () => api('adminAtividade', Object.assign(S(), { id: b.dataset.id, op: b.dataset.op }))).catch(() => {});
    recarregaAdmin();
  });
}

/* ---------- Aba Relatório ---------- */
async function abaRelatorio() {
  const hoje = new Date();
  if (!st.admin.mes) st.admin.mes = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  $('#conteudo').innerHTML = '<div class="card"><div class="campo" style="margin:0"><label>Mês</label><input type="month" id="mes" value="' + st.admin.mes + '"></div></div><div id="rel"><div class="card"><div class="vazio">Calculando…</div></div></div>';
  $('#mes').onchange = () => { st.admin.mes = $('#mes').value; st.admin.rel = null; abaRelatorio(); };
  let R = st.admin.rel;
  if (!R || R.mes !== st.admin.mes) {
    try { R = st.admin.rel = await api('adminRelatorio', Object.assign(S(), { mes: st.admin.mes })); }
    catch (e) { $('#rel').innerHTML = '<div class="aviso erro">' + esc(e.message) + '</div>'; return; }
  }
  if (!$('#rel')) return;
  const tot = R.alunos.reduce((a, x) => ({ p: a.p + x.planejado, r: a.r + x.realizado, n: a.n + x.noHorario }), { p: 0, r: 0, n: 0 });
  $('#rel').innerHTML =
    '<div class="card"><h2>Grupo no mês</h2><div class="nums"><div><b>' + fh(tot.r) + '</b><span>realizadas</span></div><div><b>' + fh(tot.p) + '</b><span>planejadas</span></div>' +
    '<div><b class="pct ' + pctClasse(tot.p ? Math.round(tot.n / tot.p * 100) : null) + '">' + (tot.p ? Math.round(Math.min(tot.n, tot.p) / tot.p * 100) + '%' : '–') + '</b><span>cumprimento</span></div></div></div>' +
    '<div class="linha-btn" style="margin-bottom:14px"><button class="btn sec peq" id="csv">⬇ Planilha de horas</button><button class="btn sec peq" id="csvAtiv">⬇ Planilha de atividades</button></div>' +
    '<div class="card"><h2>Por aluno</h2>' +
    '<ul class="lista rel-lista">' + R.alunos.map(a => '<li data-rel="' + esc(a.id) + '"><div class="info"><div class="t">' + esc(a.nome) + '</div>' +
      '<div class="m">' + fh(a.realizado) + ' feitas de ' + fh(a.planejado) + ' planejadas · ' + fh(a.fora) + ' fora do horário' +
      (a.faltas ? ' · <b style="color:var(--verm)">' + a.faltas + ' dia(s) sem ponto</b>' : '') + (a.semSaida ? ' · ' + a.semSaida + ' sem saída' : '') + (a.aguardando ? ' · ' + fh(a.aguardando) + ' a conferir' : '') + ' · ' + (a.atividades || []).length + ' atividade(s)</div>' +
      '<div class="barra" style="height:6px"><i style="width:' + (a.planejado ? Math.min(100, Math.round(a.realizado / a.planejado * 100)) : 0) + '%"></i></div></div>' +
      '<b class="pct ' + pctClasse(a.cumprimento) + '" style="font-size:18px">' + (a.cumprimento == null ? '–' : a.cumprimento + '%') + '</b></li>').join('') + '</ul><p class="mini">Cumprimento = horas feitas dentro do horário planejado ÷ horas planejadas. Horas fora do horário também contam no total realizado. Toque num aluno para ver os pontos.</p></div>';
  $$('[data-rel]').forEach(tr => tr.onclick = () => detalheAluno(R.alunos.find(a => a.id === tr.dataset.rel)));
  $('#csv').onclick = () => baixarCSV(R);
  $('#csvAtiv').onclick = () => baixarAtividadesCSV(R);
}

function detalheAluno(a) {
  const ativ = a.atividades || [];
  abrirTela(a.nome,
    '<div class="card"><div class="nums"><div><b>' + fh(a.realizado) + '</b><span>realizadas</span></div><div><b>' + fh(a.planejado) + '</b><span>planejadas</span></div><div><b class="pct ' + pctClasse(a.cumprimento) + '">' + (a.cumprimento == null ? '–' : a.cumprimento + '%') + '</b><span>cumprimento</span></div></div>' +
    '<p class="mini">' + fh(a.noHorario) + ' no horário · ' + fh(a.fora) + ' fora · ' + a.diasPlanejados + ' dia(s) planejado(s) · ' + a.faltas + ' dia(s) sem ponto' + (a.aguardando ? ' · ' + fh(a.aguardando) + ' aguardando sua conferência' : '') + '</p></div>' +
    '<div class="card"><h2>O que fez no mês (' + ativ.length + ')</h2>' + (ativ.length ? '<ul class="lista">' + ativ.map(x =>
      '<li><div class="info"><div class="t">' + esc(x.atividade) + '</div><div class="m">' + diaSem(x.data) + ' ' + dataCurta(x.data) + ' às ' + hora(x.data) + '</div></div>' + (x.terminou ? '<span class="chip ok">terminou</span>' : '') + '</li>').join('') + '</ul>'
      : '<div class="vazio">Nenhuma atividade registrada neste mês.</div>') + '</div>' +
    '<div class="card"><h2>Pontos do mês</h2>' + (a.sessoes.length ? '<ul class="lista">' + a.sessoes.map(p =>
      '<li><div class="info"><div class="t">' + diaSem(p.entrada) + ' ' + dataCurta(p.entrada) + ' · ' + hora(p.entrada) + ' – ' + (p.saida ? hora(p.saida) : '…') + '</div>' +
      '<div class="m">' + (p.horas != null && p.status !== 'Sem saída' ? fh(p.noHorario) + ' no horário, ' + fh(p.fora) + ' fora' : '') + (p.atividades ? ' · ✓ ' + esc(p.atividades) : '') + (p.obs ? ' · “' + esc(p.obs) + '”' : '') + (p.alerta ? ' · ⚠ ' + esc(p.alerta) : '') + '</div></div>' + chipPonto(p) + '</li>').join('') + '</ul>'
      : '<div class="vazio">Nenhum ponto neste mês.</div>') + '</div>');
}

function baixarArquivo(nome, linhas) {
  const csv = '﻿' + linhas.map(l => l.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function baixarCSV(R) {
  const n = v => String(v == null ? '' : v).replace('.', ',');
  baixarArquivo('relatorio-horas-' + R.mes + '.csv', [['Aluno', 'Matrícula', 'Horas planejadas', 'Horas realizadas', 'Horas no horário', 'Horas fora do horário', 'Cumprimento (%)', 'Dias planejados', 'Dias sem ponto', 'Pontos sem saída', 'Horas aguardando conferência']]
    .concat(R.alunos.map(a => [a.nome, a.matricula, n(a.planejado), n(a.realizado), n(a.noHorario), n(a.fora), a.cumprimento == null ? '' : a.cumprimento, a.diasPlanejados, a.faltas, a.semSaida, n(a.aguardando)])));
}
function baixarAtividadesCSV(R) {
  const linhas = [['Data', 'Hora', 'Aluno', 'Atividade', 'Disse que terminou']];
  R.alunos.forEach(a => (a.atividades || []).forEach(x => linhas.push([new Date(x.data).toLocaleDateString('pt-BR'), hora(x.data), a.nome, x.atividade, x.terminou ? 'Sim' : ''])));
  linhas.splice(1, linhas.length, ...linhas.slice(1).sort((p, q) => p[0].split('/').reverse().join('').localeCompare(q[0].split('/').reverse().join('')) || p[1].localeCompare(q[1])));
  baixarArquivo('atividades-' + R.mes + '.csv', linhas);
}

/* ---------- Aba Ajustes ---------- */
function abaAjustes() {
  const D = st.admin.dados, C = D.config;
  const paraISO = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  $('#conteudo').innerHTML =
    '<div class="card"><h2>Locais do ponto</h2>' +
      (D.locais.length ? '<ul class="lista">' + D.locais.map(l => '<li><div class="info"><div class="t">' + esc(l.nome) + '</div><div class="m">raio de ' + l.raio + ' m · ' + l.lat.toFixed(5) + ', ' + l.lng.toFixed(5) + '</div></div>' +
        '<button class="btn peq cinza" data-exl="' + esc(l.id) + '">Excluir</button></li>').join('') + '</ul>'
        : '<div class="aviso">Cadastre pelo menos um local. O ponto só é aceito dentro do raio de um local.</div>') +
      '<button class="btn sec" id="addLocal" style="margin-top:10px">+ Cadastrar local</button></div>' +

    '<div class="card"><h2>Semestre</h2>' +
      '<div class="campo"><label>Início do semestre</label><input type="date" id="cIni" value="' + paraISO(C.INICIO_SEMESTRE) + '"></div>' +
      '<div class="campo"><label>Fim do semestre</label><input type="date" id="cFim" value="' + paraISO(C.FIM_SEMESTRE) + '"></div>' +
      '<small class="mini">As horas planejadas só contam entre essas datas.</small>' +
      '<h2 style="margin-top:18px">Feriados / dias sem atividade</h2>' +
      (D.feriados.length ? '<ul class="lista">' + D.feriados.map(f => '<li><div class="info"><div class="t">' + esc(f.data) + '</div><div class="m">' + esc(f.motivo) + '</div></div><button class="btn peq cinza" data-exf="' + esc(f.data) + '">Remover</button></li>').join('') + '</ul>' : '<div class="vazio">Nenhum.</div>') +
      '<div class="slot" style="grid-template-columns:1fr 1.3fr 44px;margin-top:10px;border:0"><input type="date" id="fData"><input id="fMotivo" placeholder="Motivo"><button id="addFer" style="background:var(--verde-claro);color:var(--verde)">+</button></div></div>' +

    '<div class="card"><h2>Geral</h2>' +
      '<div class="campo"><label>Nome do grupo</label><input id="cNome" value="' + esc(C.NOME_GRUPO) + '"></div>' +
      '<div class="campo"><label>Ponto sem internet</label><select id="cOff"><option value="SIM"' + (C.PONTO_OFFLINE !== 'NAO' ? ' selected' : '') + '>Permitir (fica guardado e é enviado depois)</option><option value="NAO"' + (C.PONTO_OFFLINE === 'NAO' ? ' selected' : '') + '>Não permitir</option></select></div>' +
      '<div class="campo"><label>Pontos feitos sem internet</label><select id="cAprov"><option value="AUTO"' + (C.APROVAR_OFFLINE !== 'MANUAL' ? ' selected' : '') + '>Valem sozinhos; só os suspeitos esperam minha conferência</option><option value="MANUAL"' + (C.APROVAR_OFFLINE === 'MANUAL' ? ' selected' : '') + '>Todos esperam minha conferência</option></select></div>' +
      '<div class="campo"><label>Exigir estar no local</label><select id="cLocal"><option value="SIM"' + (C.EXIGIR_LOCAL !== 'NAO' ? ' selected' : '') + '>Sim (recomendado)</option><option value="NAO"' + (C.EXIGIR_LOCAL === 'NAO' ? ' selected' : '') + '>Não</option></select></div>' +
      '<div class="campo"><label>Rigor do reconhecimento facial</label><select id="cLim">' +
        [['0.45', 'Alto (pode pedir para repetir mais vezes)'], ['0.5', 'Normal (recomendado)'], ['0.55', 'Tolerante']].map(o => '<option value="' + o[0] + '"' + (String(C.LIMIAR_ROSTO) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="campo"><label>Nova senha do coordenador</label><input id="cSenha" type="password" placeholder="Deixe em branco para manter"></div>' +
      '<button class="btn" id="salvarCfg">Salvar ajustes</button></div>' +

    '<div class="card"><h2>Link para os alunos</h2><p class="mini" style="margin-top:0">Envie este link no grupo. No celular, o aluno abre e escolhe “Adicionar à tela inicial”.</p>' +
      '<div class="campo"><input readonly id="linkApp" value="' + esc(location.origin + location.pathname) + '"></div><button class="btn sec" id="copiar">Copiar link</button></div>';

  $$('[data-exl]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir este local?', 'Excluir', true)) return;
    await acao('Excluindo…', () => api('adminExcluirLocal', Object.assign(S(), { id: b.dataset.exl }))).catch(() => {});
    recarregaAdmin();
  });
  $('#addLocal').onclick = () => {
    const t = abrirTela('Cadastrar local',
      '<div class="card"><div class="aviso">Vá até o setor com este celular e toque em “Usar minha localização atual”.</div>' +
      '<button class="btn sec" id="minhaLoc" style="margin-bottom:14px">📍 Usar minha localização atual</button>' +
      '<div class="campo"><label>Nome do local</label><input id="lNome" placeholder="Ex.: Setor de Bovinocultura"></div>' +
      '<div class="slot simples"><input id="lLat" inputmode="decimal" placeholder="Latitude"><input id="lLng" inputmode="decimal" placeholder="Longitude"></div>' +
      '<div class="campo"><label>Raio permitido (metros)</label><input id="lRaio" type="number" value="200" min="30" max="5000"><small>Distância máxima do ponto central. 150–300 m costuma funcionar bem.</small></div>' +
      '<button class="btn" id="lSalvar">Salvar local</button></div>');
    $('#minhaLoc', t).onclick = async () => {
      try { const l = await acao('Pegando localização…', obterLocal); $('#lLat', t).value = l.lat.toFixed(6); $('#lLng', t).value = l.lng.toFixed(6); toast('Localização capturada (precisão ~' + l.prec + ' m)', 'ok'); } catch (e) { /* */ }
    };
    $('#lSalvar', t).onclick = async () => {
      try {
        await acao('Salvando…', () => api('adminSalvarLocal', Object.assign(S(), { nome: $('#lNome', t).value, lat: $('#lLat', t).value.replace(',', '.'), lng: $('#lLng', t).value.replace(',', '.'), raio: $('#lRaio', t).value })));
        t.remove(); toast('Local salvo ✓', 'ok'); recarregaAdmin();
      } catch (e) { /* */ }
    };
  };
  $$('[data-exf]').forEach(b => b.onclick = async () => {
    await acao('Removendo…', () => api('adminFeriado', Object.assign(S(), { op: 'excluir', data: b.dataset.exf }))).catch(() => {});
    recarregaAdmin();
  });
  $('#addFer').onclick = async () => {
    if (!$('#fData').value) return toast('Escolha a data.', 'erro');
    await acao('Salvando…', () => api('adminFeriado', Object.assign(S(), { data: $('#fData').value, motivo: $('#fMotivo').value }))).catch(() => {});
    recarregaAdmin();
  };
  $('#salvarCfg').onclick = async () => {
    const dados = Object.assign(S(), {
      NOME_GRUPO: $('#cNome').value, EXIGIR_LOCAL: $('#cLocal').value, LIMIAR_ROSTO: $('#cLim').value,
      PONTO_OFFLINE: $('#cOff').value, APROVAR_OFFLINE: $('#cAprov').value,
      INICIO_SEMESTRE: $('#cIni').value, FIM_SEMESTRE: $('#cFim').value
    });
    const nova = $('#cSenha').value;
    if (nova) dados.NOVA_SENHA = nova;
    try {
      await acao('Salvando…', () => api('adminSalvarConfig', dados));
      if (nova) { st.admin.senha = nova; if (LS.get('senhaCoord')) LS.set('senhaCoord', nova); }
      st.admin.rel = null;
      toast('Ajustes salvos ✓', 'ok'); recarregaAdmin();
    } catch (e) { /* */ }
  };
  $('#copiar').onclick = () => {
    const i = $('#linkApp'); i.select();
    (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast('Link copiado ✓', 'ok'), () => { document.execCommand('copy'); toast('Link copiado ✓', 'ok'); });
  };
}

/* ================================================================ */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
