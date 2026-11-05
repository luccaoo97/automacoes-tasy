// Alerta de Exames HSI — content script do Vue Motion.
// Não depende dos filtros da tela: monta a própria busca (hoje + CT, todas as páginas) e usa só o "ticket"
// da sessão, que pega da primeira busca que o site fizer. Até o meio-dia busca também os mais recentes sem data
// (plantão que passa da meia-noite).
(() => {
  const vivo = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  if (window.__alertaHsiVivo?.()) return;   // já rodando (a cópia de antes de uma atualização fica órfã e é trocada)
  window.__alertaHsiVivo = vivo;
  const R = globalThis.Regras;
  const TOPO = window === window.top;
  let timer = null;

  const cfg = async () => ({ ...R.PADRAO, ...(await chrome.storage.sync.get("cfg")).cfg });
  const enviar = (m) => { if (vivo()) chrome.runtime.sendMessage(m).catch(() => {}); else clearInterval(timer); };
  const log = (msg) => enviar({ tipo: "log", msg });
  class SessaoCaiu extends Error {}

  async function pedir(url, corpo) {
    const r = await fetch(url, {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" }, body: corpo,
    });
    if (r.status === 401 || r.status === 403 || /login/i.test(r.url)) throw new SessaoCaiu("HTTP " + r.status);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { throw new SessaoCaiu("resposta não é JSON: " + t.slice(0, 80).replace(/\s+/g, " ")); }
    if (!Array.isArray(j?.PtList)) throw new SessaoCaiu("resposta sem lista (campos: " + Object.keys(j || {}).slice(0, 6).join(", ") + ")");
    return j;
  }

  // TC e US: todas as páginas de hoje/ontem a cada ciclo + varredura de 7 dias na carga inicial, manual ou a cada 15 min
  let avisouUS = false, ultimo7dEm = 0;
  async function buscarMod(busca, mod, todas, incluir7d) {
    const ini = todas.size;
    for (let p = 1; p <= 10; p++) {
      const j = await pedir(busca.url, R.corpoPagina(busca.corpo, p, 200, false, mod));
      const l = j?.PtList || [];
      for (const r of l) todas.set(r.Acc, r);
      if (l.length < 200 || (j.TotalPts && todas.size - ini >= j.TotalPts)) break;
    }
    if (!incluir7d) return;
    const limite7d = Date.now() - 7 * 24 * 36e5;
    for (let p = 1; p <= 10; p++) {
      const j = await pedir(busca.url, R.corpoPagina(busca.corpo, p, 200, true, mod));
      const l = j?.PtList || [];
      let antigos = 0;
      for (const r of l) {
        todas.set(r.Acc, r);
        const q = R.dataPacs(r.LastScan) || R.dataPacs(r.Date) || R.dataPacs(r.OFDate);
        if (q && q < limite7d) antigos++;
      }
      if (l.length < 200 || antigos > l.length / 2) break;
    }
  }
  async function buscarTudo(busca, manual = false) {
    const todas = new Map();
    const agora = Date.now();
    const incluir7d = manual || agora - ultimo7dEm > 15 * 60000;
    await buscarMod(busca, "ct", todas, incluir7d);
    try { await buscarMod(busca, "us", todas, incluir7d); }
    catch (e) { if (e instanceof SessaoCaiu) throw e; if (!avisouUS) { avisouUS = true; log("busca de US no PACS falhou: " + e.message); } }
    if (incluir7d) ultimo7dEm = agora;
    return [...todas.values()];
  }

  let ultimaAmostraEm = 0, buscando = false, ultimaBuscaEm = 0;
  async function processar(lista) {
    const c = await cfg();
    const agora = Date.now();
    if (agora - ultimaAmostraEm > 15 * 60000) {
      ultimaAmostraEm = agora;
      await chrome.storage.local.set({ amostra: R.resumoCampos(lista), ultimaLista: lista, loginTentativas: null });
    } else {
      await chrome.storage.local.remove("loginTentativas");
    }
    const exames = lista.filter((r) => R.tipoPacs(r) && R.doHospital(r, c)).map((r) => ({
      acc: r.Acc, tipo: R.tipoPacs(r), exame: R.desc(r.StDesc), nome: R.nome(r), data: r.OFDate, laudo: R.laudado(r),
      quando: R.dataPacs(r.LastScan) || R.dataPacs(r.Date) || R.dataPacs(r.OFDate), medico: r.RefPhys || "", site: r.SiteId,
    }));
    enviar({ tipo: "lista", exames, totalPortal: lista.length });
  }

  // manual = "Checar agora": explica no Log por que não buscou
  async function repetir(manual, porAlarme = false) {
    if (!vivo()) return clearInterval(timer);
    if (buscando) return;
    const c = await cfg();
    if (!c.ativo) return manual && log("checar agora: o monitoramento está desligado nas Configurações");
    const agora = Date.now();
    if (porAlarme && agora - ultimaBuscaEm < Math.max(1, +c.intervaloMin) * 60000 - 10000) return;
    if (!manual && agora - ultimaBuscaEm < 15000) return;
    if (document.querySelector('input[type="password"]')?.offsetParent) return manual && log("checar agora: o portal está na tela de login");
    const { busca } = await chrome.storage.local.get("busca");
    if (!busca?.url) return manual && log("checar agora: ainda não peguei a sessão — entre no portal e espere a lista de exames carregar");
    if (manual) log("checar agora: buscando…");
    buscando = true;
    ultimaBuscaEm = agora;
    try {
      await processar(await buscarTudo(busca, !!manual));
    } catch (e) {
      log("checagem falhou: " + e.message);
      if (e instanceof SessaoCaiu) {
        buscando = false;
        if (await tentarTicketNovo()) { ultimaBuscaEm = 0; return repetir(); }
        enviar({ tipo: "sessao", ok: false });
        relogar();
      }
    } finally {
      buscando = false;
    }
  }

  async function agendar() {
    clearInterval(timer);
    const c = await cfg();
    timer = setInterval(repetir, Math.max(1, +c.intervaloMin) * 60000);
  }

  // qualquer busca do site traz o ticket da sessão; a de CT também serve de modelo
  window.addEventListener("message", async (e) => {
    if (!vivo() || e.source !== window) return;
    if (e.data?.__alertaHsi === "chave") {
      // chave da sessão lida da página (AppConfig.ACLTicket): monta a própria busca, sem depender do site buscar
      const url = location.origin + "/Portal/UIPatientsService/UIPatientsServices.svc/PatientList/json/GetPatientList?ticket=" + encodeURIComponent(e.data.k);
      const { busca: ant } = await chrome.storage.local.get("busca");
      if (ant?.url === url) return;
      await chrome.storage.local.set({ busca: { url, corpo: ant?.corpo || "", em: Date.now() } });
      log("sessão do portal pega da página — monitorando");
      enviar({ tipo: "sessao", ok: true });
      if (TOPO) repetir(); else enviar({ tipo: "checarAgora" });
      return;
    }
    if (e.data?.__alertaHsi !== "busca") return;
    const { busca: ant } = await chrome.storage.local.get("busca");
    const corpo = /"Mod"\s*:\s*"ct"/i.test(e.data.corpo) ? e.data.corpo : ant?.corpo || "";
    const novaSessao = ant?.url !== e.data.url;
    await chrome.storage.local.set({ busca: { url: e.data.url, corpo, em: Date.now() } });
    if (novaSessao) { log("sessão do portal pega — monitorando"); enviar({ tipo: "sessao", ok: true }); }
    if (TOPO) repetir(); else enviar({ tipo: "checarAgora" });
  });

  chrome.runtime.onMessage.addListener((m, _s, responder) => {
    if (m.tipo === "checarLogin") { login.tentar(); return; }
    if (!TOPO) return;
    if (m.tipo === "ping") { login.tentar(); responder(true); return; }
    if (m.tipo === "bip") bip();
    if (m.tipo === "checarAgora") repetir(!m.alarme, !!m.alarme);
    if (m.tipo === "cfgMudou") agendar();
  });

  function bip() {
    try {
      const ac = new AudioContext();
      [0, 0.25].forEach((t) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880; g.gain.value = 0.2;
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.15);
      });
      setTimeout(() => ac.close().catch(() => {}), 600);
    } catch {}
  }

  // ======================= LOGIN AUTOMÁTICO (lib/login.js) =======================
  const login = globalThis.LoginAuto.iniciar({ site: "portal", nome: "portal", log, enviar });
  const relogar = () => login.recarregar(location.origin + "/portal/");

  // depois de entrar de novo, o ticket da sessão muda: procura o novo na própria página (endereço e armazenamento)
  function acharTicket() {
    const fontes = [location.href];
    try { for (const st of [sessionStorage, localStorage]) for (let i = 0; i < st.length; i++) fontes.push(st.key(i) + "=" + st.getItem(st.key(i))); } catch {}
    for (const t of fontes) {
      const m = String(t).match(/ticket["']?\s*[=:]\s*["']?([A-Za-z0-9%+\/=_.-]{16,})/i);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }
  async function tentarTicketNovo() {
    const { busca } = await chrome.storage.local.get("busca");
    const t = acharTicket();
    if (!busca?.url || !t) return false;
    const u = new URL(busca.url);
    if (u.searchParams.get("ticket") === t) return false;
    u.searchParams.set("ticket", t);
    await chrome.storage.local.set({ busca: { ...busca, url: u.href } });
    log("sessão nova do portal achada na página — continuando");
    return true;
  }

  if (TOPO) { agendar(); setTimeout(repetir, 3000); }
})();
