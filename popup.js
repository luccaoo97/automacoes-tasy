// Automações TASY — janelinha do ícone: resumo rápido (sessões, contagens, pendentes) e atalhos.
// O painel completo fica em painel.html; as configurações em config.html.
const R = globalThis.Regras;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hora = (t) => t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
const PORTAL = "https://portalvuemotion.redesantacatarina.org.br/*", TASY = "https://producao-tasy.acsc.org.br/*";
const ETAPA = { prescrito: ["Prescrito", "var(--st-prescrito)"], chegou: ["CDI", "var(--st-cdi)"], "em exame": ["Em exame", "var(--st-exame)"],
  executado: ["Executado", "var(--st-executado)"], laudado: ["Laudado", "var(--st-laudado)"] };
const PEQ = new Set(["da", "de", "do", "das", "dos", "e"]);
const titulo = (s) => /[a-zà-ú]/.test(s || "") ? String(s || "") :
  String(s || "").toLowerCase().replace(/\S+/g, (p, i) => (i && PEQ.has(p)) ? p : p[0].toUpperCase() + p.slice(1));
const laudado = (l) => l.etapa === "laudado" || l.pacs?.laudo;
const DEMO = new URLSearchParams(location.search).has("demo");
const SEM_BACKEND = DEMO || !globalThis.chrome?.storage?.local;
async function ler(chaves) {
  if (!SEM_BACKEND) return chrome.storage.local.get(chaves);
  if (!DEMO) return {};
  if (!window.DEMO) await new Promise((ok) => { const s = document.createElement("script"); s.src = "testes/demo-painel.js"; s.onload = ok; document.head.append(s); });
  return window.DEMO;
}
const abas = async (url) => SEM_BACKEND ? [1] : chrome.tabs.query({ url });

async function mostrar() {
  const D = await ler(["vistos", "tasyEstado", "tasyNotas", "ultima", "tasyUltima", "sessaoOk", "sessaoCaiuEm",
    "tasySessaoOk", "tasyCaiuEm", "busca", "tasyBusca", "tasyAccs"]);
  const agora = Date.now();
  const chip = (el, ultima, caiuEm, okSessao, temBusca, limite) => {
    const ok = ultima && agora - ultima < limite;
    const caiu = okSessao === false && caiuEm && (!ultima || caiuEm > ultima);
    el.className = "chip " + (caiu || (temBusca && ultima && !ok) ? "caiu" : ok ? "ok" : "");
    el.querySelector("span").textContent = caiu ? "sessão caiu" : !temBusca ? "não aberto" : !ultima ? "aguardando"
      : ok ? "ativo · " + hora(ultima) : "parado desde " + hora(ultima);
  };
  chip($("chipPortal"), D.ultima?.em, D.sessaoCaiuEm, D.sessaoOk, !!D.busca, 5 * 60000);
  chip($("chipTasy"), D.tasyUltima?.em, D.tasyCaiuEm, D.tasySessaoOk, !!D.tasyBusca, 6 * 60000);

  const av = [];
  if (SEM_BACKEND) av.push(DEMO ? "DEMO · Dados fictícios, sem conexão com o TASY." : "Fora da extensão · Sem conexão com o TASY; nenhum dado fictício carregado.");
  if (!D.busca) av.push("Abra o portal Vue Motion e entre.");
  else if (!(await abas(PORTAL)).length) av.push("A aba do portal está fechada.");
  if (!D.tasyBusca) av.push("Abra o Tasy na Gestão de exames uma vez.");
  else if (!(await abas(TASY)).length) av.push("A aba do Tasy está fechada.");
  $("avisos").innerHTML = av.map((a) => `<div>${esc(a)}</div>`).join("");

  const linhas = R.linhasPainel(D.tasyEstado, D.vistos, D.tasyNotas, D.tasyAccs).filter((l) => DEMO || R.naJanela(l));
  const cartoes = [
    ["Prescritos", "var(--st-prescrito)", (l) => l.etapa === "prescrito"],
    ["No CDI", "var(--st-cdi)", (l) => l.etapa === "chegou"],
    ["Em exame", "var(--st-exame)", (l) => l.etapa === "em exame"],
    ["Para laudar", "var(--verde)", (l) => (l.pacs || l.etapa === "executado") && !laudado(l)],
  ];
  $("cartoes").innerHTML = cartoes.map(([rot, cor, f]) =>
    `<div class="cartao" style="--cor:${cor}"><div class="n">${linhas.filter(f).length}</div><div class="r">${rot}</div></div>`).join("");

  const pend = R.ordenarPainel(linhas.filter((l) => !laudado(l)));
  $("conta").textContent = pend.length ? `· ${pend.length}` : "";
  $("vazio").hidden = pend.length > 0;
  $("lista").innerHTML = pend.slice(0, 8).map((l) => {
    const [rot, cor] = l.pacs ? ["No PACS", "var(--verde)"] : ETAPA[l.etapa] || ETAPA.prescrito;
    const h = l.pacs?.quando || l.execTasy || l.inicio || l.chegou || l.prescrito;
    return `<li><i class="ponto" style="--cor:${cor}"></i>
      <div class="p-item"><b>${esc(titulo(l.nome) || "—")}</b><span class="sub"><span class="tipo ${esc(l.tipo)}">${esc(l.tipo)}</span>${esc(l.exame)}</span></div>
      <div class="p-hora"><span>${esc(rot)}</span><span class="sub">${hora(h)}</span></div></li>`;
  }).join("") + (pend.length > 8 ? `<li class="mais sub">+ ${pend.length - 8} no painel</li>` : "");
  if (!SEM_BACKEND) chrome.action.setBadgeBackgroundColor({ color: "#555" });
}

$("painel").onclick = async () => {
  if (SEM_BACKEND) { location.href = "painel.html" + (DEMO ? "?demo" : ""); return; }
  const url = chrome.runtime.getURL("painel.html");
  const [aba] = await chrome.tabs.query({ url: url + "*" });
  if (aba) { chrome.tabs.update(aba.id, { active: true }); chrome.windows.update(aba.windowId, { focused: true }); }
  else chrome.tabs.create({ url });
  window.close();
};
$("config").onclick = () => { if (SEM_BACKEND) { location.href = "config.html"; return; } chrome.runtime.openOptionsPage(); window.close(); };
$("checar").disabled = SEM_BACKEND;
$("checar").onclick = async () => {
  if (SEM_BACKEND) return;
  for (const [url, tipo] of [[PORTAL, "checarAgora"], [TASY, "checarTasy"]]) {
    const [a] = await chrome.tabs.query({ url });
    if (a) chrome.tabs.sendMessage(a.id, { tipo }, { frameId: 0 }).catch(() => {});
  }
  $("checar").textContent = "↻ Checando…";
  setTimeout(() => { $("checar").textContent = "↻ Checar agora"; mostrar(); }, 3000);
};
const CHAVES_POPUP = new Set(["vistos", "tasyEstado", "tasyNotas", "ultima", "tasyUltima", "sessaoOk", "sessaoCaiuEm", "tasySessaoOk", "tasyCaiuEm", "busca", "tasyBusca", "tasyAccs"]);
if (!SEM_BACKEND) chrome.storage.onChanged.addListener((m) => { if (Object.keys(m).some((k) => CHAVES_POPUP.has(k))) mostrar(); });
mostrar();
