// Automações TASY — botão "Adicionar nota clínica" do painel, lado do Tasy.
// 0.21: primeiro tenta SEM recarregar (trocarPaciente, Localizar paciente); se falhar, o background recarrega na rota.
// Ordem (0.20.5): Notas clínicas › Adicionar assim que a árvore do PEP aparece; o SUEP é fechado quando surgir.
// Roda em document_start (antes o content-tasy.js só começava em document_idle, que no Tasy demora): assim que o
// aviso de motivo, o SUEP ou a árvore do PEP aparecem, já age. Cada linha do Log diz quantos segundos depois do início
// da página aconteceu (t=…s), para achar onde o tempo vai.
(() => {
  const vivo = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  // já injetado e vivo; a cópia de antes de uma atualização da extensão fica órfã e é trocada
  if (window !== window.top || window.__alertaHsiNotaVivo?.()) return;
  window.__alertaHsiNotaVivo = vivo;
  let inicio = 0;   // caminho rápido: conta a partir do clique no painel; recarga: do início da página
  const t = () => ((performance.now() - inicio) / 1000).toFixed(1);
  const log = (msg) => { if (vivo()) chrome.runtime.sendMessage({ tipo: "log", msg: `Tasy: ${msg} (t=${t()}s)` }).catch(() => {}); };
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // O background abriu #/atepaceh/patientid/<pessoa>/episode/<atendimento> (PEP do paciente) e recarregou. Aqui, com os
  // elementos vistos na tela real (16/10, v0.20.2):
  // 1) aviso "Motivo do acesso": lista div.w-listbox[role=combobox] → opção a[role=option] "Assistencia Indireta ao
  //    Paciente" → OK = button.btn-blue em .dialog-footer (pedido do Artur: sempre indireta);
  // 2) o Tasy abre o SUEP por cima → fecha a aba dele (button.w-header-tab__close; testado 16/10, v0.20.3);
  // 3) árvore do PEP: span.wtree-span "Notas clínicas"; 4) button.handlebar-button "Adicionar". Nunca salva nada.
  // Quando a aba do TASY está em segundo plano (ex.: carregando notas sem tirar o usuário do painel),
  // usa o timer do Service Worker (background.js) para não sofrer throttling de aba oculta do Chrome.
  const espera = (ms) => document.hidden && vivo()
    ? chrome.runtime.sendMessage({ tipo: "esperar", ms }).catch(() => new Promise((r) => setTimeout(r, ms)))
    : new Promise((r) => setTimeout(r, ms));
  const esperarMutacao = (ms = 150) => new Promise((ok) => {
    let fim = false, t1 = null;
    const encerrar = () => { if (fim) return; fim = true; clearTimeout(t0); clearTimeout(t1); obs.disconnect(); ok(); };
    const obs = new MutationObserver(() => { if (!t1) t1 = setTimeout(encerrar, 35); });
    const t0 = setTimeout(encerrar, ms);
    if (document.hidden && vivo()) chrome.runtime.sendMessage({ tipo: "esperar", ms }).then(encerrar).catch(() => {});
    if (document.documentElement) obs.observe(document.documentElement, { childList: true, subtree: true });
  });
  const textoDe = (el) => (el.innerText || el.textContent || "").trim();
  const menor = (els) => els.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
  const acharVis = (sel, re) => menor([...document.querySelectorAll(sel)].filter((el) => visivel(el) && re.test(textoDe(el))));
  const clicar = (el) => {
    for (const t of ["mousedown", "mouseup"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    el.click();
  };
  const caixaMotivo = () => acharVis(".dialog-footer button", /^ok$/i) &&
    menor([...document.querySelectorAll("div.w-listbox[role=combobox]")].filter(visivel));
  async function motivoIndireto(lista) {
    if (!/indireta/i.test(textoDe(lista))) {
      clicar(lista);
      let op = null;
      for (let k = 0; k < 12 && !op; k++) { await espera(150); op = acharVis("[role=option]", /indireta/i); }
      if (!op) return false;
      clicar(op);
      await espera(200);
    }
    const ok = acharVis(".dialog-footer button", /^ok$/i);
    if (!ok || !/indireta/i.test(textoDe(lista))) return false;
    clicar(ok);
    return true;
  }
  // ---------- caminho rápido (0.21, medido 16/10): sem recarregar o Tasy ----------
  // PEP sem paciente tem "Localizar paciente" (0,3 s para abrir a busca). PEP com paciente: fecha a aba dele
  // (button.w-header-tab__close) e abre de novo pelo menu inicial (~3,4 s). Busca: guia div.wtab "Atendimento" →
  // campo "Número do atendimento" (div.w-attr-container) → button.wfilter-button "Filtrar" → a linha já vem marcada →
  // OK = button.handlebar-button--right.btn-blue. Motivo do acesso aparece ~3,3 s depois. Falhou = volta para a recarga.
  const porTexto = (exato) => {   // XPath: bem mais leve que varrer todos os elementos com innerText
    const r = document.evaluate(`//*[normalize-space(text())=${JSON.stringify(exato)}]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < r.snapshotLength; i++) if (visivel(r.snapshotItem(i))) return r.snapshotItem(i);
    return null;
  };
  const comeca = (ini) => {
    const r = document.evaluate(`//*[starts-with(normalize-space(text()),${JSON.stringify(ini)})]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < r.snapshotLength; i++) if (visivel(r.snapshotItem(i))) return r.snapshotItem(i);
    return null;
  };
  const ate = async (f, ms = 6000) => { const lim = Date.now() + ms; while (Date.now() < lim) { const x = f(); if (x) return x; await esperarMutacao(150); } return null; };
  // devolve "" (deu certo), um texto (falhou → o background recarrega) ou "!texto" (parar sem recarregar)
  async function fecharTelas() {
    for (const aba of [...document.querySelectorAll("div.w-header-tab")]) {
      aba.querySelector("button.w-header-tab__close")?.click();
      if (!await ate(() => !aba.isConnected, 2500)) return "!Há uma tela não salva ou que não pôde ser fechada; salve/feche e tente novamente.";
    }
    return "";
  }
  async function trocarPaciente(p) {
    // PEP à vista e sem paciente: usa direto. Senão fecha as telas abertas (qualquer uma: Gestão, PEP, SUEP…) —
    // sem nenhuma, o Tasy mostra o menu inicial com o PEP (testado 16/10). Nada de trazer aba para a frente.
    let loc = porTexto("Meus pacientes") && porTexto("Localizar paciente");
    if (!loc) {
      const erro = await fecharTelas();
      if (erro) return erro;
      const item = await ate(() => comeca("Prontuário Eletrônico"), 4000);
      if (!item) return "menu inicial sem o PEP";
      clicar(item);
      loc = await ate(() => porTexto("Localizar paciente"), 10000);
      if (!loc) return "PEP não abriu";
    }
    clicar(loc);
    const campoAt = () => [...document.querySelectorAll("div.w-attr-container")].filter(visivel)
      .find((c) => /^n[uú]mero do atendim/i.test(textoDe(c.querySelector(".w-attr-container__label") || c)))?.querySelector("input");
    let campo = await ate(campoAt, 1200);   // o Tasy lembra a última guia: só clica em "Atendimento" se precisar
    if (!campo) {
      const guia = await ate(() => acharVis("div.wtab span", /^atendimento$/i));
      if (!guia) return "sem a guia Atendimento";
      clicar(guia);
      campo = await ate(campoAt);
    }
    if (!campo) return "sem o campo do atendimento";
    campo.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(campo, String(p.atendimento));
    for (const ev of ["input", "change"]) campo.dispatchEvent(new Event(ev, { bubbles: true }));
    const filtrar = await ate(() => acharVis("button.wfilter-button", /^filtrar$/i), 3000);
    if (filtrar) filtrar.click();
    else for (const t of ["keydown", "keyup"]) campo.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    if (!await ate(() => porTexto(String(p.atendimento)), 8000)) return "atendimento não achado na busca";
    const ok = await ate(() => acharVis("button.handlebar-button--right", /^ok$/i), 3000);
    if (!ok) return "sem o OK da busca";
    clicar(ok);
    log("PEP: paciente aberto sem recarregar");
    return "";
  }

  async function irParaNota(rapido) {
    const { tasyAbrirNota: p } = await chrome.storage.local.get("tasyAbrirNota");
    if (!p || p.ate < Date.now()) return;
    const fim = () => chrome.storage.local.remove("tasyAbrirNota");
    const rota = p.rota || `#/atepaceh/patientid/${encodeURIComponent(p.pessoa)}` +
      (p.atendimento ? `/episode/${encodeURIComponent(p.atendimento)}` : "");
    const naRota = () => rapido || location.hash.split("?")[0] === rota;
    let etapa = "motivo", motivoTentou = 0, fora = 0, feitoEm = 0;
    while (Date.now() < p.ate) {
      await esperarMutacao(feitoEm ? 400 : 150);
      // o SUEP abre por cima do PEP (aba div.w-header-tab "Sumário Eletrônico…"), às vezes bem depois do PEP pronto:
      // fecha no X dele a qualquer momento, inclusive depois do Adicionar (vigia mais 30 s)
      const suep = [...document.querySelectorAll("div.w-header-tab")].find((t) => visivel(t) && /^Sum[aá]rio Eletr/i.test(textoDe(t)));
      const xSuep = suep?.querySelector("button.w-header-tab__close");
      if (xSuep) { xSuep.click(); log("PEP: fechei o Sumário Eletrônico (SUEP)"); continue; }
      if (feitoEm) { if (Date.now() - feitoEm > 30000) return fim(); continue; }
      const lista = caixaMotivo();
      if (lista) {
        if (!motivoTentou) log("aviso de motivo do acesso apareceu");
        if (motivoTentou++ < 3) { if (await motivoIndireto(lista)) { log("motivo do acesso: indireta ✓"); etapa = "notas"; } }
        else if (motivoTentou === 4) log("não consegui escolher o motivo do acesso — escolha à mão");
        continue;
      }
      // o Tasy voltou para a tela inicial antes de abrir o PEP: troca a rota de novo e recarrega (no máximo 2 vezes)
      if (etapa === "motivo" && !naRota() && document.querySelector("header.w-header")) {   // só com o Tasy já montado
        if (++fora < 20) continue;   // dá 3 s para a rota assentar
        if ((p.tentativas || 0) >= 2 || !p.rota) { log("PEP: o Tasy não abriu o prontuário — abra à mão"); return fim(); }
        await chrome.storage.local.set({ tasyAbrirNota: { ...p, tentativas: (p.tentativas || 0) + 1 } });
        log("PEP: o Tasy caiu na tela inicial, tentando de novo");
        location.hash = p.rota;
        setTimeout(() => location.reload(), 800);
        return;
      }
      fora = 0;
      // Prontuário (0.29) abre Notas clínicas, sem Adicionar; CPOE vai para a aba/item CPOE; pedido externo vai ao item dele. Depois só vigia o SUEP.
      if (p.modo === "prontuario" || p.modo === "cpoe" || p.modo === "pedido" || p.modo === "notasF8") {
        const pep = acharVis("li.angular-ui-tree-node span.wtree-span", /^notas? cl[ií]nicas?$/i);
        const cpoeItem = p.modo === "cpoe" && (acharVis("li.angular-ui-tree-node span.wtree-span, span.wtree-span, [role=treeitem] span, div.wtab span", /^cpoe$/i) || acharVis("li.angular-ui-tree-node span.wtree-span, span.wtree-span", /\bcpoe\b/i));
        if (naRota() && (pep || cpoeItem)) {
          if (p.modo === "cpoe") {
            const alvoCpoe = cpoeItem || await ate(() => acharVis("li.angular-ui-tree-node span.wtree-span, span.wtree-span, [role=treeitem] span, div.wtab span", /^cpoe\b|\bcpoe$/i), 2500);
            if (alvoCpoe) { clicar(alvoCpoe); log("PEP: CPOE aberto ✓"); }
            else { if (pep) clicar(pep); log("PEP: item CPOE não localizado na árvore; prontuário aberto"); }
          } else if (p.modo === "pedido") {
            const pedido = acharVis("li.angular-ui-tree-node span.wtree-span", /^pedido de exame externo$/i);
            if (pedido) { clicar(pedido); log("PEP: Pedido de exame externo aberto por rótulo; URL do arquivo não comprovada"); }
            else log("PEP: Pedido de exame externo não detectado; prontuário aberto como destino disponível");
          } else { clicar(pep); log("PEP: prontuário aberto em Notas clínicas ✓"); }
          if (p.modo === "notasF8") {   // 0.30: plano B — espera a lista carregar e aperta Ctrl+F8 (todas as notas do paciente)
            await ate(() => acharVis("button.handlebar-button", /^adicionar$/i) || acharVis("[role=grid], .w-datagrid", /./), 4000);
            await espera(500);
            const alvo = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
            for (const tipo of ["keydown", "keyup"]) for (const el of [alvo, document])
              el.dispatchEvent(new KeyboardEvent(tipo, { key: "F8", code: "F8", keyCode: 119, which: 119, ctrlKey: true, bubbles: true, cancelable: true }));
            log("PEP: Ctrl+F8 enviado nas Notas clínicas");
          }
          feitoEm = Date.now();
        }
        continue;
      }
      const bt = acharVis("button.handlebar-button", /^adicionar$/i);
      if (bt && etapa === "aberta") {
        clicar(bt);
        log("PEP: Adicionar nota clínica ✓");
        feitoEm = Date.now();
        continue;
      }
      const item = acharVis("li.angular-ui-tree-node span.wtree-span", /^notas? cl[ií]nicas?$/i);
      if (item) { if (etapa !== "aberta") { clicar(item); etapa = "aberta"; log("PEP: Notas clínicas aberta"); } continue; }
    }
    if (feitoEm) return fim();
    log(`PEP: parei em "${etapa === "motivo" ? "motivo do acesso" : etapa === "notas" ? "Notas clínicas" : "Adicionar"}" — continue à mão`);
    fim();
  }
  chrome.storage.local.get("tasyAbrirNota").then(({ tasyAbrirNota: p }) => {
    if (p && p.ate > Date.now() && document.readyState === "loading") { log("PEP: página começou, esperando o Tasy"); irParaNota(false); }
  });
  chrome.runtime.onMessage.addListener((m, _s, responder) => {
    if (m.tipo !== "notaRapida") return;
    chrome.storage.local.get("tasyAbrirNota").then(async ({ tasyAbrirNota: p }) => {
      if (!p) return responder({ erro: "sem pedido" });
      inicio = performance.now();
      log("PEP: caminho rápido começou");
      if (p.ate < Date.now()) return responder({ erro: "pedido vencido" });
      if (p.usarRota) {
        const erro = await fecharTelas().catch(() => "!Não foi possível conferir as telas abertas.");
        responder(erro ? { parar: true, erro: erro.replace(/^!/, "") } : { rota: true });
        return;
      }
      const erro = await trocarPaciente(p).catch((e) => e.message);
      if (erro) log("PEP: caminho rápido parou — " + erro.replace(/^!/, ""));
      responder(erro ? { erro: erro.replace(/^!/, ""), parar: erro.startsWith("!") } : { ok: true });
      if (!erro) irParaNota(true);
    });
    return true;
  });
})();
