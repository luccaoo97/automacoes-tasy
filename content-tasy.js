// Automações TASY — content script do Tasy. SOMENTE LEITURA.
// 1) Gestão de exames: guarda as leituras que o Tasy faz (até 4 filtros — ex.: Tomografia e Ultrassonografia HSI) e
//    repete TODAS a cada 2 min, com a sessão do Artur, juntando os exames. Nunca grava nada no Tasy.
// 2) Descobre sozinho quais campos são "Prescrito por" e "Data baixa", comparando a tabela da tela com os dados.
// 3) Notas clínicas: aprende o pedido quando o Artur abre as notas de um paciente da lista.
// 4) Mapear: guarda só o FORMATO das respostas (campos e valores repetidos), sem pessoas nem textos livres.
(() => {
  const vivo = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  // já injetado e vivo (Mapear/vigia injetam de novo); a cópia de antes de uma atualização fica órfã e é trocada
  if (window.__alertaHsiTasyVivo?.()) return;
  window.__alertaHsiTasyVivo = vivo;
  const R = globalThis.Regras;
  const TOPO = window === window.top;
  const A = globalThis.Agenda;
  const enviar = (m) => { if (vivo()) chrome.runtime.sendMessage(m).catch(() => {}); };
  const log = (msg) => enviar({ tipo: "log", msg: "Tasy: " + msg });

  // ---------- Gestão de exames ----------
  // 0.29: cabeçalho de sessão mais recente visto em qualquer chamada do TASY; vale por cima do guardado no molde
  let cabAtual = {};
  const cabecalhos = (m) => ({ ...(m?.cab || { "Content-Type": "application/json" }), ...cabAtual });
  const linhasDe = (t) => { try { return JSON.parse(t)?.dados?.linhasResultSet || null; } catch { return null; } };
  const MAX_FILTROS = 4;

  async function buscas() {
    const { tasyBuscas, tasyBusca } = await chrome.storage.local.get(["tasyBuscas", "tasyBusca"]);
    return tasyBuscas?.length ? tasyBuscas : tasyBusca ? [tasyBusca] : [];
  }
  async function guardarBusca(b) {
    const lista = (await buscas()).filter((x) => R.chaveBuscaGestao(x) !== R.chaveBuscaGestao(b));
    lista.unshift(b);
    await chrome.storage.local.set({ tasyBuscas: lista.slice(0, MAX_FILTROS), tasyBusca: b });
  }

  async function lerUma(b) {
    return R.lerGestao(b, async (body) => {
      const r = await fetch(b.url, { method: "POST", credentials: "include", cache: "no-store",
        headers: cabecalhos(b), body, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }
  function logInternacao(exames, origem) {
    const campos = [...new Set(exames.map((e) => e.campoInternado).filter(Boolean))];
    if (campos.length) log(`${origem}: classificação de atendimento por ${campos.join(", ")}`);
  }

  let lendoGestao = false, ultimaGestaoEm = 0;
  // lê todos os filtros guardados e manda os exames juntos (um filtro que falhar não apaga os outros)
  async function repetir(porAlarme = false) {
    if (!vivo()) return clearInterval(timer);
    if (lendoGestao) return;
    const agora = Date.now();
    if (porAlarme && agora - ultimaGestaoEm < 90000) return;
    const { cfg } = await chrome.storage.sync.get("cfg");
    const bs = await buscas();
    if (!bs.length || cfg?.tasyAtivo === false) return;
    lendoGestao = true;
    ultimaGestaoEm = agora;
    try {
      const { tasyCampos = {} } = await chrome.storage.local.get("tasyCampos");
      const todas = [];
      let falhas = 0, erro = "";
      for (const b of bs) {
        try { todas.push(...await lerUma(b)); } catch (e) { falhas++; erro = e.message; }
      }
      if (falhas === bs.length) {
        log("leitura falhou: " + erro);
        enviar({ tipo: "tasySessao", ok: false });
        if (TOPO) login.recarregar();   // F5 → tela de login → entra sozinho (se ligado)
        return;
      }
      const accs = {};   // nº de acesso de todas as linhas (qualquer exame): o que está no Tasy não é "Só no PACS"
      for (const r of todas) if (r.NR_ACESSO_DICOM) accs[String(r.NR_ACESSO_DICOM)] = 1;
      const exames = [...new Map(R.tasyExames(todas, tasyCampos).map((e) => [e.id, e])).values()]
        .map((e, i) => ({ ...e, ordem: i + 1 }));
      logInternacao(exames, "Gestão");
      log(`Gestão: ${todas.length} linhas lidas; ${exames.filter((e) => e.tipo === "US").length} US, ${exames.filter((e) => e.tipo === "TC").length} TC; ${falhas} filtro(s) com falha${falhas ? " — " + erro : ""}`);
      enviar({ tipo: "tasyLista", exames, total: todas.length, accs });
    } finally {
      lendoGestao = false;
    }
  }
  const timer = TOPO ? setInterval(repetir, 2 * 60000) : null;
  const login = globalThis.LoginAuto.iniciar({ site: "tasy", nome: "Tasy", log: (m) => enviar({ tipo: "log", msg: m }), enviar });
  if (TOPO) setTimeout(repetir, 8000);   // depois de recarregar/entrar: lê logo, sem esperar 2 min

  // ---------- Manter sessão viva (anti-logout) e responder avisos de inatividade ----------
  let ultimoKeepAliveEm = 0;
  async function manterSessaoViva() {
    if (!vivo()) return;
    await login.tentar();
    if (document.querySelector('input[type="password"]')) return;
    try { window.postMessage({ __alertaHsiKeepAlive: 1 }, location.origin); } catch {}
    // Se o Tasy abrir aviso de "Sua sessão irá expirar / continuar conectado", confirma automaticamente
    for (const cx of document.querySelectorAll(".ngdialog, .modal, [role='dialog'], .w-dialog, .dialog-box")) {
      const r = cx.getBoundingClientRect?.();
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const txt = (cx.innerText || cx.textContent || "").trim();
      if (!/inatividad|expirar|continuar\s+conectad|manter\s+conectad|permanecer\s+conectad/i.test(txt)) continue;
      const bt = [...cx.querySelectorAll("button, input[type='button'], a, [role='button']")]
        .find((b) => /^(continuar|sim|ok|manter|permanecer)$/i.test((b.innerText || b.value || "").trim()));
      if (bt) { bt.click(); log("sessão: aviso de inatividade respondido automaticamente"); }
    }
    const agora = Date.now();
    if (TOPO && agora - ultimoKeepAliveEm > 50000 && agora - ultimaGestaoEm > 50000) {
      ultimoKeepAliveEm = agora;
      fetch(location.origin + "/TasyAppServer/resources/service/WCPanelDataProvider/getDataSource", {
        method: "OPTIONS", credentials: "include", cache: "no-store", headers: cabAtual, signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
  }
  setInterval(manterSessaoViva, 45000);

  // ---------- descobrir colunas ("Prescrito por", "Data baixa") pela tabela da tela ----------
  const COLUNAS = { prescritor: /^prescrito por$/i, baixa: /^data baixa$/i };
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function textosDaColuna(rotulo) {
    const cab = [...document.querySelectorAll("th, [role=columnheader], div, span")]
      .find((el) => el.children.length <= 2 && rotulo.test((el.textContent || "").trim()) && visivel(el));
    if (!cab) return [];
    const rc = cab.getBoundingClientRect(), meio = rc.left + rc.width / 2;
    const vistos = new Set(), out = [];
    for (const el of document.querySelectorAll("td, [role=gridcell], [role=cell]")) {
      const r = el.getBoundingClientRect();
      if (r.top <= rc.bottom || r.left > meio || r.right < meio) continue;
      const t = (el.textContent || "").trim();
      if (t && !vistos.has(t)) { vistos.add(t); out.push(t); }
      if (out.length >= 12) break;
    }
    return out;
  }
  const igualTexto = (cel, v) => { const a = R.sem(cel).replace(/(\.\.\.|…)$/, "").trim(); return a.length > 2 && R.sem(v).startsWith(a); };
  const igualData = (cel, v) => { const a = R.dataTasy(cel), b = R.dataTasy(v); return a && b && Math.abs(a - b) < 61000; };
  async function descobrirCampos(linhas) {
    const { tasyCampos = {} } = await chrome.storage.local.get("tasyCampos");
    let mudou = false;
    for (const [nome, rot] of Object.entries(COLUNAS)) {
      const cels = textosDaColuna(rot);
      if (cels.length < 2) continue;
      const cmp = nome === "baixa" ? igualData : igualTexto;
      let melhor = null, pts = 1;
      for (const k of Object.keys(linhas[0] || {})) {
        if (nome === "prescritor" && !R.campoPrescritorOk(k)) continue;   // só campos de médico (não paciente, usuário…)
        const n = cels.filter((c) => linhas.some((l) => l[k] != null && cmp(c, l[k]))).length;
        if (n > pts) { pts = n; melhor = k; }
      }
      if (melhor && tasyCampos[nome] !== melhor) { tasyCampos[nome] = melhor; mudou = true; log(`coluna "${nome === "baixa" ? "Data baixa" : "Prescrito por"}" = ${melhor}`); }
    }
    // Só categorias técnicas da tabela visível; nunca nomes/IDs/texto clínico.
    if (linhas.some((l) => R.tipoTasy(l) === "US")) {
      const mapa = { status: "etapa", paciente: "nome", "nome do paciente": "nome", exame: "exame", procedimento: "exame",
        atendimento: "atend", "tipo de atendimento": "atend", "prescrito por": "prescritor", "data baixa": "exec",
        "dados clinicos": "clinico", "indicacao clinica": "clinico", "data da prescricao": "prescrito", "data prescricao": "prescrito" };
      const cabecalhos = [...document.querySelectorAll("th, [role=columnheader]")].filter(visivel)
        .map((el) => ({ k: mapa[R.sem(el.textContent).toLowerCase()], x: el.getBoundingClientRect().left }))
        .filter((x) => x.k).sort((a, b) => a.x - b.x);
      const colunas = [...new Set(cabecalhos.map((x) => x.k))];
      if (colunas.includes("exame") && colunas.includes("nome") && JSON.stringify(tasyCampos.colunasUS) !== JSON.stringify(colunas)) {
        tasyCampos.colunasUS = colunas; mudou = true;
      }
      const rotulos = new Set(linhas.map((l) => String(l.DS_STATUS_EXECUCAO || "")).filter(Boolean));
      const statusUS = { ...tasyCampos.statusUS };
      for (const el of document.querySelectorAll("td, [role=gridcell], [role=cell]")) {
        const rotulo = (el.textContent || "").trim();
        if (!rotulos.has(rotulo) || !visivel(el)) continue;
        const estilo = getComputedStyle(el), cor = estilo.color, fundo = estilo.backgroundColor;
        if (!R.corTasyValida(cor) || !R.corTasyValida(fundo) || /rgba\([^)]*,\s*0\)$/.test(fundo)) continue;
        statusUS[rotulo] = { cor, fundo };
      }
      if (JSON.stringify(tasyCampos.statusUS) !== JSON.stringify(statusUS)) { tasyCampos.statusUS = statusUS; mudou = true; }
    }
    if (mudou) { await chrome.storage.local.set({ tasyCampos }); repetir(); }
  }

  // ---------- Mapear ----------
  const PRIV = /^NM_|EMAIL|OBS|ALERGIA|SENHA|DEFICIENCIA|JUSTIFICATIVA|CLINICO|DADO_CLINICO|DS_ITEM|DS_EVOLUCAO|NASC|CPF|TELEFONE|ENDERECO/i;
  const semValores = (u) => {
    try { const x = new URL(u, location.href); return x.pathname + (x.search ? "?" + [...x.searchParams.keys()].join("&") : ""); }
    catch { return String(u).split("?")[0]; }
  };
  const chaves = (t) => { try { const j = JSON.parse(t); return j && typeof j === "object" ? Object.keys(j).slice(0, 40) : []; } catch { return []; } };
  function formato(t) {
    let j; try { j = JSON.parse(t); } catch { return t ? { texto: t.length + " caracteres" } : null; }
    const listas = [];
    const andar = (o, caminho, prof) => {
      if (!o || typeof o !== "object" || prof > 6 || listas.length >= 5) return;
      if (Array.isArray(o)) {
        const objs = o.filter((x) => x && typeof x === "object" && !Array.isArray(x));
        if (objs.length) {
          const f = R.resumoCampos(objs);
          for (const k of Object.keys(f.poucosValores)) if (PRIV.test(k)) delete f.poucosValores[k];
          listas.push({ caminho, ...f });
        }
        if (objs[0]) andar(objs[0], caminho + "[0]", prof + 1);
        return;
      }
      for (const [k, v] of Object.entries(o)) andar(v, caminho + "." + k, prof + 1);
    };
    andar(j, "$", 0);
    return { chaves: Array.isArray(j) ? ["(lista)"] : Object.keys(j).slice(0, 40), listas };
  }

  window.addEventListener("message", async (e) => {
    if (!vivo() || e.source !== window || e.origin !== location.origin) return;
    // Após atualizar sem F5, wrappers MAIN antigos continuam ativos: aceite só o contrato atual.
    if (!e.data?.__alertaHsiTasy || e.data.versao !== 4) return;
    const d = e.data;
    if (d.tipo === "cab") {
      const novo = d.cab && typeof d.cab === "object" ? Object.fromEntries(Object.entries(d.cab).filter(([k, v]) => typeof k === "string" && typeof v === "string")) : {};
      const primeiro = !Object.keys(cabAtual).length;
      cabAtual = novo;
      if (primeiro && Object.keys(novo).length && TOPO) { log("sessão: cabeçalho atual do TASY captado; leituras guardadas seguem sem reabrir as telas"); setTimeout(repetir, 1500); }
      return;
    }
    if (d.lista) {
      const l = linhasDe(d.resp);
      const url = new URL(d.url, location.href).href;
      if (A && /^https:\/\/producao-tasy\.acsc\.org\.br\/TasyAppServer\/resources\/service\/(DataSourceProvider|WCPanelDataProvider)\/getDataSource$/.test(url) && d.metodo === "POST") {
        const contexto = A.contextoLido(d.corpo, l);
        if (contexto) {
          const { tasyContrasteLido = {} } = await chrome.storage.local.get("tasyContrasteLido");
          const agora = Date.now();
          const recentes = Object.fromEntries(Object.entries(tasyContrasteLido).filter(([, v]) => agora - v.em < 15 * 60000).slice(-99));
          recentes[contexto.pessoa] = { em: agora, campos: { ...recentes[contexto.pessoa]?.campos, ...contexto.campos } };
          await chrome.storage.local.set({ tasyContrasteLido: recentes });
          log("Antes do contraste: resposta nativa reconhecida por tableName e CD_PESSOA_FISICA; campos clínicos ainda sem validação hospitalar.");
        }
      }
      if (A?.reconhecer(url, d.metodo, d.corpo)) {
        try {
          A.resposta(d.resp);
        } catch { log("agenda: resposta inválida; aprendendo molde independentemente da resposta"); }
        const modelo = { url, corpo: d.corpo, cab: d.cab || {}, em: Date.now() };
        chrome.runtime.sendMessage({ tipo: "agendaModelo", modelo, nome: A.nomeSala(modelo, l || []) })
          .then((r) => log(r?.aprendido ? "agenda: molde aprendido ✓" : "agenda: " + (r?.erro || "sem confirmação do aprendizado")))
          .catch(() => log("agenda: falha ao enviar molde ao background"));
        return;
      }
      if (A && /\/getDataSource$/.test(new URL(url).pathname)) {
        try {
          const corpo = typeof d.corpo === "string" ? JSON.parse(d.corpo) : d.corpo;
          if ((Array.isArray(corpo) ? corpo : [corpo]).some((x) => x && typeof x === "object" && "filterValues" in x))
            log("agenda: molde recusado — " + A.motivoRecusa(url, d.metodo, d.corpo));
        } catch { /* JSON inválido não permite identificar filterValues. */ }
      }
      if (l?.length && "DS_STATUS_EXECUCAO" in l[0]) {
        // Gestão de exames: guarda este filtro (o Tasy já mandou o cabeçalho de sessão) e lê todos juntos
        await guardarBusca({ url, corpo: d.corpo, cab: d.cab || {}, em: Date.now() });
        setTimeout(() => descobrirCampos(l), 1500);
        if (TOPO) repetir(); else enviar({ tipo: "checarTasyTopo" });
      } else if (l?.length && "DS_EVOLUCAO" in l[0]) {
        await notasDaTela(d.corpo, l);
        // Notas clínicas aberta à mão: aprende o pedido (troca o nº do paciente por um marcador)
        const { tasyEstado = {}, tasyNotasModelo, tasyAgendaCache = {} } = await chrome.storage.local.get(["tasyEstado", "tasyNotasModelo", "tasyAgendaCache"]);
        const exames = [...Object.values(tasyEstado), ...Object.values(tasyAgendaCache).flatMap((c) => c.linhas || [])];
        const m = R.aprenderModelo(d.corpo, exames);
        if (m) {
          if (!tasyNotasModelo) log("aprendi a ler as notas clínicas ✓ (a partir de agora busco sozinho)");
          if (m.marcas.includes("PESSOA") || !tasyNotasModelo?.marcas?.includes("PESSOA"))
            await chrome.storage.local.set({ tasyNotasModelo: { url, corpo: m.corpo, cab: d.cab || {}, marcas: m.marcas, em: Date.now() } });
          const ex = exames.find((x) => x.id === m.de);
          if (ex) enviar({ tipo: "tasyNotas", id: ex.id, resumo: resumirNotasComLog(l) });
        } else if (!tasyNotasModelo) log("notas clínicas vistas, mas o paciente não está na lista da Gestão de exames — abra as notas de um paciente da lista");
      }
    }
    if (!d.mapa || /\.(js|css|png|svg|woff2?|html)(\?|$)/i.test(d.url)) return;
    enviar({ tipo: "tasyMapa", itens: [{
      t: new Date().toLocaleTimeString("pt-BR"), tipo: d.tipo, metodo: d.metodo, url: semValores(d.url),
      pedido: chaves(d.corpo), resposta: formato(d.resp),
    }] });
  });

  // 0.30: plano B — o painel pediu para abrir Notas clínicas + Ctrl+F8 deste paciente; junta as listas que a TELA do TASY
  // carregar (com e sem Ctrl+F8) e guarda o resumo para o modal. Só aceita resposta cujo pedido traz o nº do paciente.
  const telaLinhas = new Map();
  const temNum = (s, n) => !!n && String(n).length >= 5 && new RegExp(`(?<![0-9])${n}(?![0-9])`).test(String(s));
  async function notasDaTela(corpo, linhas) {
    const { tasyNotasTela: t } = await chrome.storage.local.get("tasyNotasTela");
    if (!t || Date.now() - t.pedidoEm > 3 * 60000 || !(temNum(corpo, t.pessoa) || temNum(corpo, t.atendimento))) return;
    const juntas = R.unirEvolucoes(telaLinhas.get(t.pedidoEm) || [], linhas);
    telaLinhas.clear(); telaLinhas.set(t.pedidoEm, juntas);
    const resumo = resumirNotasComLog(juntas);
    await chrome.storage.local.set({ tasyNotasTela: { ...t, resumo, em: Date.now() } });
    if (t.cacheId) enviar({ tipo: "tasyNotas", id: t.cacheId, resumo });
    log(`notas (plano B): ${juntas.length} nota(s) lidas da tela do TASY`);
  }

  // notas clínicas de um paciente, com o pedido aprendido (só leitura)
  async function buscarNotas(ex) {
    const { tasyNotasModelo: mo } = await chrome.storage.local.get("tasyNotasModelo");
    if (!mo) return { erro: "sem modelo" };
    const erro = R.erroModeloNotas(mo, ex);
    if (erro) return { erro };
    const agora = Date.now();
    const listas = [];
    for (const body of R.corposNotas(mo, ex, agora)) {
      const r = await fetch(mo.url, { method: "POST", credentials: "include", cache: "no-store",
        headers: cabecalhos(mo), body, signal: AbortSignal.timeout(12000) });
      if (r.status === 401 || r.status === 403) {
        enviar({ tipo: "tasySessao", ok: false });
        if (TOPO) login.recarregar();
      }
      if (!r.ok) return { erro: "HTTP " + r.status };
      const l = linhasDe(await r.text());
      if (!Array.isArray(l)) return { erro: "Resposta de notas inválida (sessão do TASY ou formato da lista)." };
      listas.push(l);
    }
    const unidas = R.unirEvolucoes(...listas);
    return { resumo: resumirNotasComLog(unidas), motivo: `${unidas.length} nota(s) após união das consultas sem/com Ctrl+F8; sem texto disponível no período de até 90 dias` };
  }

  function resumirNotasComLog(linhas) {
    log("notas: " + JSON.stringify(R.estatisticasNotas(linhas)));
    return R.resumoNotas(linhas);
  }

  async function consultarAgenda(dia, cd) {
    const estado = await chrome.storage.local.get(["tasyAgendaModelo", "tasyAgendaModelos", "tasyAgendaCd"]);
    const sala = A.selecionar(estado, cd ?? estado.tasyAgendaCd), modelo = sala?.modelo;
    if (!modelo) return { erro: A.ATIVAR };
    try {
      const linhas = await A.lerTodas(modelo, dia, async (body) => {
        const r = await fetch(modelo.url, { method: "POST", credentials: "include", cache: "no-store",
          headers: cabecalhos(modelo), body, signal: AbortSignal.timeout(20000) });
        if (r.status === 401 || r.status === 403) {
          enviar({ tipo: "tasySessao", ok: false });
          if (TOPO) login.recarregar();
        }
        if (!r.ok) throw new Error(A.SESSAO);
        return r.text();
      });
      const normalizadas = A.normalizar(linhas, R.dataTasy);
      logInternacao(normalizadas, "Agenda");
      return { ok: true, chave: A.chave(modelo, dia), sala: A.nomeSala(modelo, linhas) || sala.nome, linhas: normalizadas };
    } catch (e) { return { erro: e.message }; }
  }

  // botão "Adicionar nota clínica" do painel: ver nota-tasy.js (roda logo no início da página)


  chrome.runtime.onMessage.addListener((m, _s, responder) => {
    if (m.tipo === "checarLogin") { manterSessaoViva(); return; }
    if (!TOPO) return;
    if (m.tipo === "agendaConsultar") {
      consultarAgenda(m.data, m.cd).then(responder, () => responder({ erro: A.SESSAO }));
      return true;
    }
    if (m.tipo === "ping") { manterSessaoViva(); responder(true); return; }
    if (m.tipo === "mapearTasy") {
      try { localStorage.setItem("alertaHsi.mapear", String(Date.now() + 5 * 60000)); } catch {}
    }
    if (m.tipo === "checarTasy") repetir(!!m.alarme);
    if (m.tipo === "buscarNotas") {
      buscarNotas(m.exame).then(responder, (e) => responder({ erro: /TimeoutError|AbortError/.test(e.name)
        ? "Tempo limite de 12 s excedido ao consultar notas no TASY." : "Falha na busca de notas: " + e.message }));
      return true;
    }
  });
})();
