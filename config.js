// Alerta de Exames HSI — página de configurações. Salva sozinha a cada mudança.
const R = globalThis.Regras, PADRAO = R.PADRAO;
const $ = (id) => document.getElementById(id);
const PORTAL = "https://portalvuemotion.redesantacatarina.org.br/*", TASY = "https://producao-tasy.acsc.org.br/*";
const DEMO = !globalThis.chrome?.storage?.sync;   // aberta fora da extensão (teste visual)
if (!DEMO) $("versao").textContent = "versão " + chrome.runtime.getManifest().version;

function avisarSalvo() {
  $("salvo").classList.add("mostra");
  clearTimeout(avisarSalvo.t); avisarSalvo.t = setTimeout(() => $("salvo").classList.remove("mostra"), 1500);
}

// ---------- configurações gerais (chrome.storage.sync.cfg) ----------
async function carregar() {
  const cfg = { ...PADRAO, ...(DEMO ? {} : (await chrome.storage.sync.get("cfg")).cfg) };
  for (const k of Object.keys(PADRAO)) {
    const el = $(k); if (!el) continue;
    if (el.type === "checkbox") el.checked = !!cfg[k]; else el.value = cfg[k];
  }
}
async function salvar() {
  if (DEMO) return avisarSalvo();
  const cfg = { ...(await chrome.storage.sync.get("cfg")).cfg };
  for (const k of Object.keys(PADRAO)) {
    const el = $(k); if (!el) continue;
    cfg[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value.trim();
  }
  await chrome.storage.sync.set({ cfg });
  const [a] = await chrome.tabs.query({ url: PORTAL });
  if (a) chrome.tabs.sendMessage(a.id, { tipo: "cfgMudou" }).catch(() => {});
  avisarSalvo();
}
for (const k of Object.keys(PADRAO)) $(k)?.addEventListener("change", salvar);

$("gerarTopico").onclick = () => { $("ntfyTopico").value = "hsi-" + crypto.getRandomValues(new Uint32Array(3)).join("").slice(0, 20); salvar(); };
$("testarNtfy").onclick = async () => { await salvar(); if (!DEMO) chrome.runtime.sendMessage({ tipo: "testarNtfy" }); };
$("abrirPainel").onclick = async () => {
  if (DEMO) return;
  const url = chrome.runtime.getURL("painel.html");
  const [aba] = await chrome.tabs.query({ url: url + "*" });
  if (aba) chrome.tabs.update(aba.id, { active: true }); else chrome.tabs.create({ url });
};

// ---------- login automático: só no chrome.storage.local deste PC (nunca no sync) ----------
for (const [p, kLogin, kTent] of [["login", "login", "loginTentativas"], ["loginTasy", "loginTasy", "loginTentativasTasy"]]) {
  if (DEMO) break;
  chrome.storage.local.get(kLogin).then((st) => {
    const l = st[kLogin];
    $(p + "Ativo").checked = !!l?.ativo;
    $(p + "Usuario").value = l?.usuario || "";
    $(p + "Senha").placeholder = l?.senha ? "(guardada)" : "";
  });
  const gravar = async (forcarAtivo = false) => {
    const ant = (await chrome.storage.local.get(kLogin))[kLogin];
    const usuario = $(p + "Usuario").value.trim(), senha = $(p + "Senha").value || ant?.senha || "";
    if (forcarAtivo && usuario && senha) $(p + "Ativo").checked = true;
    const l = { ativo: $(p + "Ativo").checked, usuario, senha };
    await chrome.storage.local.set({ [kLogin]: l, [kTent]: null, ["recarga_" + (kLogin === "loginTasy" ? "tasy" : "portal")]: null });
    $(p + "Senha").value = ""; $(p + "Senha").placeholder = l.senha ? "(guardada)" : "";
    $(p + "Ok").textContent = "salvo ✓"; avisarSalvo();
  };
  $(p + "Salvar").onclick = () => gravar(true);
  $(p + "Ativo").onchange = () => gravar(false);
}

// ---------- log ----------
async function mostrarLog() {
  if (DEMO) { $("log").textContent = "10:31 Tasy: lista inicial com 12 exame(s) de TC/US\n10:30 sessão do portal pega da página — monitorando"; return; }
  const { log = [] } = await chrome.storage.local.get("log");
  $("log").textContent = log.join("\n") || "(vazio)";
}
if (!DEMO) chrome.storage.onChanged.addListener((m, area) => { if (area === "local" && m.log) mostrarLog(); });

// ---------- ferramentas de diagnóstico ----------
const saida = (t) => { $("saida").hidden = false; $("saida").textContent = t; };
$("descobrir").onclick = async () => {
  if (DEMO) return saida("(teste)");
  const { amostra, busca } = await chrome.storage.local.get(["amostra", "busca"]);
  saida(amostra ? "Pode colar na conversa (sem nomes de pacientes):\n\n" + JSON.stringify({ ...amostra, filtrosDaBusca: busca?.corpo }, null, 1)
    : "Abra o portal e espere uma leitura primeiro.");
};
$("acharHsi").onclick = async () => {
  if (DEMO) return saida("(teste)");
  const { ultimaLista = [] } = await chrome.storage.local.get("ultimaLista");
  saida(ultimaLista.length ? JSON.stringify(R.acharCampoHospital(ultimaLista, $("nomesHsi").value.split("\n")), null, 1)
    : "Ainda não há lista — deixe o portal aberto e clique em Checar agora.");
};
// mapeia a aba do Tasy (injeta os scripts nela, mesmo se foi aberta antes da extensão)
$("mapear").onclick = async () => {
  if (DEMO) return;
  const [a] = await chrome.tabs.query({ url: TASY });
  const r = a && await chrome.runtime.sendMessage({ tipo: "mapearAba", tabId: a.id });
  $("mapear").textContent = r?.ok ? "Mapeando… (5 min) — use o Tasy" : "Não deu: " + (r?.erro || "abra o Tasy numa aba");
};
const contarMapa = async () => {
  if (DEMO) return;
  const { tasyMapa = [] } = await chrome.storage.local.get("tasyMapa");
  $("contaMapa").textContent = tasyMapa.length ? `${tasyMapa.length} item(ns) no mapa` : "";
};
$("verMapa").onclick = async () => {
  if (DEMO) return;
  const { tasyMapa = [] } = await chrome.storage.local.get("tasyMapa");
  saida(tasyMapa.length ? JSON.stringify(tasyMapa, null, 1) : "Mapa vazio — clique em Mapear e use o Tasy.");
};
$("limparMapa").onclick = async () => { if (!DEMO) await chrome.storage.local.remove("tasyMapa"); $("saida").hidden = true; contarMapa(); };

carregar(); mostrarLog(); contarMapa(); setInterval(contarMapa, 3000);
