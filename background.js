// Automações TASY — background: compara com os já vistos, notifica (Windows + celular via ntfy),
// número no ícone, log, mapa do Tasy e atualização automática.
importScripts("lib/regras.js", "lib/agenda.js");
const A = globalThis.Agenda;
const R = globalThis.Regras;
const PORTAL = "https://portalvuemotion.redesantacatarina.org.br/*";
const pacsManuais = chrome.storage.session || chrome.storage.local;
chrome.tabs.onRemoved?.addListener((id) => { pacsManuais.remove(`pacsManual:${id}`).catch(() => {}); });

let filaLog = Promise.resolve();
function anotar(msg) {
  const linha = new Date().toLocaleTimeString("pt-BR") + " " + msg;
  const tarefa = filaLog.catch(() => {}).then(async () => {
    const { log = [] } = await chrome.storage.local.get("log");
    log.unshift(linha);
    await chrome.storage.local.set({ log: log.slice(0, 100) });
  });
  filaLog = tarefa;
  return tarefa;
}

const cfg = async () => ({ ...R.PADRAO, ...(await chrome.storage.sync.get("cfg")).cfg });
const contagemExames = (exames) => ["TC", "US"].map((tipo) => {
  const n = exames.filter((e) => (e.tipo || "TC") === tipo).length;
  return n ? `${n} ${tipo}` : "";
}).filter(Boolean).join(" · ") || `${exames.length} exame(s)`;

// celular: só a contagem e o tipo de exame, nunca o nome do paciente
async function ntfy(c, novos) {
  if (!c.ntfyAtivo || !c.ntfyTopico) return;
  try {
    await fetch("https://ntfy.sh/" + encodeURIComponent(c.ntfyTopico), {
      method: "POST",
      headers: { Title: novos.length === 1 ? `${novos[0].tipo || "TC"} nova HSI` : `${novos.length} exames novos HSI`, Priority: "high", Tags: "rotating_light" },
      body: contagemExames(novos),
    });
  } catch (e) { anotar("ntfy falhou: " + e.message); }
}

async function receberLista(exames, totalPortal, tabId) {
  const { vistos } = await chrome.storage.local.get("vistos");
  const c0 = await cfg();
  const filtro = c0.campoHospital + "=" + c0.textoHospital;
  const doFiltro = Object.fromEntries(Object.entries(vistos || {}).filter(([, v]) => v.filtro === filtro));
  const m = R.mesclar(doFiltro, exames.map((e) => ({ ...e, filtro })));
  for (const e of exames) if (m.vistos[e.acc]) Object.assign(m.vistos[e.acc], { nome: e.nome, exame: e.exame, tipo: e.tipo, quando: e.quando, medico: e.medico, filtro });
  await chrome.storage.local.set({ vistos: m.vistos, ultima: { em: Date.now(), hsi: exames.length, totalPortal }, sessaoOk: true, sessaoCaiuEm: null });
  limparAvisosDeQueda("");
  const pendentes = Object.values(m.vistos).filter((v) => !v.laudo).length;
  chrome.action.setBadgeText({ text: pendentes ? String(pendentes) : "" });
  chrome.action.setBadgeBackgroundColor({ color: m.novos.length ? "#d32f2f" : "#555" });
  if (m.primeira) await anotar(`lista inicial: ${exames.length} exame(s) TC/US do HSI (de ${totalPortal} no portal)`);
  if (!m.novos.length) return;
  await anotar(`${m.novos.length} novo(s): ` + m.novos.map((n) => n.exame).join("; "));
  chrome.notifications.create("novo-" + Date.now(), {
    type: "basic", iconUrl: "icon.png", requireInteraction: true, priority: 2,
    title: m.novos.length === 1 ? `${m.novos[0].tipo || "TC"} nova no PACS (HSI)` : `${m.novos.length} exames novos no PACS (HSI)`,
    message: contagemExames(m.novos),
  });
  const c = await cfg();
  if (c.som && tabId) chrome.tabs.sendMessage(tabId, { tipo: "bip" }).catch(() => {});
  ntfy(c, m.novos);
}

// Tasy: solicitado / chegou no setor / em exame (TC e US)
const EVENTO = { solicitado: ["Solicitado", "avisoSolicitado"], chegou: ["Chegou no CDI", "avisoChegou"], "em exame": ["Em exame", "avisoEmExame"] };
let filaTasy = Promise.resolve();

// a sessão voltou: tira da tela os avisos de "deslogado" que ficaram
function limparAvisosDeQueda(prefixo) {
  chrome.notifications.getAll((todas) => {
    for (const id of Object.keys(todas || {})) if (id.startsWith(prefixo + "login")) chrome.notifications.clear(id);
  });
}

// notas clínicas (PEP): pede à aba do Tasy, com o pedido aprendido; guarda o resumo por exame
let filaNotas = Promise.resolve();
function guardarNotas(id, resumo) {
  const tarefa = filaNotas.catch(() => {}).then(async () => {
    const { tasyNotas = {} } = await chrome.storage.local.get("tasyNotas");
    for (const [k, v] of Object.entries(tasyNotas)) if (Date.now() - v.em > 48 * 36e5) delete tasyNotas[k];
    tasyNotas[id] = { ...(resumo || { v: 4, evolucoes: [], resumo: "", n: 0 }), em: Date.now() };
    await chrome.storage.local.set({ tasyNotas });
  });
  filaNotas = tarefa;
  return tarefa;
}
async function buscarNotas(ex, detalhar = false) {
  let limite;
  try {
    const { tasyNotasModelo } = await chrome.storage.local.get("tasyNotasModelo");
    const erro = R.erroModeloNotas(tasyNotasModelo, ex);
    if (erro) throw new Error(erro);
    const [aba] = await chrome.tabs.query({ url: "https://producao-tasy.acsc.org.br/*" });
    if (!aba) throw new Error(A.SESSAO);
    const r = await Promise.race([chrome.tabs.sendMessage(aba.id, { tipo: "buscarNotas", exame: ex }, { frameId: 0 }),
      new Promise((ok) => { limite = setTimeout(() => ok({ erro: "Tempo limite de 30 s excedido ao aguardar notas do TASY." }), 30000); })]);
    if (r?.erro) throw new Error(r.erro);
    if (!r || !("resumo" in r)) throw new Error("Resposta de notas indisponível.");
    await guardarNotas(ex.id, r?.resumo);
    await anotar("Tasy: notas consultadas" + (r.resumo ? ` — ${r.resumo.evolucoes?.length || r.resumo.n || 0} médica(s)` : " — " + (r.motivo || "nenhuma nota médica retornada")));
    return r?.resumo || null;
  } catch (e) { await anotar("Tasy: notas não lidas (" + e.message + ")"); if (detalhar) throw e; return null; }
  finally { clearTimeout(limite); }
}
// completa aos poucos as notas das TC que estão na tela (no máximo 3 por leitura)
async function completarNotas(estado) {
  const { tasyNotas = {} } = await chrome.storage.local.get("tasyNotas");
  const faltam = Object.values(estado).filter((e) => e.naTela && e.etapa !== "laudado" && e.etapa !== "cancelado" &&
    (!tasyNotas[e.id] || tasyNotas[e.id].v !== 4 || Date.now() - tasyNotas[e.id].em > 6 * 36e5)).slice(0, 3);
  for (const e of faltam) { await buscarNotas(e); await new Promise((r) => setTimeout(r, 1500)); }
}

// botão "Adicionar nota clínica" do painel: abre o PEP do paciente (rota do próprio Tasy) na aba do Tasy.
// O nota-tasy.js responde o motivo do acesso ("indireto", pedido do Artur), abre Notas clínicas e clica em Adicionar.
// Só abre o formulário em branco — quem escreve e salva é o Artur.
async function abrirNotaClinica(id, modo = "nota") {
  const { tasyEstado = {} } = await chrome.storage.local.get("tasyEstado");
  const ex = tasyEstado[id];
  if (!ex?.pessoa || !ex?.atendimento) return { erro: "exame sem nº de atendimento" };
  return abrirPep(ex, modo);
}

async function abrirPep(ex, modo, usarRota = false) {
  const rota = A.rotaPep(ex);
  // 0.29: só com nº do atendimento (busca do painel) dá para ir pelo caminho rápido, sem a rota do PEP
  if (!rota && !ex?.atendimento) return { erro: "Paciente sem código de pessoa física." };
  if (!rota) usarRota = false;
  // Em "notasF8" (carregamento do resumo para o modal), mantém o usuário na página do painel sem trocar de aba.
  const emSegundoPlano = modo === "notasF8";
  await chrome.storage.local.set({ tasyAbrirNota: { pessoa: ex.pessoa, atendimento: ex.atendimento, rota, usarRota, modo: ["prontuario", "pedido", "notasF8"].includes(modo) ? modo : "nota", tentativas: 0, ate: Date.now() + 3 * 60000 } });
  const abas = await chrome.tabs.query({ url: "https://producao-tasy.acsc.org.br/*" });
  const aba = abas.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  // o Tasy não deixa duas abas abertas: usa a que já existe. Do jeito testado na tela real (16/10): troca a rota com
  // o Tasy aberto, espera um pouco e só então recarrega (trocar e recarregar juntos volta para a tela inicial)
  // caminho rápido (0.21): sem recarregar — PEP › Localizar paciente › nº do atendimento (nota-tasy.js)
  if (aba) {
    if (!emSegundoPlano) {
      await chrome.tabs.update(aba.id, { active: true });
      chrome.windows.update(aba.windowId, { focused: true }).catch(() => {});
    }
    try { await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ["nota-tasy.js"] }); } catch {}
    const r = await Promise.race([chrome.tabs.sendMessage(aba.id, { tipo: "notaRapida" }, { frameId: 0 }).catch(() => null),
      new Promise((ok) => setTimeout(() => ok(null), 20000))]);
    if (r?.ok) return { ok: true };
    if (usarRota && !r?.rota && !r?.parar) {
      await chrome.storage.local.remove("tasyAbrirNota");
      return { erro: "Não foi possível conferir telas não salvas no TASY; tente novamente." };
    }
    if (r?.parar) { await chrome.storage.local.remove("tasyAbrirNota"); return { erro: r.erro }; }   // não recarrega por cima de algo não salvo
    anotar("Tasy: caminho rápido não deu" + (r?.erro ? ` (${r.erro})` : "") + " — abrindo pela recarga");
  }
  if (!aba && usarRota) {
    await chrome.storage.local.remove("tasyAbrirNota");
    return { erro: A.SESSAO };
  }
  if (!rota) {
    await chrome.storage.local.remove("tasyAbrirNota");
    return { erro: aba ? "O TASY não achou esse atendimento pela busca rápida; confira o número." : A.SESSAO };
  }
  if (aba) {
    await chrome.scripting.executeScript({ target: { tabId: aba.id }, world: "MAIN", args: [rota],
      func: (r) => { location.hash = r; } });
    await new Promise((ok) => setTimeout(ok, 800));
    await chrome.tabs.reload(aba.id);
  }
  const t = aba || await chrome.tabs.create({ url: "https://producao-tasy.acsc.org.br/" + rota, active: !emSegundoPlano });
  if (!emSegundoPlano) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  anotar(modo === "prontuario" ? "Tasy: abrindo o prontuário" : modo === "pedido" ? "Tasy: abrindo o PEP para consultar pedido externo" : modo === "notasF8" ? "Tasy: carregando notas clínicas em segundo plano" : "Tasy: abrindo o PEP para adicionar nota clínica");
  return { ok: true };
}

function receberTasy(exames, total) {
  filaTasy = filaTasy.catch(() => {}).then(async () => {
    const { tasyEstado } = await chrome.storage.local.get("tasyEstado");
    const primeira = !tasyEstado || !Object.keys(tasyEstado).length;
    const m = R.tasyMudancas(tasyEstado, exames, primeira);
    await chrome.storage.local.set({ tasyEstado: m.estado, tasyUltima: { em: Date.now(), n: exames.length, total }, tasySessaoOk: true, tasyCaiuEm: null,
      loginTentativasTasy: null });   // 0.30: leitura deu certo = login valeu; zera as tentativas (antes travava após 3 quedas)
    limparAvisosDeQueda("tasy-");
    if (primeira) await anotar(`Tasy: lista inicial com ${exames.length} exame(s) de TC/US`);
    const c = await cfg();
    const avisos = m.avisos.filter((a) => c[EVENTO[a.evento][1]] !== false);
    // Texto clínico fica no painel local; avisos contêm somente contagem e tipo.
    if (c.notasAtivo !== false) completarNotas(m.estado);
    if (!avisos.length) return;
    await anotar("Tasy: " + avisos.map((a) => `${EVENTO[a.evento][0]} ${a.tipo}`).join("; "));
    for (const [ev, [titulo]] of Object.entries(EVENTO)) {
      const g = avisos.filter((a) => a.evento === ev);
      if (!g.length) continue;
      chrome.notifications.create("tasy-" + ev + Date.now(), {
        type: "basic", iconUrl: "icon.png", requireInteraction: ev !== "em exame", priority: 1,
        title: `${titulo}: ${g.map((a) => a.tipo).join(", ")} (Tasy)`,
        message: contagemExames(g),
      });
      if (c.ntfyAtivo && c.ntfyTopico) {   // celular: só tipo e etapa, sem nome
        fetch("https://ntfy.sh/" + encodeURIComponent(c.ntfyTopico), { method: "POST",
          headers: { Title: `${titulo} (Tasy)`, Tags: "hospital" }, body: contagemExames(g) }).catch(() => {});
      }
    }
  });
}

chrome.runtime.onMessage.addListener((m, sender, responder) => {
  if (m.tipo === "pacsSemLogin") {
    if (sender.tab?.id == null) { responder(false); return true; }
    const chave = `pacsManual:${sender.tab?.id}`;
    Promise.resolve().then(() => pacsManuais.get(chave)).then((st) => responder(st?.[chave] === true), () => responder(false));
    return true;
  }
  if (m.tipo === "abrirPacsAgenda" || m.tipo === "abrirPedidoExternoAgenda") {
    chrome.storage.local.get(["tasyAgendaCache", "tasyEstado"]).then(async (st) => {
      const ex = st.tasyAgendaCache?.[m.chave]?.linhas?.find((l) => l.id === m.id);
      if (!ex?.pessoa) return { erro: "Agendamento sem código de pessoa física." };
      if (m.tipo === "abrirPacsAgenda") {
        const url = A.urlPacs((await cfg()).enderecoPacs, ex);
        if (!url) return { erro: "Endereço do PACS não configurado ou identificador ausente." };
        // Primeiro abre vazia: registra a aba antes de navegar para impedir login automático.
        const aba = await chrome.tabs.create({ url: "about:blank", active: true });
        await pacsManuais.set({ [`pacsManual:${aba.id}`]: true });
        await chrome.tabs.update(aba.id, { url, active: true });
        return { ok: true };
      }
      const indicio = A.expandirExames([ex]).some((l) => A.cruzarGestao(l, st.tasyEstado, m.chave.split('|')[1]).pedidoExterno);
      if (!indicio) return { erro: "Sem indício de pedido externo." };
      await anotar("Pedido externo: URL do arquivo não comprovada; abrindo PEP / Pedido de exame externo (detecção pelo rótulo).");
      return abrirPep(ex, "pedido", true);
    }).then(responder, () => responder({ erro: "Não foi possível abrir o destino; confira configuração e sessão." }));
    return true;
  }
  if (m.tipo === "agendaAtualizar" || m.tipo === "agendaModelo") {
    const tarefa = m.tipo === "agendaModelo" ? aprenderAgenda(m.modelo, sender, m.nome) : atualizarAgenda(m.data, m.cd);
    tarefa.then(responder, () => responder({ erro: A.SESSAO }));
    return true;
  }
  if (m.tipo === "abrirProntuarioAgenda") {
    chrome.storage.local.get("tasyAgendaCache").then(({ tasyAgendaCache = {} }) => {
      const ex = tasyAgendaCache[m.chave]?.linhas?.find((l) => l.id === m.id);
      return ex?.pessoa ? abrirPep(ex, "prontuario", true) : { erro: "Agendamento sem código de pessoa física." };
    }).then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (m.tipo === "esperar") {
    setTimeout(() => responder(true), Math.min(10000, Math.max(0, +m.ms || 150)));
    return true;
  }
  if (m.tipo === "notasPelaTela") {   // 0.30: plano B das evoluções — abre Notas clínicas no TASY em segundo plano, aperta Ctrl+F8 e lê o que a tela carregar
    const ex = { pessoa: String(m.pessoa || ""), atendimento: String(m.atendimento || ""), cacheId: String(m.cacheId || "") };
    if (!ex.pessoa && !ex.atendimento) { responder({ erro: "Paciente sem identificação para abrir no TASY." }); return; }
    chrome.storage.local.set({ tasyNotasTela: { ...ex, pedidoEm: Date.now(), resumo: null } })
      .then(() => anotar("Notas: leitura direta vazia/falhou — plano B em segundo plano: Notas clínicas + Ctrl+F8 na tela do TASY"))
      .then(() => abrirPep(ex, "notasF8", !ex.atendimento)).then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (m.tipo === "abrirPacienteBusca") {   // 0.29: caixa de busca do painel → PEP › Notas clínicas
    const ex = { pessoa: String(m.pessoa || ""), atendimento: String(m.atendimento || "") };
    abrirPep(ex, "prontuario", !ex.atendimento).then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (m.tipo === "notasAgoraAgenda") {
    chrome.storage.local.get(["tasyAgendaCache", "tasyEstado", "tasyContrasteLido"]).then(async ({ tasyAgendaCache = {}, tasyEstado, tasyContrasteLido = {} }) => {
      const ex = tasyAgendaCache[m.chave]?.linhas?.find((l) => l.id === m.id);
      if (!ex) return { erro: "Agendamento não disponível no cache local." };
      const exames = A.expandirExames(tasyAgendaCache[m.chave].linhas.filter((l) => l.id === m.id));
      const l = A.cruzarGestao(exames.find((l) => l.exame === m.exame) || exames[0], tasyEstado, m.chave.split('|')[1]);
      const lido = tasyContrasteLido[ex.pessoa];
      const contraste = A.antesContraste({ ...l, contextoContraste: { ...(lido && Date.now() - lido.em < 15 * 60000 ? lido.campos : {}), ...l.contextoContraste } });
      for (const motivo of contraste.motivos) await anotar("Antes do contraste: " + motivo);
      if ((l.internado || l.tipo === "PS") && !l.chegadaCdi) await anotar("Agenda: chegada CDI não encontrada; DT_CHEGADA_PACIENTE/alternativas sem vínculo/data compatível.");
      try { return { ok: true, contraste, resumo: await buscarNotas({ ...ex, id: `agenda:${m.chave}|${m.id}` }, true) }; }
      catch (e) { return { erro: e.message, contraste }; }
    }).then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (m.tipo === "lista") receberLista(m.exames, m.totalPortal, sender.tab?.id);
  if (m.tipo === "tasyLista") { receberTasy(m.exames, m.total); if (m.accs) chrome.storage.local.set({ tasyAccs: m.accs }); }
  if (m.tipo === "tasyNotas") guardarNotas(m.id, m.resumo);
  if (m.tipo === "abrirPacsGestao" || m.tipo === "abrirPedidoExternoGestao") {
    chrome.storage.local.get("tasyEstado").then(async ({ tasyEstado = {} }) => {
      const ex = tasyEstado[m.id];
      if (!ex) return { erro: "Exame não disponível no cache local." };
      if (m.tipo === "abrirPacsGestao") {
        const url = A.urlPacs((await cfg()).enderecoPacs, ex);
        if (!url) return { erro: "Endereço do PACS não configurado ou identificador ausente." };
        const aba = await chrome.tabs.create({ url: "about:blank", active: true });
        await pacsManuais.set({ [`pacsManual:${aba.id}`]: true });
        await chrome.tabs.update(aba.id, { url, active: true });
        return { ok: true };
      }
      if (!ex.pedidoExterno) return { erro: "Sem indício de pedido externo." };
      if (!ex.pessoa) return { erro: "Exame sem código de pessoa física." };
      await anotar("Pedido externo: URL do arquivo não comprovada; abrindo PEP / Pedido de exame externo (detecção pelo rótulo).");
      return abrirPep(ex, "pedido", true);
    }).then(responder, () => responder({ erro: "Não foi possível abrir o destino; confira configuração e sessão." }));
    return true;
  }
  if (m.tipo === "notasAgora") {
    chrome.storage.local.get(["tasyEstado", "tasyContrasteLido"]).then(async ({ tasyEstado = {}, tasyContrasteLido = {} }) => {
      const ex = tasyEstado[m.id];
      if (!ex) return { erro: "Exame não disponível no cache local." };
      const lido = ex.pessoa && tasyContrasteLido[ex.pessoa];
      const contraste = A.antesContraste({ ...ex, contextoContraste: { ...(lido && Date.now() - lido.em < 15 * 60000 ? lido.campos : {}), ...ex.contextoContraste } });
      try { return { ok: true, contraste, resumo: await buscarNotas(ex, true) }; }
      catch (e) { return { erro: e.message, contraste }; }
    }).then(responder, (e) => responder({ erro: e.message }));
    return true;
  }
  if (m.tipo === "abrirNotaClinica" || m.tipo === "abrirProntuario") { abrirNotaClinica(m.id, m.tipo === "abrirProntuario" ? "prontuario" : "nota").then(responder, (e) => responder({ erro: e.message })); return true; }
  if (m.tipo === "checarTasyTopo" && sender.tab) chrome.tabs.sendMessage(sender.tab.id, { tipo: "checarTasy" }, { frameId: 0 }).catch(() => {});
  if (m.tipo === "tasySessao") chrome.storage.local.set(m.ok ? { tasySessaoOk: true, tasyCaiuEm: null } : { tasySessaoOk: false, tasyCaiuEm: Date.now() });
  if (m.tipo === "log") anotar(m.msg);
  if (m.tipo === "sessao") {
    chrome.storage.local.set(m.ok ? { sessaoOk: true, sessaoCaiuEm: null } : { sessaoOk: false, sessaoCaiuEm: Date.now() });
    if (m.ok) limparAvisosDeQueda("");
    if (!m.ok) { chrome.action.setBadgeText({ text: "!" }); chrome.action.setBadgeBackgroundColor({ color: "#f9a825" }); }
  }
  if (m.tipo === "checarAgora" && sender.tab) {   // busca vista num quadro interno: o quadro principal checa
    chrome.tabs.sendMessage(sender.tab.id, { tipo: "checarAgora" }, { frameId: 0 }).catch(() => {});
  }
  if (m.tipo === "loginFalhou") {
    const nome = m.site === "tasy" ? "Tasy" : "Portal Vue Motion";
    anotar(`${nome}: login automático falhou 3 vezes — entre à mão (confira usuário/senha no ícone)`);
    chrome.notifications.create((m.site === "tasy" ? "tasy-" : "") + "login" + Date.now(), { type: "basic", iconUrl: "icon.png",
      requireInteraction: true, title: `${nome} deslogado`, message: "O login automático falhou 3 vezes. Entre à mão." });
  }
  if (m.tipo === "tasyMapa") {   // trechos do mapa do Tasy (só formato, sem dados de paciente) — em fila, sem perder itens
    filaMapa = filaMapa.then(async () => {
      const { tasyMapa = [] } = await chrome.storage.local.get("tasyMapa");
      await chrome.storage.local.set({ tasyMapa: [...tasyMapa, ...m.itens].slice(-300) });
    });
  }
  if (m.tipo === "mapearAba") { mapearAba(m.tabId).then(responder); return true; }
  if (m.tipo === "testarNtfy") {
    cfg().then((c) => ntfy({ ...c, ntfyAtivo: true }, [{ exame: "teste de Automações TASY" }])).then(() => responder(true));
    return true;
  }
});

// Cache separado da Gestão; gravações em fila, consultas concorrentes por dia.
let filaAgenda = Promise.resolve(), sequenciaAgenda = 0;
const pedidosAgenda = new Map();
function gravarAgenda(f) {
  const p = filaAgenda.catch(() => {}).then(f);
  filaAgenda = p;
  return p;
}
async function aprenderAgenda(modelo, sender, nome) {
  const motivo = !sender.tab || !/^https:\/\/producao-tasy\.acsc\.org\.br\//.test(sender.url || "")
    ? "origem da mensagem inválida" : A.motivoRecusa(modelo?.url, "POST", modelo?.corpo);
  if (motivo) {
    await anotar("agenda: molde recusado — " + motivo);
    return { erro: motivo, aprendido: false };
  }
  try {
    await gravarAgenda(async () => {
      const estado = await chrome.storage.local.get(["tasyAgendaModelos", "tasyAgendaModelo"]);
      const todos = A.modelos(estado), cd = A.codigo(modelo);
      todos[cd] = { modelo, nome: nome || A.nomeSala(modelo) || todos[cd]?.nome || `Agenda ${cd}` };
      await chrome.storage.local.set({ tasyAgendaModelos: todos, tasyAgendaModelo: modelo });
    });
  } catch {
    await anotar("agenda: falha ao salvar molde localmente");
    return { erro: "falha ao salvar molde localmente", aprendido: false };
  }
  await anotar("agenda: molde aprendido ✓");
  const { tasyAgendaDia } = await chrome.storage.local.get("tasyAgendaDia");
  return { ...await atualizarAgenda(A.dataValida(tasyAgendaDia) ? tasyAgendaDia : A.hoje(), A.codigo(modelo), false), aprendido: true };
}
async function atualizarAgenda(data = A.hoje(), cd, selecionar = true) {
  if (!A.dataValida(data)) return { erro: "Escolha uma data válida." };
  const { sala, tasyAgendaInjecaoErro } = await gravarAgenda(async () => {
    const estado = await chrome.storage.local.get(["tasyAgendaModelo", "tasyAgendaModelos", "tasyAgendaCd", "tasyAgendaInjecaoErro"]);
    const sala = A.selecionar(estado, cd ?? estado.tasyAgendaCd);
    const selecionada = selecionar ? sala?.cd : estado.tasyAgendaCd || A.selecionar(estado)?.cd;
    await chrome.storage.local.set({ tasyAgendaDia: data, tasyAgendaModelos: A.modelos(estado), ...(selecionada ? { tasyAgendaCd: selecionada } : {}) });
    return { sala, tasyAgendaInjecaoErro: estado.tasyAgendaInjecaoErro };
  });
  const modelo = sala?.modelo;
  if (tasyAgendaInjecaoErro) return { erro: A.RECARREGAR };
  if (!modelo) return { erro: A.ATIVAR };
  const chave = A.chave(modelo, data), numero = ++sequenciaAgenda;
  pedidosAgenda.set(chave, numero);
  let resultado;
  try {
    const abas = await chrome.tabs.query({ url: "https://producao-tasy.acsc.org.br/*" });
    const aba = abas.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!aba) throw new Error(A.SESSAO);
    resultado = await chrome.tabs.sendMessage(aba.id, { tipo: "agendaConsultar", data, cd: sala.cd }, { frameId: 0 });
    if (!resultado?.ok || resultado.chave !== chave || !Array.isArray(resultado.linhas))
      resultado = { erro: resultado?.erro || A.SESSAO };
  } catch { resultado = { erro: A.SESSAO }; }
  await gravarAgenda(async () => {
    if (pedidosAgenda.get(chave) !== numero) return;
    const guardado = await chrome.storage.local.get(["tasyAgendaCache", "tasyAgendaModelos", "tasyAgendaModelo"]);
    const { tasyAgendaCache = {} } = guardado, atual = A.selecionar(guardado, sala.cd)?.modelo;
    if (atual?.corpo !== modelo.corpo || atual?.em !== modelo.em) return;
    tasyAgendaCache[chave] = resultado.ok
      ? { data, sala: resultado.sala || sala.nome, em: Date.now(), linhas: resultado.linhas, erro: "" }
      : { ...tasyAgendaCache[chave], data, erro: resultado.erro };
    const todos = A.modelos(guardado);
    if (resultado.ok && resultado.sala) todos[sala.cd] = { modelo: atual, nome: resultado.sala };
    // Até 30 dias consultados, só no PC.
    const entradas = Object.entries(tasyAgendaCache).sort((a, b) => (b[1].em || 0) - (a[1].em || 0));
    await chrome.storage.local.set({ tasyAgendaModelos: todos, tasyAgendaCache: Object.fromEntries([
      [chave, tasyAgendaCache[chave]], ...entradas.filter(([k]) => k !== chave).slice(0, 29),
    ]) });
  });
  return resultado;
}
chrome.alarms.create("agendaTasy", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === "agendaTasy") {
    chrome.storage.local.get("tasyAgendaDia").then(({ tasyAgendaDia }) =>
      atualizarAgenda(A.dataValida(tasyAgendaDia) ? tasyAgendaDia : A.hoje())).catch(() => {});
    chrome.tabs.query({ url: "https://producao-tasy.acsc.org.br/*" }).then(([aba]) => {
      if (aba) chrome.tabs.sendMessage(aba.id, { tipo: "checarTasy", alarme: true }, { frameId: 0 }).catch(() => {});
    }).catch(() => {});
  }
});

let filaMapa = Promise.resolve();

// Mapear: injeta os scripts do Tasy na aba (mesmo se ela foi aberta antes de instalar a extensão) e liga por 5 min
async function mapearAba(tabId) {
  try {
    const alvo = { tabId, allFrames: true };
    await chrome.scripting.executeScript({ target: alvo, files: ["lib/agenda.js", "gancho-tasy.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: alvo, files: ["lib/regras.js", "lib/agenda.js", "lib/login.js", "content-tasy.js"] });
    await chrome.scripting.executeScript({ target: alvo, func: () => {
      localStorage.setItem("alertaHsi.mapear", String(Date.now() + 5 * 60000));
      return { url: location.origin + location.pathname, quadros: [...document.querySelectorAll("iframe, frame")].map((f) => (f.src || "").split("?")[0]) };
    } }).then((rs) => filaMapa = filaMapa.then(async () => {
      const { tasyMapa = [] } = await chrome.storage.local.get("tasyMapa");
      await chrome.storage.local.set({ tasyMapa: [...tasyMapa, { tipo: "início", quadros: rs.map((r) => r.result) }] });
    }));
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const [aba] = await chrome.tabs.query({ url: id.startsWith("tasy-") ? "https://producao-tasy.acsc.org.br/*" : PORTAL });
  if (aba) { chrome.tabs.update(aba.id, { active: true }); chrome.windows.update(aba.windowId, { focused: true }); }
});

// ======================= ATUALIZAÇÃO AUTOMÁTICA =======================
// O atualizar.ps1 (tarefa do Windows) baixa a versão nova do GitHub para a pasta da extensão.
// Aqui a extensão percebe que os arquivos mudaram e se recarrega; depois re-injeta o content.js na aba do portal
// (não precisa F5 — F5 derruba a sessão).
async function conferirAtualizacao() {
  try {
    const r = await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" });
    const nova = (await r.json()).version, atual = chrome.runtime.getManifest().version;
    if (nova && nova !== atual) { await anotar(`↻ versão nova (${atual} → ${nova}) — recarregando`); chrome.runtime.reload(); }
  } catch {}
}
chrome.alarms.create("atualizacao", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "atualizacao") {
    conferirAtualizacao();
    vigiarAbas();
    chrome.tabs.query({ url: PORTAL }).then(([aba]) => {
      if (aba) chrome.tabs.sendMessage(aba.id, { tipo: "checarAgora", alarme: true }, { frameId: 0 }).catch(() => {});
    }).catch(() => {});
  }
});

// ======================= VIGIA DAS ABAS =======================
// A cada 1 min confere se as abas do portal e do Tasy ainda têm a extensão rodando. Depois de uma atualização
// automática, os scripts antigos param ("órfãos") e o Tasy deixava de ser lido até um F5. Aqui eles são religados
// sem recarregar a página. Também impede o Chrome de "congelar" (descartar) essas abas para poupar memória.
const ABAS = [
  { url: PORTAL, nome: "portal", main: "gancho.js", js: ["lib/regras.js", "lib/login.js", "content.js"] },
  { url: "https://producao-tasy.acsc.org.br/*", nome: "Tasy", main: "gancho-tasy.js", js: ["lib/regras.js", "lib/agenda.js", "lib/login.js", "content-tasy.js", "nota-tasy.js"] },
];
async function vigiarAbas(forcar = false) {
  let falhaTasy = false;
  for (const s of ABAS) {
    for (const aba of await chrome.tabs.query({ url: s.url })) {
      if (aba.autoDiscardable !== false) chrome.tabs.update(aba.id, { autoDiscardable: false }).catch(() => {});
      if (aba.discarded) {   // o Chrome já tinha congelado a aba: recarrega (o login automático entra de novo)
        anotar(`${s.nome}: a aba estava congelada pelo Chrome — recarregando`);
        chrome.tabs.reload(aba.id).catch(() => {});
        continue;
      }
      let vivo = false;
      try {
        vivo = await Promise.race([chrome.tabs.sendMessage(aba.id, { tipo: "ping" }, { frameId: 0 }), new Promise((ok) => setTimeout(() => ok(false), 3000))]);
        chrome.tabs.sendMessage(aba.id, { tipo: "checarLogin" }).catch(() => {});
      } catch {}
      if (vivo && !forcar) continue;
      try {
        const alvo = { tabId: aba.id, allFrames: true };
        await chrome.scripting.executeScript({ target: alvo, files: s.nome === "Tasy" ? ["lib/agenda.js", s.main] : [s.main], world: "MAIN" });
        await chrome.scripting.executeScript({ target: alvo, files: s.js });
        anotar(`${s.nome}: leitura religada na aba aberta (sem F5)`);
      } catch {
        if (s.nome === "Tasy") falhaTasy = true;
        await anotar(`${s.nome}: não consegui religar a leitura; ${A.RECARREGAR}`);
      }
    }
  }
  await chrome.storage.local.set({ tasyAgendaInjecaoErro: falhaTasy });
}

chrome.runtime.onInstalled.addListener(async () => {
  // 0.9: o login do Vue Motion não achava o botão (fica fora do formulário) — zera as tentativas que travaram
  await chrome.storage.local.remove(["loginTentativas", "loginTentativasTasy", "recarga_portal", "recarga_tasy"]);
  // 0.6: o HSI é SiteId 4946 (achado pelo "Comparar"); troca a configuração antiga salva (OriginArchiveAE/hsi-)
  const { cfg: c } = await chrome.storage.sync.get("cfg");
  if (c && (c.campoHospital === "OriginArchiveAE" || !c.campoHospital)) {
    await chrome.storage.sync.set({ cfg: { ...c, campoHospital: "SiteId", textoHospital: "4946" } });
    await chrome.storage.local.remove("vistos");   // recomeça a lista sem avisar de tudo de uma vez
    anotar("filtro do HSI corrigido: SiteId = 4946");
  }
  await vigiarAbas(true);   // Inclui MAIN e ISOLATED mesmo se houver um ping antigo.
});
chrome.runtime.onStartup.addListener(vigiarAbas);
