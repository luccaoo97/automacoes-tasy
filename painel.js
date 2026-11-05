// Automações TASY — painel (tela grande). Junta Tasy (TC/US) e PACS (TC/US do HSI) numa tabela.
// Só lê o chrome.storage; se atualiza sozinho. painel.html?demo = dados inventados (testes/demo-painel.js).
// Colunas: arrastar o título muda a ordem (fica guardada); A− / A+ muda o tamanho da letra.
const R = globalThis.Regras;
const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has("demo");
const SEM_BACKEND = DEMO || !globalThis.chrome?.storage?.local;
const CHAVES = ["vistos", "tasyEstado", "tasyNotas", "ultima", "tasyUltima", "sessaoOk", "sessaoCaiuEm", "tasySessaoOk",
  "tasyCaiuEm", "tasyCampos", "tasyAgendaModelo", "tasyAgendaModelos", "tasyAgendaCd", "tasyAgendaCache", "tasyAgendaInjecaoErro", "busca", "tasyBusca", "tasyNotasModelo", "painelColunas", "painelLarguras", "painelOcultas", "agendaColunas", "agendaLarguras", "agendaOcultas", "agendaMoldeColunasV1", "agendaColunasPorSala", "agendaPreferenciasPorSala", "tasyAccs", "tasyNotasTela"];

const ETAPA = {
  prescrito: ["Prescrito", "var(--st-prescrito)"], chegou: ["CDI", "var(--st-cdi)"],
  "em exame": ["Em exame", "var(--st-exame)"], executado: ["Executado", "var(--st-executado)"], laudado: ["Laudado", "var(--st-laudado)"],
};
const corAtend = (a) => /pronto|^PS$/i.test(a) ? "var(--laranja)" : /intern/i.test(a) ? "var(--verde)" : /extern|ambul/i.test(a) ? "var(--azul)" : "var(--cinza)";
// nomes curtos do atendimento: "Pronto socorro" → "PS"
const nomeAtend = (a) => /pronto.?socorro/i.test(a || "") ? "PS" : a;
const nivelUrg = (u) => /muito|emerg/i.test(u) ? "alta" : /pouco/i.test(u) ? "baixa" : /urgente/i.test(u) ? "media" : "";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// data e hora sempre: "16/10 14:32"
const fmtDH = (t) => t ? new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
  new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
function fmt(t) {
  if (!t) return "";
  const d = new Date(t), h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? h : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + h;
}
const laudado = (l) => l.etapa === "laudado" || l.pacs?.laudo;
// nomes em MAIÚSCULAS (PACS) → forma normal: "RAULINO BAUER" → "Raulino Bauer"
const PEQ = new Set(["da", "de", "do", "das", "dos", "e"]);
const titulo = (s) => /[a-zà-ú]/.test(s || "") ? String(s || "") :
  String(s || "").toLowerCase().replace(/\S+/g, (p, i) => (i && PEQ.has(p)) ? p : p[0].toUpperCase() + p.slice(1));
const nada = `<span class="nada">—</span>`;
function iconeInternado(l) {
  return "";
}

// ---------- colunas (a ordem pode ser mudada arrastando o título) ----------
const COLS = {
  etapa: { t: "Status", ord: (l) => Object.keys(ETAPA).indexOf(l.etapa), html: (l) => {
    const [rot, cor] = ETAPA[l.etapa] || ETAPA.prescrito, u = nivelUrg(l.urgencia);
    const nativo = l.origem === "tasy", cores = l.tipo === "US" && nativo && D?.tasyCampos?.statusUS?.[l.status];
    const estilo = cores && R.corTasyValida(cores.cor) && R.corTasyValida(cores.fundo) ? ` style="color:${esc(cores.cor)};background-color:${esc(cores.fundo)}"` : "";
    return `<span class="status"${estilo}><i class="ponto" style="--cor:${cor}"></i>${esc(l.origem === "pacs" ? "Só no PACS" : nativo && l.status ? l.status : rot)}</span>` +
      (u ? ` <span class="urg ${u}">${esc(l.urgencia)}</span>` : "");
  } },
  // a hora do PACS é a da CHEGADA do estudo no PACS (vem uns minutos depois da baixa no Tasy), não a do exame
  pacs: { t: "PACS · chegada", ord: (l) => l.pacs?.quando || 0, html: (l) => !l.pacs ? ""
    : (l.pacs.laudo ? `<span class="pill lau">Laudado</span>` : `<span class="pill pacs">● no PACS</span>`) +
      (l.pacs.quando ? ` <span class="quando">${fmtDH(l.pacs.quando)}</span>` : "") },
  atend: { t: "Atendimento", ord: (l) => R.sem(l.atend), html: (l) => l.atend
    ? `<span class="atend"><i class="ponto" style="--cor:${corAtend(l.atend)}"></i>${esc(nomeAtend(l.atend))}</span>` : nada },
  exec: { t: "Execução", cls: "data", ord: (l) => l.execTasy || 0, html: (l) => l.execTasy ? fmtDH(l.execTasy) : "" },
  nome: { t: "Paciente", cls: "nome", ord: (l) => R.sem(l.nome), html: (l) => iconeInternado(l) + esc(titulo(l.nome)) },
  exame: { t: "Exame", cls: "exame", ord: (l) => R.sem(l.exame), html: (l) => `<span class="tipo ${esc(l.tipo)}">${esc(l.tipo)}</span>${esc(l.exame)}` },
  prescritor: { t: "Prescrito por", cls: "suave", ord: (l) => R.sem(l.prescritor), html: (l) => esc(titulo(l.prescritor)) || nada },
  clinico: { t: "Dados clínicos", html: (l) => l.clinico ? `<span class="clin">${esc(l.clinico)}</span>` : nada },
  prescrito: { t: "Data da prescrição", cls: "data", ord: (l) => l.prescrito || 0, html: (l) => fmtDH(l.prescrito) || nada },
};
const ORDEM_PADRAO = Object.keys(COLS);
let ordemCols = ORDEM_PADRAO;
// largura de cada coluna (px): arrastar a borda direita do título muda; fica guardada
const LARGURA_PADRAO = { etapa: 150, pacs: 190, atend: 125, exec: 120, nome: 200, exame: 220, prescritor: 160, clinico: 300, prescrito: 130 };
let larguras = { ...LARGURA_PADRAO };
let ocultas = [];
// pode estreitar até quase sumir: o texto cortado aparece inteiro na janelinha com o mouse em cima
const MINIMA = 28;
const largura = (k) => Math.max(MINIMA, +larguras[k] || LARGURA_PADRAO[k]);

// Configuração compartilhada; cada área usa suas próprias chaves no storage.
function colunasVisiveis(estado) {
  return estado.ordem.filter((k) => !estado.ocultas.includes(k));
}
function carregarColunas(estado, origem) {
  if (estado.prefixo === "agenda") {
    const m = globalThis.Agenda.moldeColunas(origem, estado.padrao);
    origem = { agendaColunas: m.ordem, agendaLarguras: m.larguras, agendaOcultas: m.ocultas };
  }
  const ordem = origem[estado.prefixo + "Colunas"];
  estado.ordem = Array.isArray(ordem) && ordem.length === estado.padrao.length &&
    new Set(ordem).size === ordem.length && ordem.every((k) => estado.padrao.includes(k)) ? [...ordem] : [...estado.padrao];
  const salvas = origem[estado.prefixo + "Larguras"];
  estado.larguras = { ...estado.larguraPadrao };
  for (const k of estado.padrao) if (Number.isFinite(salvas?.[k]) && salvas[k] >= MINIMA) estado.larguras[k] = salvas[k];
  const escondidas = origem[estado.prefixo + "Ocultas"];
  estado.ocultas = Array.isArray(escondidas) ? estado.padrao.filter((k) => escondidas.includes(k)) : [];
  if (estado.ocultas.length === estado.padrao.length) estado.ocultas.pop();
}
const gestaoCols = {
  prefixo: "painel", padrao: ORDEM_PADRAO, larguraPadrao: LARGURA_PADRAO, cols: COLS,
  get ordem() { return ordemCols; }, set ordem(v) { ordemCols = v; },
  get larguras() { return larguras; }, set larguras(v) { larguras = v; },
  get ocultas() { return ocultas; }, set ocultas(v) { ocultas = v; },
};

// ---------- dados ----------
async function dados() {
  if (DEMO) {
    if (!window.DEMO) await new Promise((ok) => { const s = document.createElement("script"); s.src = "testes/demo-painel.js"; s.onload = ok; document.head.append(s); });
    return window.DEMO;
  }
  if (SEM_BACKEND) return {};
  const local = await chrome.storage.local.get(CHAVES);
  if (!local.agendaMoldeColunasV1) {
    local.agendaMoldeColunasV1 = globalThis.Agenda.moldeColunas(local, agendaCols.padrao);
    await chrome.storage.local.set({ agendaMoldeColunasV1: local.agendaMoldeColunasV1 });
  }
  return { ...local, cfg: (await chrome.storage.sync.get("cfg")).cfg || {} };
}
async function guardar(chave, valor) {
  if (SEM_BACKEND) { try { localStorage.setItem("painel." + chave, JSON.stringify(valor)); } catch {} return; }
  if (chave === "fontePainel") {
    const { cfg = {} } = await chrome.storage.sync.get("cfg");
    await chrome.storage.sync.set({ cfg: { ...cfg, fontePainel: valor } });
  } else await chrome.storage.local.set({ [chave]: valor });
}
const lerDemo = (chave) => { try { return JSON.parse(localStorage.getItem("painel." + chave)); } catch { return null; } };

// ---------- estado da tela ----------
const ui = { area: "gestao", tipo: "TC", filtroExame: "todos", laudados: false, busca: "", cartao: "", col: "", asc: false };
const laudadosPorTipo = { TC: false, US: true, porExame: false };
let D = null, LINHAS = [];
function carregarColunasGestao(origem) {
  carregarColunas(gestaoCols, origem);
  const nativa = D?.tasyCampos?.colunasUS;
  if (ui.area === "gestao" && ui.tipo === "US" && !Array.isArray(origem.painelColunas) && Array.isArray(nativa)) {
    const conhecidas = [...new Set(nativa.filter((k) => ORDEM_PADRAO.includes(k)))];
    if (conhecidas.includes("nome") && conhecidas.includes("exame")) ordemCols = [...conhecidas, ...ORDEM_PADRAO.filter((k) => !conhecidas.includes(k))];
  }
}

const CARTOES = [
  ["prescrito", "Prescritos", "var(--st-prescrito)", (l) => l.etapa === "prescrito"],
  ["chegou", "No CDI", "var(--st-cdi)", (l) => l.etapa === "chegou"],
  ["em exame", "Em exame", "var(--st-exame)", (l) => l.etapa === "em exame"],
  ["pacs", "No PACS · sem laudo", "var(--verde)", (l) => l.pacs && !laudado(l)],
  ["laudado", "Laudados", "var(--st-laudado)", (l) => laudado(l)],
];

function naAbaAtual(l) {
  if (ui.area === "porExame") return R.exameTcFiltro(l, ui.filtroExame);
  if (ui.tipo === "TC" && ui.filtroExame && ui.filtroExame !== "todos") return R.exameTcFiltro(l, ui.filtroExame);
  return !ui.tipo || l.tipo === ui.tipo;
}

function filtrar(linhas) {
  const b = R.sem(ui.busca);
  const cartao = CARTOES.find((c) => c[0] === ui.cartao);
  const out = linhas.filter((l) =>
    naAbaAtual(l) &&
    (cartao ? cartao[3](l) : (ui.laudados || !laudado(l))) &&
    (!b || R.sem([l.nome, l.exame, l.clinico, l.prescritor, l.notas?.resumo, ...(l.notas?.pareceresRadiologia || []).map((p) => `${p.tipo || ""} ${p.texto || ""}`)].join(" ")).includes(b)));
  if (!ui.col) return R.ordenarPainel(out);
  const f = COLS[ui.col].ord;
  return out.sort((x, y) => { const a = f(x), c = f(y); return (a > c ? 1 : a < c ? -1 : 0) * (ui.asc ? 1 : -1); });
}

// ---------- desenho ----------
const ROTULOS_FILTRO_EXAME = {
  todos: "Todas as TCs",
  abdome: "TC Abdome",
  torax: "TC Tórax",
  apendiculares: "TC Apendiculares",
  neuro: "TC Neuro",
};
function desenharTopo() {
  const agora = Date.now();
  const chip = (el, ok, caiu, ultima, temBusca) => {
    el.className = "chip " + (caiu ? "caiu" : ok ? "ok" : "");
    el.querySelector("span").textContent = caiu ? "sessão caiu" : !temBusca ? "não aberto" : !ultima ? "aguardando"
      : ok ? "ativo · " + fmt(ultima) : "parado desde " + fmt(ultima);
    if (temBusca && ultima && !ok && !caiu) el.className = "chip caiu";
  };
  // "caiu" só se a última falha for mais nova que a última leitura boa
  const pCaiu = D.sessaoOk === false && !!D.sessaoCaiuEm && (!D.ultima || D.sessaoCaiuEm > D.ultima.em);
  const tCaiu = D.tasySessaoOk === false && !!D.tasyCaiuEm && (!D.tasyUltima || D.tasyCaiuEm > D.tasyUltima.em);
  chip($("chipPortal"), D.ultima && agora - D.ultima.em < 5 * 60000, pCaiu, D.ultima?.em, !!D.busca);
  chip($("chipTasy"), D.tasyUltima && agora - D.tasyUltima.em < 6 * 60000, tCaiu, D.tasyUltima?.em, !!D.tasyBusca);

  const av = [];
  if (!D.busca) av.push("Abra o portal Vue Motion e entre — a extensão monta a busca de hoje + TC/US + HSI sozinha.");
  if (!D.tasyBusca) av.push("Abra o Tasy na Gestão de exames (Tomografia e/ou Ultrassonografia HSI) uma vez e deixe a aba aberta.");
  else if (!D.tasyNotasModelo) av.push("Para ler as notas clínicas: abra uma vez as Notas clínicas (PEP) de um paciente da lista.");
  $("avisos").innerHTML = av.map((a) => `<div>${esc(a)}</div>`).join("");

  $("cartoes").innerHTML = CARTOES.map(([k, rot, cor, f]) =>
    `<div class="cartao ${ui.cartao === k ? "ativo" : ""}" data-k="${esc(k)}" style="--cor:${cor}">
       <div class="n">${LINHAS.filter((l) => naAbaAtual(l) && f(l)).length}</div><div class="r">${rot}</div></div>`).join("");

  if ($("segFiltroExame")) {
    document.querySelectorAll("#segFiltroExame button").forEach((bt) => {
      const ch = bt.dataset.exame;
      const qtd = LINHAS.filter((l) => R.exameTcFiltro(l, ch) && (ui.laudados || !laudado(l))).length;
      bt.innerHTML = `${esc(ROTULOS_FILTRO_EXAME[ch] || ch)}<span class="qtd-exame">${qtd}</span>`;
      bt.classList.toggle("ativo", ui.filtroExame === ch);
    });
  }
}

function desenharCabecalho() {
  const ativa = ui.col || "";
  $("cabecalho").innerHTML = colunasVisiveis(gestaoCols).map((k) =>
    `<th draggable="true" data-col="${k}" style="width:${largura(k)}px" class="${COLS[k].ord ? "ordenavel" : ""} ${ativa === k ? "ordenada" + (ui.asc ? " asc" : "") : ""}"
      title="Arraste o título para mudar a ordem; arraste a borda direita para mudar a largura">${COLS[k].t}<span class="puxar" data-col="${k}"></span></th>`).join("");
  $("tabela").style.width = colunasVisiveis(gestaoCols).reduce((s, k) => s + largura(k), 0) + "px";
  desenharMenuColunas(gestaoCols, "painelColunasMenu");
}

function desenhar() {
  esconderDica();   // a célula embaixo do mouse vai ser trocada
  desenharTopo();
  desenharCabecalho();
  $("segTipo").hidden = ui.area !== "gestao";
  if ($("segFiltroExame")) $("segFiltroExame").hidden = !(ui.area === "porExame" || (ui.area === "gestao" && ui.tipo === "TC"));
  $("tabela").classList.toggle("gestao-us", ui.area === "gestao" && ui.tipo === "US");
  $("verLaudados").checked = ui.laudados;
  const vis = filtrar(LINHAS);
  $("conta").textContent = `${vis.length} de ${LINHAS.length} exames`;
  $("vazio").hidden = vis.length > 0;
  const agora = Date.now();
  $("linhas").innerHTML = vis.map((l) =>
    `<tr data-id="${esc(l.id)}" class="${laudado(l) ? "laudado" : ""} ${l.etapa === "prescrito" && l.prescrito && agora - l.prescrito < 15 * 60000 ? "novo" : ""}">` +
    colunasVisiveis(gestaoCols).map((k) => `<td class="${COLS[k].cls || ""}">${COLS[k].html(l)}</td>`).join("") + "</tr>").join("");
}

// ---------- Modal compartilhado: médicas completas + 2 últimos pareceres da radiologia ----------
function htmlPareceresRadiologia(notas) {
  const pareceres = R.extrairPareceresRadiologia ? R.extrairPareceresRadiologia(notas) : (notas?.pareceresRadiologia || []).slice(0, 2);
  if (!pareceres.length) {
    return `<div class="pareceres-rad"><h3><span class="badge-rad">Radiologia</span> Últimos pareceres da radiologia (0/2)</h3><p class="sub">Nenhum parecer da radiologia identificado nas notas clínicas deste paciente.</p></div>`;
  }
  return `<div class="pareceres-rad"><h3><span class="badge-rad">Radiologia</span> Últimos pareceres da radiologia publicados (${pareceres.length}/2)</h3>` +
    pareceres.map((u, idx) =>
      `<p class="sub evo"><b>${idx + 1}º parecer mais recente</b> · ${esc([fmtDH(u.quando), u.tipo || "Parecer Radiologia", titulo(u.quem)].filter(Boolean).join(" · "))}</p><div class="caixa nota-formatada">${R.formatarNota(u.original ?? u.texto)}</div>`
    ).join("") + `</div>`;
}
function htmlEvolucoes(notas) {
  const blocoRad = htmlPareceresRadiologia(notas);
  const todas = (notas?.evolucoes || (notas?.ultima ? [notas.ultima] : []));
  const medicas = todas.filter((u) => u.medica ?? /m[eé]dic/i.test(u.tipo || ""));
  const evs = (medicas.length ? medicas : todas)
    .sort((a, b) => (b.quando || 0) - (a.quando || 0)).slice(0, 5);
  const blocoEvs = evs.length ? (medicas.length ? `<h3>Últimas evoluções médicas (${evs.length})</h3>` :
    `<h3>Últimas notas (${evs.length})</h3><p class="sub">não deu para separar as médicas — mostrando as 5 últimas notas</p>`) + evs.map((u) =>
    `<p class="sub evo">${esc([fmtDH(u.quando), u.tipo || "tipo não informado", titulo(u.quem)].filter(Boolean).join(" · "))}</p><div class="caixa nota-formatada">${R.formatarNota(u.original ?? u.texto)}</div>`).join("")
    : `<p class="sub">sem evoluções médicas recentes</p>`;
  return blocoRad + blocoEvs;
}
// 0.30: plano B — leitura direta vazia ou com erro → abre Notas clínicas no TASY com Ctrl+F8 (uma vez por modal)
let modalPaciente = null;
const semNotas = (r) => !r?.ok || !(r.resumo?.evolucoes?.length || r.resumo?.ultima || r.resumo?.pareceresRadiologia?.length);
function planoBNotas(r, p, cacheId = "") {
  if (SEM_BACKEND || !p || (!p.pessoa && !p.atendimento) || !semNotas(r)) return;
  modalPaciente = { pessoa: String(p.pessoa || ""), atendimento: String(p.atendimento || ""), desde: Date.now() };
  $("gNotaMsg").textContent = "Carregando as notas clínicas no TASY em segundo plano — aguarde alguns segundos…";
  if ($("gEvolucoes") && r?.erro) {
    $("gEvolucoes").innerHTML = `<p class="sub">Abrindo Notas clínicas do paciente no TASY em segundo plano (Plano B + Ctrl+F8)… aguarde aqui.</p>`;
  }
  chrome.runtime.sendMessage({ tipo: "notasPelaTela", pessoa: p.pessoa, atendimento: p.atendimento, cacheId })
    .then((x) => { if (x?.erro && modalPaciente && !$("gaveta").hidden) $("gNotaMsg").textContent = "Plano B não deu: " + x.erro; })
    .catch(() => {});
}
function notasDaTelaNoModal() {
  const t = D?.tasyNotasTela, m = modalPaciente;
  if (!t?.resumo || !m || $("gaveta").hidden || (t.em || 0) < m.desde) return;
  if ((m.pessoa && t.pessoa !== m.pessoa) || (!m.pessoa && t.atendimento !== m.atendimento)) return;
  exibirResultadoNotas({ ok: true, resumo: t.resumo });
  $("gNotaMsg").textContent = "Notas lidas da tela do TASY (Ctrl+F8).";
}
let focoAnterior = null, modalPedido = 0, modalItem = null, modalResumo = null;
function textoParaLaudo() {
  const ind = String(modalItem?.clinico || modalItem?.indicacao || "").trim();
  const nt = modalResumo || modalItem?.notas;
  const res = String(nt?.resumo || nt?.curto || nt?.evolucoes?.[0]?.texto || nt?.ultima?.texto || "").trim();
  return [ind && `Indicação clínica: ${ind}`, res && `Resumo evolutivo: ${res}`].filter(Boolean).join("\n");
}
function atualizarBotaoCopiar() {
  const bt = $("gCopiar");
  if (bt) bt.disabled = !textoParaLaudo();
}
function exibirResultadoNotas(r) {
  const erro = r?.erro || (!r?.ok ? "Resposta de notas indisponível." : "");
  if (r?.resumo) modalResumo = r.resumo;
  $("gNotaMsg").textContent = erro;
  $("gEvolucoes").innerHTML = erro ? `<p class="sub">Notas indisponíveis: ${esc(erro)}</p>` : htmlEvolucoes(r.resumo);
  atualizarBotaoCopiar();
}
function mostrarModal(l, acoes, mensagemNotas = "Buscando notas no TASY…", rodape = "") {
  esconderDica();
  modalItem = l;
  modalResumo = l.notas || null;
  if ($("gaveta").hidden) focoAnterior = document.activeElement;
  $("gTitulo").textContent = titulo(l.nome);
  $("gSub").textContent = l.exame || l.exames || "";
  $("gCorpo").innerHTML = acoes + (l.clinico || l.indicacao ? `<h3>Indicação no pedido</h3><div class="caixa">${esc(l.clinico || l.indicacao)}</div>` : "") + `<div id="gEvolucoes">${l.notas ? htmlEvolucoes(l.notas) : `<p class="sub">${esc(mensagemNotas)}</p>`}</div>` + rodape;
  const btCopiar = $("gCopiar");
  if (btCopiar) {
    atualizarBotaoCopiar();
    btCopiar.onclick = async () => {
      const t = textoParaLaudo();
      if (!t) return;
      try {
        await navigator.clipboard.writeText(t);
        const orig = btCopiar.textContent;
        btCopiar.textContent = "✓ Copiado";
        setTimeout(() => { if (btCopiar.isConnected) btCopiar.textContent = orig; }, 1800);
      } catch { $("gNotaMsg").textContent = "Não foi possível copiar para a área de transferência."; }
    };
  }
  $("gaveta").hidden = $("veu").hidden = false;
  document.body.classList.add("modal-aberto");
  $("gFechar").focus();
}
function htmlContraste(l, c = globalThis.Agenda.antesContraste(l)) {
  const resultado = (x) => x ? `${esc(x.valor.toFixed(1))} ${esc(x.unidade)} · ${esc(new Date(x.data).toLocaleDateString("pt-BR", { timeZone: globalThis.Agenda.FUSO }))}${x.origem ? ' · ' + esc(x.origem) : ' · TASY'}` : "não encontrado";
  return `<details id="gContraste"><summary class="btn fantasma">Antes do contraste</summary><div class="caixa"><p>Última creatinina: ${resultado(c.creatinina)}</p><p>TFG: ${resultado(c.tfg)}</p><p>Alergias: ${esc(c.alergias) || "não encontrado"}</p><p>Preparo do exame: ${esc(c.preparo) || "não encontrado"}</p></div></details>`;
}
function abrirNotas(id) {
  const l = LINHAS.find((x) => x.id === id);
  if (!l) return;
  if (abertaId !== id) modalPaciente = null;
  const pedido = ++modalPedido;
  const podeNota = l.origem === "tasy" || DEMO;
  const resultado = buscandoNotas.get(id);
  const mensagemNotas = l.origem !== "tasy" ? "Sem notas TASY: este item não possui vínculo com o TASY."
    : SEM_BACKEND ? "Sem conexão com o TASY." : resultado ? "" : "Buscando notas no TASY…";
  const temPacs = !!globalThis.Agenda.urlPacs(D?.cfg?.enderecoPacs, l);
  mostrarModal(l, podeNota ? `<div class="gaveta-acoes"><button class="btn fantasma" id="gProntuario" ${SEM_BACKEND ? "disabled" : ""}>Abrir prontuário</button><button class="btn" id="gNota" ${SEM_BACKEND ? "disabled" : ""}>✎ Adicionar nota clínica</button><button class="btn fantasma" id="gCopiar" title="Copia indicação e resumo evolutivo para colar no laudo">📋 Copiar resumo</button>${l.pedidoExterno ? '<button class="btn fantasma" id="gPedidoExterno">Pedido externo</button>' : ''}${temPacs ? '<button class="btn fantasma" id="gPacs">Exames anteriores (PACS)</button>' : ''}
      <span class="sub" id="gNotaMsg">Abre o PEP deste paciente no Tasy, em Notas clínicas › Adicionar</span></div>` : "", mensagemNotas, l.origem === "tasy" ? htmlContraste(l, resultado?.contraste) : "");
  if (resultado) exibirResultadoNotas(resultado);
  for (const [btId, tipo] of [["gPedidoExterno", "abrirPedidoExternoGestao"], ["gPacs", "abrirPacsGestao"]]) {
    const visivel = btId === "gPedidoExterno" ? l.pedidoExterno : temPacs;
    if (podeNota && visivel && $(btId)) $(btId).onclick = async () => {
      if (SEM_BACKEND) return;
      const r = await chrome.runtime.sendMessage({ tipo, id: id.slice(1) }).catch(() => ({ erro: A.SESSAO }));
      if (pedido === modalPedido) $("gNotaMsg").textContent = r?.erro || (btId === "gPacs" ? "PACS aberto em nova aba." : "Confira Pedido de exame externo no PEP.");
    };
  }
  if (podeNota) $("gProntuario").onclick = async () => {
    if (SEM_BACKEND) return;
    $("gNotaMsg").textContent = "Abrindo prontuário…";
    const r = await chrome.runtime.sendMessage({ tipo: "abrirProntuario", id: id.slice(1) }).catch((e) => ({ erro: e.message }));
    $("gNotaMsg").textContent = r?.erro ? "Não deu: " + r.erro : r?.ok ? "Confira o prontuário na aba do TASY." : "Sem confirmação do TASY.";
  };
  if (podeNota) $("gNota").onclick = async () => {
    $("gNotaMsg").textContent = "Abrindo o Tasy…";
    if (SEM_BACKEND) return;
    const r = await chrome.runtime.sendMessage({ tipo: "abrirNotaClinica", id: id.slice(1) }).catch((e) => ({ erro: e.message }));
    $("gNotaMsg").textContent = r?.erro ? "Não deu: " + r.erro : "Tasy aberto — confira a aba do Tasy";
  };
  abertaId = id; notasDaGaveta = JSON.stringify(l.notas || null);
  // pede as evoluções de agora ao Tasy (a gaveta se redesenha quando chegarem)
  if (!SEM_BACKEND && l.origem === "tasy" && !buscandoNotas.has(id)) {
    buscandoNotas.set(id, null);
    $("gNotaMsg").textContent = "Buscando as evoluções no TASY…";
    chrome.runtime.sendMessage({ tipo: "notasAgora", id: id.slice(1) }).then((r) => {
      if (r?.ok) buscandoNotas.set(id, r);
      else buscandoNotas.delete(id);
      if (abertaId !== id) return;
      if (r?.contraste && $("gContraste")) {
        const aberto = $("gContraste").open;
        $("gContraste").outerHTML = htmlContraste(l, r.contraste);
        $("gContraste").open = aberto;
      }
      exibirResultadoNotas(r);
      planoBNotas(r, l, id.slice(1));
    }).catch((e) => { buscandoNotas.delete(id); if (abertaId === id) exibirResultadoNotas({ erro: "Sem conexão com o TASY: " + e.message }); })
      .finally(() => setTimeout(() => buscandoNotas.delete(id), 60000));
  }
}
let abertaId = null, notasDaGaveta = "";
const buscandoNotas = new Map();
const fecharNotas = () => { $("gaveta").hidden = $("veu").hidden = true; abertaId = null; modalPaciente = null; modalItem = null; modalResumo = null; modalPedido++; document.body.classList.remove("modal-aberto"); focoAnterior?.focus(); };
async function abrirNotasAgenda(linha, chave) {
  if (linha.cancelado) return;
  abertaId = null; modalPaciente = null;
  const pedido = ++modalPedido;
  mostrarModal({ ...linha, notas: D?.tasyNotas?.[`agenda:${chave}|${linha.id}`] },
    `<div class="gaveta-acoes"><button class="btn fantasma" id="gProntuario" ${!linha.pessoa || SEM_BACKEND ? "disabled" : ""}>Abrir prontuário</button><button class="btn fantasma" id="gCopiar" title="Copia indicação e resumo evolutivo para colar no laudo">📋 Copiar resumo</button>${linha.pedidoExterno ? '<button class="btn fantasma" id="gPedidoExterno">Pedido externo</button>' : ''}${globalThis.Agenda.urlPacs(D?.cfg?.enderecoPacs, linha) ? '<button class="btn fantasma" id="gPacs">Exames anteriores (PACS)</button>' : ''}<span class="sub" id="gNotaMsg">Buscando as evoluções no TASY…</span></div>`, undefined, htmlContraste(linha));
  for (const [id, tipo] of [["gPedidoExterno", "abrirPedidoExternoAgenda"], ["gPacs", "abrirPacsAgenda"]]) {
    const visivel = id === "gPedidoExterno" ? linha.pedidoExterno : globalThis.Agenda.urlPacs(D?.cfg?.enderecoPacs, linha);
    if (visivel) $(id).onclick = async () => {
      if (SEM_BACKEND) return;
      const r = await chrome.runtime.sendMessage({ tipo, chave, id: linha.id }).catch(() => ({ erro: A.SESSAO }));
      if (pedido === modalPedido) $("gNotaMsg").textContent = r?.erro || (id === "gPacs" ? "PACS aberto em nova aba." : "Confira Pedido de exame externo no PEP.");
    };
  }
  $("gProntuario").onclick = async () => {
    const r = await chrome.runtime.sendMessage({ tipo: "abrirProntuarioAgenda", chave, id: linha.id }).catch(() => ({ erro: A.SESSAO }));
    if (pedido === modalPedido) $("gNotaMsg").textContent = r?.ok ? "Confira o prontuário na aba do TASY." : r?.erro || A.SESSAO;
  };
  if (SEM_BACKEND) { exibirResultadoNotas({ erro: "Sem conexão com o TASY." }); return; }
  const r = await chrome.runtime.sendMessage({ tipo: "notasAgoraAgenda", chave, id: linha.id, exame: linha.exame }).catch(() => ({ erro: A.SESSAO }));
  if (pedido !== modalPedido) return;
  if (r?.contraste) {
    const aberto = $("gContraste").open;
    $("gContraste").outerHTML = htmlContraste(linha, r.contraste);
    $("gContraste").open = aberto;
  }
  exibirResultadoNotas(r);
  planoBNotas(r, linha, `agenda:${chave}|${linha.id}`);
}

// ---------- tamanho da letra ----------
let fonte = 13;
function aplicarFonte(px) {
  fonte = Math.min(18, Math.max(10, px));
  document.documentElement.style.setProperty("--fonte", fonte + "px");
  $("fonteVal").textContent = fonte;
}
$("fonteMenos").onclick = () => { aplicarFonte(fonte - 1); guardar("fontePainel", fonte); };
$("fonteMais").onclick = () => { aplicarFonte(fonte + 1); guardar("fontePainel", fonte); };

// ---------- eventos ----------
$("linhas").addEventListener("click", (e) => {
  if (getSelection().toString()) return;   // estava selecionando texto
  const tr = e.target.closest("tr[data-id]"); if (tr) abrirNotas(tr.dataset.id);
});
$("gFechar").onclick = fecharNotas;
$("veu").onclick = fecharNotas;
document.addEventListener("keydown", (e) => {
  if ($("gaveta").hidden) return;
  if (e.key === "Escape") fecharNotas();
  if (e.key === "Tab") {
    const controles = [...$("gaveta").querySelectorAll("button:not(:disabled), summary, [tabindex='0']")];
    const primeiro = controles[0], ultimo = controles.at(-1);
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo?.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus(); }
  }
});
$("segTipo").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  ui.tipo = b.dataset.tipo;
  ui.filtroExame = "todos";
  ui.laudados = laudadosPorTipo[ui.tipo];
  ui.cartao = ""; ui.col = "";
  carregarColunasGestao(D || {});
  document.querySelectorAll("#segTipo button").forEach((x) => x.classList.toggle("ativo", x === b));
  desenhar();
});
$("segFiltroExame")?.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-exame]"); if (!b) return;
  ui.filtroExame = b.dataset.exame;
  ui.cartao = "";
  desenhar();
});
$("verLaudados").onchange = (e) => {
  const chave = ui.area === "porExame" ? "porExame" : ui.tipo;
  ui.laudados = laudadosPorTipo[chave] = e.target.checked;
  desenhar();
};
$("busca").oninput = (e) => { ui.busca = e.target.value; desenhar(); };
$("cartoes").addEventListener("click", (e) => {
  const c = e.target.closest(".cartao"); if (!c) return;
  ui.cartao = ui.cartao === c.dataset.k ? "" : c.dataset.k;
  desenhar();
});
const cab = $("cabecalho");
// mudar a largura: segura a borda direita do título e arrasta
let puxando = null, acabouDePuxar = false;
function configurarColunas(estado, cabId, tabelaId, menuId, padraoId, redesenhar) {
const cab = $(cabId);
const salvarMolde = () => {
  if (estado.prefixo === "agenda") guardar("agendaMoldeColunasV1", { v: 1, ordem: [...estado.ordem], larguras: { ...estado.larguras }, ocultas: [...estado.ocultas] });
};
const larguraAtual = (k) => Math.max(MINIMA, estado.larguras[k] || estado.larguraPadrao[k]);
cab.addEventListener("mousedown", (e) => {
  const p = e.target.closest(".puxar"); if (!p) return;
  e.preventDefault(); e.stopPropagation();
  puxando = { estado, k: p.dataset.col, x: e.clientX, w: larguraAtual(p.dataset.col), th: p.parentElement };
  document.body.classList.add("puxando");
});
document.addEventListener("mousemove", (e) => {
  if (puxando?.estado !== estado) return;
  estado.larguras[puxando.k] = Math.max(MINIMA, Math.round(puxando.w + e.clientX - puxando.x));
  puxando.th.style.width = estado.larguras[puxando.k] + "px";
  $(tabelaId).style.width = colunasVisiveis(estado).reduce((s, k) => s + larguraAtual(k), 0) + "px";
});
document.addEventListener("mouseup", () => {
  if (puxando?.estado !== estado) return;
  puxando = null; acabouDePuxar = true; setTimeout(() => { acabouDePuxar = false; }, 0);
  document.body.classList.remove("puxando");
  guardar(estado.prefixo + "Larguras", estado.larguras);
  salvarMolde();
});
// arrastar e soltar os títulos das colunas
let arrastando = null;
cab.addEventListener("dragstart", (e) => {
  if (puxando || e.target.closest(".puxar")) return e.preventDefault();
  const th = e.target.closest("th[data-col]"); arrastando = th?.dataset.col;
  if (arrastando) e.dataTransfer?.setData("text/plain", arrastando);
  th?.classList.add("arrastando");
});
cab.addEventListener("dragend", () => { arrastando = null; cab.querySelectorAll("th").forEach((t) => t.classList.remove("arrastando", "alvo")); });
cab.addEventListener("dragover", (e) => {
  const th = e.target.closest("th"); if (!th || !arrastando) return;
  e.preventDefault();
  cab.querySelectorAll("th").forEach((t) => t.classList.toggle("alvo", t === th && t.dataset.col !== arrastando));
});
cab.addEventListener("drop", (e) => {
  e.preventDefault();
  const th = e.target.closest("th"); if (!th || !arrastando || th.dataset.col === arrastando) return;
  const nova = estado.ordem.filter((k) => k !== arrastando);
  nova.splice(nova.indexOf(th.dataset.col) + (estado.ordem.indexOf(arrastando) < estado.ordem.indexOf(th.dataset.col) ? 1 : 0), 0, arrastando);
  estado.ordem = nova;
  guardar(estado.prefixo + "Colunas", nova);
  salvarMolde();
  redesenhar();
});
$(menuId).onchange = (e) => {
  const k = e.target.dataset.col;
  if (!estado.padrao.includes(k)) return;
  estado.ocultas = estado.ocultas.filter((c) => c !== k);
  if (!e.target.checked && colunasVisiveis(estado).length > 1) estado.ocultas.push(k);
  guardar(estado.prefixo + "Ocultas", estado.ocultas); salvarMolde(); redesenhar();
};
$(padraoId).onclick = () => {
  estado.ordem = [...estado.padrao]; estado.larguras = { ...estado.larguraPadrao }; estado.ocultas = [];
  guardar(estado.prefixo + "Colunas", null); guardar(estado.prefixo + "Larguras", null);
  guardar(estado.prefixo + "Ocultas", null); salvarMolde(); redesenhar();
};
}
function desenharMenuColunas(estado, menuId) {
  const visiveis = colunasVisiveis(estado);
  $(menuId).innerHTML = estado.ordem.map((k) => `<label><input type="checkbox" data-col="${k}" ${visiveis.includes(k) ? "checked" : ""} ${visiveis.length === 1 && visiveis.includes(k) ? "disabled" : ""}>${esc(estado.cols[k].t)}</label>`).join("");
}
configurarColunas(gestaoCols, "cabecalho", "tabela", "painelColunasMenu", "colunasPadrao", desenhar);
cab.addEventListener("click", (e) => {
  if (acabouDePuxar || e.target.closest(".puxar")) return;
  const th = e.target.closest("th[data-col]"); if (!th || !COLS[th.dataset.col].ord) return;
  const col = th.dataset.col;
  // 3º clique na mesma coluna volta à ordem do Tasy
  if (ui.col === col && ui.asc === (col === "exec" || col === "prescrito" || col === "pacs")) ui.col = "";
  else if (ui.col === col) ui.asc = !ui.asc;
  else { ui.col = col; ui.asc = !(col === "exec" || col === "prescrito" || col === "pacs"); }
  desenhar();
});

// ---------- janelinha: com o mouse numa célula cortada, mostra o texto inteiro ----------
const dica = document.createElement("div");
dica.className = "dica-celula"; dica.hidden = true; document.body.append(dica);
let dicaCel = null, dicaTimer = null;
const cortada = (el) => el.scrollWidth > el.clientWidth + 1;
function mostrarDica(cel) {
  const texto = (cel.innerText || "").trim();
  if (!texto) return;
  dica.textContent = texto; dica.hidden = false;
  const r = cel.getBoundingClientRect(), d = dica.getBoundingClientRect();
  // embaixo da célula; se não couber, em cima; nunca sai da tela pela direita
  let top = r.bottom + 4;
  if (top + d.height > innerHeight - 8) top = Math.max(8, r.top - d.height - 4);
  dica.style.top = top + "px";
  dica.style.left = Math.max(8, Math.min(r.left, innerWidth - d.width - 8)) + "px";
}
function esconderDica() { clearTimeout(dicaTimer); dicaCel = null; dica.hidden = true; }
document.addEventListener("mouseover", (e) => {
  const cel = puxando ? null : e.target.closest(".tabela td, .tabela th");
  if (cel === dicaCel) return;
  esconderDica();
  if (!cel || !cortada(cel)) return;
  dicaCel = cel;
  dicaTimer = setTimeout(() => mostrarDica(cel), 250);
});
document.addEventListener("scroll", esconderDica, true);
document.addEventListener("mousedown", esconderDica);

$("checar").onclick = async () => {
  if (SEM_BACKEND) return;
  for (const [url, tipo] of [["https://portalvuemotion.redesantacatarina.org.br/*", "checarAgora"], ["https://producao-tasy.acsc.org.br/*", "checarTasy"]]) {
    const [aba] = await chrome.tabs.query({ url });
    if (aba) chrome.tabs.sendMessage(aba.id, { tipo }, { frameId: 0 }).catch(() => {});
  }
  $("checar").textContent = "↻ Checando…";
  setTimeout(() => { $("checar").textContent = "↻ Checar agora"; }, 4000);
};
$("config").onclick = () => { if (!SEM_BACKEND) chrome.runtime.openOptionsPage(); else location.href = "config.html"; };

// ---------- Agenda TASY ----------
const A = globalThis.Agenda;
const AGENDA_COLS = {
  horario: { t: "Horário", html: (l) => l.inicio ? horaAgenda(l.inicio) : "" },
  duracao: { t: "Duração (min)", html: (l) => esc(l.duracao ?? (l.livre ? "" : "—")) },
  paciente: { t: "Paciente (idade)", html: (l) => `<button class="agenda-paciente" data-notas ${SEM_BACKEND || l.cancelado ? "disabled" : 'title="Ver evoluções médicas"'}>${iconeInternado(l)}${esc(l.nome || "Paciente sem nome")}</button>${l.idade !== "" ? " (" + esc(l.idade) + ")" : ""}` },
  exame: { t: "Exame", cls: "agenda-exame", html: (l) => esc(l.exame) },
  chegada: { t: "Chegada", html: (l) => `<span title="${esc(A.chegadaExibida(l).origem)}">${horaAgenda(A.chegadaExibida(l).em)}</span>` },
  tipo: { t: "Tipo", html: (l) => `<span class="atend"><i class="ponto" style="--cor:${corAtend(l.tipo)}"></i>${esc(l.tipo) || "—"}</span>` },
  indicacao: { t: "Indicação", cls: "indicacao", titulo: "indicacao", html: (l) => esc(l.indicacao) || "—" },
  medico: { t: "Médico solicitante", titulo: "medico", html: (l) => esc(l.medico) || "—" },
  status: { t: "Status", html: (l) => esc(l.status) },
};
const agendaCols = {
  prefixo: "agenda", cols: AGENDA_COLS, padrao: Object.keys(AGENDA_COLS), ordem: Object.keys(AGENDA_COLS), ocultas: [],
  larguraPadrao: { horario: 90, duracao: 100, paciente: 240, exame: 260, chegada: 90, tipo: 150, indicacao: 300, medico: 200, status: 130 },
};
agendaCols.larguras = { ...agendaCols.larguraPadrao };
configurarColunas(agendaCols, "agendaCabecalho", "agendaTabela", "agendaColunasMenu", "agendaColunasPadrao", desenharAgenda);
function celulasAgenda(l, colunas) {
  return colunas.map((k) => {
    const porExame = k === "exame" || l[k + "PorExame"];
    if (!porExame && !l.primeira) return "";
    const c = AGENDA_COLS[k];
    const vazia = l.livre && !["horario", "duracao"].includes(k);
    return `<td data-col="${k}" class="${c.cls || ""}"${!porExame && l.tamanhoGrupo > 1 ? ` rowspan="${l.tamanhoGrupo}"` : ""}${k === "exame" && !l.livre && !l.cancelado ? ' data-notas title="Ver evoluções médicas"' : !vazia && c.titulo ? ` title="${esc(l[c.titulo])}"` : ""}>${vazia ? "" : c.html(l)}</td>`;
  }).join("");
}
let agendaPedido = 0, agendaOcupada = false, agendaMensagem = "", agendaLinhas = [];
let agendaCd = null, agendaEscolhida = false;
const salaSelecionada = () => A.selecionar(D || {}, agendaCd);
const chaveAgenda = () => A.chave(salaSelecionada()?.modelo, $("agendaData").value);
$("agendaData").value = A.hoje();
$("agendaHoje").onclick = () => escolherDia(A.hoje());
$("agendaAnterior").onclick = () => escolherDia(A.deslocar($("agendaData").value, -1));
$("agendaProximo").onclick = () => escolherDia(A.deslocar($("agendaData").value, 1));
$("agendaData").onchange = () => escolherDia($("agendaData").value);
$("agendaOcultarLivres").onchange = desenharAgenda;
$("agendaAtualizar").onclick = atualizarAgenda;
$("agendaSala").onchange = () => { agendaCd = $("agendaSala").value; agendaEscolhida = true; fecharNotas(); return atualizarAgenda(); };
function escolherDia(data) {
  $("agendaData").value = data;
  agendaMensagem = "";
  return atualizarAgenda();
}
function mudarArea(area) {
  const ehAgenda = area === "agenda";
  if (!ehAgenda) {
    ui.area = area;
    ui.laudados = laudadosPorTipo[area === "porExame" ? "porExame" : ui.tipo];
    ui.cartao = "";
    carregarColunasGestao(D || {});
  }
  $("gestao").hidden = ehAgenda;
  $("agenda").hidden = !ehAgenda;
  $("checar").hidden = ehAgenda;
  for (const [id, ativo] of [["abaGestao", area === "gestao"], ["abaPorExame", area === "porExame"], ["abaAgenda", ehAgenda]]) {
    if (!$(id)) continue;
    $(id).classList.toggle("ativo", ativo);
    $(id).setAttribute("aria-pressed", String(ativo));
  }
  fecharNotas(); esconderDica();
  if (ehAgenda) atualizarAgenda();
  else desenhar();
}
$("abaGestao").onclick = () => mudarArea("gestao");
if ($("abaPorExame")) $("abaPorExame").onclick = () => mudarArea("porExame");
$("abaAgenda").onclick = () => mudarArea("agenda");
const horaAgenda = (em) => em ? new Date(em).toLocaleTimeString("pt-BR", { timeZone: A.FUSO, hour: "2-digit", minute: "2-digit" }) : "—";
function desenharAgenda() {
  const colunas = colunasVisiveis(agendaCols);
  $("agendaCabecalho").innerHTML = colunas.map((k) => `<th draggable="true" data-col="${k}" style="width:${agendaCols.larguras[k]}px" title="Arraste o título para mudar a ordem; arraste a borda direita para mudar a largura">${AGENDA_COLS[k].t}<span class="puxar" data-col="${k}"></span></th>`).join("");
  $("agendaTabela").style.width = colunas.reduce((s, k) => s + agendaCols.larguras[k], 0) + "px";
  desenharMenuColunas(agendaCols, "agendaColunasMenu");
  const salas = A.salas(D || {});
  if (agendaCd === null || (!agendaEscolhida && !A.selecionar(D || {}, agendaCd))) agendaCd = D?.tasyAgendaCd || A.selecionar(D || {})?.cd || "sala:1";
  if (agendaCd.startsWith("sala:")) {
    const aprendida = salas.find((s) => new RegExp(`sala\\s*${agendaCd.split(":")[1]}\\b`, "i").test(s.nome));
    if (aprendida) { agendaCd = aprendida.cd; if (agendaEscolhida) guardar("tasyAgendaCd", agendaCd); }
  }
  const opcoes = salas.map((s) => ({ cd: s.cd, nome: s.nome }));
  for (const n of [1, 2, 3]) if (!salas.some((s) => new RegExp(`sala\\s*${n}\\b`, "i").test(s.nome)))
    opcoes.push({ cd: `sala:${n}`, nome: `Ultrassonografia - Sala ${n} (ativar no TASY)` });
  opcoes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  $("agendaSala").innerHTML = opcoes.map((s) => `<option value="${esc(s.cd)}">${esc(s.nome)}</option>`).join("");
  $("agendaSala").value = agendaCd;
  const selecionada = salaSelecionada(), chave = chaveAgenda();
  const cache = SEM_BACKEND ? null : D?.tasyAgendaCache?.[chave];
  agendaLinhas = A.expandirExames(cache?.linhas || []).map((l, indice) => ({ ...A.cruzarGestao(l, D?.tasyEstado, $("agendaData").value), indice }));
  const linhas = agendaLinhas.filter((l) => !$("agendaOcultarLivres").checked || !l.livre);
  const aviso = cache?.erro || (cache?.em && Date.now() - cache.em > 4 * 60000 ? "Dados antigos; aguardando atualização." : "");
  const ativar = `filtre Ultrassonografia - Sala ${agendaCd?.split(":")[1] || 1} uma vez no TASY para ativar`;
  const estado = D?.tasyAgendaInjecaoErro ? A.RECARREGAR : !selecionada ? ativar : cache?.em ? "Atualizado às " + horaAgenda(cache.em) : "Sem agenda carregada para este dia.";
  $("agendaStatus").textContent = SEM_BACKEND ? "Sem conexão com o TASY; sem agenda de demonstração." :
    [...new Set([estado, aviso, agendaMensagem, agendaOcupada && "Atualizando…"].filter(Boolean))].join(" · ");
  $("agendaAtualizar").disabled = SEM_BACKEND || agendaOcupada;
  A.camposPorExame(agendaLinhas);
  $("agendaLinhas").innerHTML = linhas.map((l) => {
    const classes = [l.livre ? "livre" : l.primeira ? "" : "agrupada", A.bloqueado(l) ? "bloqueado" : ""].filter(Boolean).join(" ");
    return `<tr data-agenda-id="${esc(l.id)}" data-agenda-indice="${l.indice}" data-agenda-grupo="${l.grupoIndice}" class="${classes}">` +
      celulasAgenda(l, colunas) + "</tr>";
  }).join("");
  $("agendaVazio").hidden = linhas.length > 0;
  $("agendaVazio").textContent = cache?.em ? (agendaLinhas.length ? "Nenhum agendamento com este filtro." : "Nenhum horário retornado pelo TASY para este dia.") : "Sem agenda carregada para este dia.";
}
async function atualizarAgenda() {
  const pedido = ++agendaPedido, data = $("agendaData").value;
  agendaOcupada = false;
  desenharAgenda();
  const cd = agendaCd;
  if (SEM_BACKEND || !$("agendaData").reportValidity()) { desenharAgenda(); return; }
  if (!salaSelecionada()) { agendaMensagem = ""; desenharAgenda(); return; }
  agendaOcupada = true; agendaMensagem = ""; desenharAgenda();
  try {
    const r = await chrome.runtime.sendMessage({ tipo: "agendaAtualizar", data, cd });
    const local = await chrome.storage.local.get(["tasyAgendaModelo", "tasyAgendaModelos", "tasyAgendaCd", "tasyAgendaCache", "tasyAgendaInjecaoErro"]);
    if (pedido !== agendaPedido || data !== $("agendaData").value || cd !== agendaCd) return;
    D = { ...(D || {}), ...local };
    agendaMensagem = r?.ok ? "" : r?.erro || A.SESSAO;
  } catch { if (pedido === agendaPedido) agendaMensagem = A.SESSAO; }
  finally { if (pedido === agendaPedido) { agendaOcupada = false; desenharAgenda(); } }
}
$("agendaLinhas").onclick = async (e) => {
  const tr = e.target.closest("tr[data-agenda-id]");
  const linha = tr && agendaLinhas[Number(tr.dataset.agendaIndice)];
  if (SEM_BACKEND || !linha || linha.cancelado || e.target.closest("button:disabled")) return;
  if (e.target.closest("[data-notas]")) return abrirNotasAgenda(linha, chaveAgenda());
};
// 0.29: rodinha sobre a agenda rola para os lados (baixo → direita, cima → esquerda); nas pontas a página rola normal
$("agendaCaixa").addEventListener?.("wheel", (e) => {
  const caixa = e.currentTarget, delta = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? caixa.clientWidth : 1);
  if (e.shiftKey || e.ctrlKey || !delta || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const max = caixa.scrollWidth - caixa.clientWidth;
  if (max <= 0 || (delta > 0 && caixa.scrollLeft >= max - 1) || (delta < 0 && caixa.scrollLeft <= 0)) return;
  e.preventDefault();
  caixa.scrollLeft += delta;
}, { passive: false });
$("agendaLinhas").onmouseover = (e) => A.realcarBloco($("agendaLinhas"), e.target);
$("agendaLinhas").onmouseleave = () => A.realcarBloco($("agendaLinhas"), null);
// 0.29: caixa de busca → abre o PEP do paciente em Notas clínicas (por nome nos pacientes já lidos, ou nº do atendimento)
let buscaAchados = [];
function mostrarBusca() {
  const q = $("buscaPaciente").value;
  buscaAchados = SEM_BACKEND ? [] : A.buscarPacientes(q, D?.tasyEstado, D?.tasyAgendaCache);
  $("buscaPacienteLista").innerHTML = buscaAchados.map((p, i) => `<button type="button" data-i="${i}">${p.nome ? `<b>${esc(p.nome)}</b>` : "Atendimento"}${p.atendimento ? ` · atend. ${esc(p.atendimento)}` : ""}</button>`).join("");
  $("buscaPacienteLista").hidden = !q.trim() || !buscaAchados.length;
  $("buscaPacienteMsg").textContent = q.trim() && !buscaAchados.length ? "Não achei — tente o nº do atendimento" : "";
  $("buscaPacienteMsg").title = $("buscaPacienteMsg").textContent;
}
async function abrirBusca(p) {
  if (!p || SEM_BACKEND) return;
  $("buscaPacienteLista").hidden = true;
  $("buscaPacienteMsg").textContent = "";
  const r = await chrome.runtime.sendMessage({ tipo: "abrirPacienteBusca", pessoa: p.pessoa, atendimento: p.atendimento }).catch((e) => ({ erro: e.message }));
  $("buscaPacienteMsg").textContent = r?.erro ? "Não deu: " + r.erro : "";
  $("buscaPacienteMsg").title = $("buscaPacienteMsg").textContent;
}
$("buscaPaciente").oninput = mostrarBusca;
$("buscaPaciente").onfocus = mostrarBusca;
$("buscaPacienteForm").onsubmit = (e) => { e.preventDefault(); mostrarBusca(); if (buscaAchados.length === 1) abrirBusca(buscaAchados[0]); else if (buscaAchados.length) $("buscaPacienteMsg").textContent = "Escolha o paciente na lista."; };
$("buscaPacienteLista").onclick = (e) => { const b = e.target.closest("button[data-i]"); if (b) abrirBusca(buscaAchados[+b.dataset.i]); };
document.addEventListener("click", (e) => { if (!e.target.closest("#buscaPacienteForm")) $("buscaPacienteLista").hidden = true; });
if (SEM_BACKEND) $("buscaPaciente").disabled = true;
if (SEM_BACKEND) {
  $("modoAviso").hidden = false;
  $("modoAviso").textContent = DEMO ? "DEMO · Dados fictícios apenas na Gestão de exames. Agenda sem dados fictícios." : "Fora da extensão · Sem conexão com o TASY. Nenhum dado de demonstração carregado.";
  $("checar").disabled = true;
}

async function atualizar() {
  D = await dados();
  if (!puxando) for (const estado of [gestaoCols, agendaCols]) {
    const origem = DEMO ? Object.fromEntries(["Colunas", "Larguras", "Ocultas"].map((s) => [estado.prefixo + s, lerDemo(estado.prefixo + s)])) : D;
    if (estado === gestaoCols) carregarColunasGestao(origem); else carregarColunas(estado, origem);
  }
  aplicarFonte(+(DEMO ? lerDemo("fontePainel") : D.cfg?.fontePainel) || 13);
  LINHAS = R.linhasPainel(D.tasyEstado, D.vistos, D.tasyNotas, D.tasyAccs).filter((l) => DEMO || R.naJanela(l));
  desenhar();
  desenharAgenda();
  const nt = abertaId && JSON.stringify(LINHAS.find((x) => x.id === abertaId)?.notas || null);
  if (abertaId && !$("gaveta").hidden && nt !== notasDaGaveta) abrirNotas(abertaId);   // evoluções novas chegaram
  notasDaTelaNoModal();
}
const CHAVES_SET = new Set([...CHAVES, "cfg"]);
if (!SEM_BACKEND) {
  let espera = null;
  chrome.storage.onChanged.addListener((mudancas) => {
    if (!Object.keys(mudancas).some((k) => CHAVES_SET.has(k))) return;
    clearTimeout(espera);
    espera = setTimeout(atualizar, 400);
  });
}
setInterval(desenharAgenda, 30000);
setInterval(() => { if (D) desenharTopo(); }, 30000);
atualizar().then(atualizarAgenda);
