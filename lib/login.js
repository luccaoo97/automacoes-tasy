// Alerta de Exames HSI — login automático (portal Vue Motion e Tasy). Content script.
// Usuário e senha ficam só neste PC (chrome.storage.local), digitados pelo Artur no ícone da extensão.
// No máximo 3 tentativas seguidas (uma a cada 2 min) para não bloquear a conta.
(() => {
  // depois de a extensão se atualizar, a cópia antiga fica "órfã": só reaproveita se ainda estiver viva
  if (globalThis.LoginAuto?.vivo?.()) return;
  const R = globalThis.Regras;
  const vivo = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const visivel = (el) => {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  };
  const campoSenha = () => [...document.querySelectorAll('input[type="password"]')].find(visivel);

  function preencher(el, valor) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    el.focus();
    if (set) set.call(el, valor); else el.value = valor;
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, data: valor, inputType: "insertText" })); }
    catch { el.dispatchEvent(new Event("input", { bubbles: true })); }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Detecta avisos de "Sessão expirada / encerrada" que aparecem antes do campo de senha e clica para ir ao login
  function fecharAvisoSessaoExpirada() {
    const textosDialogo = [...document.querySelectorAll(".ngdialog, .modal, [role='dialog'], .w-dialog, .dialog-box, .sweet-alert")]
      .filter(visivel);
    for (const cx of textosDialogo) {
      const txt = (cx.innerText || cx.textContent || "").trim();
      if (!/sess[aã]o\s+(foi\s+)?(expir|encerr|finaliz|inv[aá]lid)|desconectad|efetue\s+login|fa[cç]a\s+login/i.test(txt)) continue;
      const bt = [...cx.querySelectorAll("button, input[type='button'], input[type='submit'], a, [role='button']")]
        .find((b) => visivel(b) && /^(ok|entrar|login|reconectar|continuar|confirmar|sim)$/i.test((b.innerText || b.value || "").trim()));
      if (bt) { bt.click(); return true; }
    }
    return false;
  }

  // site: "portal" | "tasy"; chaves no storage: login / loginTasy e loginTentativas / loginTentativasTasy
  function iniciar({ site, nome, log, enviar }) {
    const kLogin = site === "tasy" ? "loginTasy" : "login";
    const kTent = site === "tasy" ? "loginTentativasTasy" : "loginTentativas";
    const kRec = "recarga_" + site;
    let avisou = "";
    const umaVez = (chave, msg, extra) => { if (avisou !== chave) { avisou = chave; log(msg); if (extra) enviar(extra); } };

    async function pacsSemLogin() {
      try { return await chrome.runtime.sendMessage({ tipo: "pacsSemLogin" }) === true; }
      catch { return false; }
    }

    async function tentar() {
      if (site === "portal" && await pacsSemLogin()) return true;
      if (site === "tasy") fecharAvisoSessaoExpirada();
      const senha = campoSenha();
      if (!senha) {
        // Se não há campo de senha na tela e havia tentativas anteriores há mais de 10 s, o login deu certo: zera o contador
        const st = await chrome.storage.local.get(kTent);
        if (st[kTent]?.n && Date.now() - (st[kTent].ultima || 0) > 10000) {
          await chrome.storage.local.remove([kTent, kRec]);
          enviar({ tipo: site === "tasy" ? "tasySessao" : "sessao", ok: true });
        }
        return false;
      }
      const st = await chrome.storage.local.get([kLogin, kTent]);
      const login = st[kLogin], tent = st[kTent];
      const temCredenciais = !!(login?.usuario && login?.senha);
      if (!login?.ativo && !temCredenciais) return umaVez("desligado", `tela de login do ${nome} vista — configure usuário e senha nas Configurações`), true;
      if (!temCredenciais) return umaVez("semdados", `tela de login do ${nome} vista — falta usuário ou senha no ícone`), true;
      if (!R.podeLogar(tent)) {
        if (tent?.n >= 5) umaVez("falhou", `login automático do ${nome}: 5 tentativas — parei`, { tipo: "loginFalhou", site });
        return true;
      }
      avisou = "";
      const n = (tent && Date.now() - tent.ultima < 10 * 60000 ? tent.n : 0) + 1;
      await chrome.storage.local.set({ [kTent]: { n, ultima: Date.now() } });
      const entradas = [...document.querySelectorAll("input")].filter(visivel);
      const antes = entradas.slice(0, entradas.indexOf(senha)).reverse();
      const usuario = antes.find((i) => !/^(password|hidden|checkbox|radio|submit|button|file|image|reset)$/i.test(i.type || "")) ||
        entradas.find((i) => i !== senha && /user|usu[aá]rio|login|matricula/i.test((i.name || "") + " " + (i.id || "") + " " + (i.placeholder || "")));
      if (usuario) preencher(usuario, login.usuario);
      await new Promise((r) => setTimeout(r, 150));
      preencher(senha, login.senha);
      await new Promise((r) => setTimeout(r, 600));
      // o botão pode ficar FORA do formulário (Vue Motion: <button id="login-button">Fazer login</button>) — procura na página toda
      const texto = (b) => (b.innerText || b.textContent || b.value || "").trim();
      const NAO = /esqueci|alterar|forgot|change|cancel|limpar/i, SIM = /fazer login|entrar|login|logon|acessar|sign in|confirmar|^ok$/i;
      const botoes = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')]
        .filter((b) => visivel(b) && !NAO.test(texto(b)));
      const botao = [...document.querySelectorAll("#login-button, #loginButton, #btnLogin, button[ng-click*='login' i], button[type='submit']")].find(visivel) ||
        (senha.form && [...senha.form.querySelectorAll('button[type="submit"], input[type="submit"], button')].find((b) => visivel(b) && !NAO.test(texto(b)))) ||
        botoes.find((b) => /submit/i.test(b.type || "")) || botoes.find((b) => SIM.test(texto(b)));
      const como = botao ? `botão "${(texto(botao) || botao.id || "").slice(0, 20)}"` : senha.form ? "envio do formulário" : "tecla Enter";
      log(`login automático do ${nome} (tentativa ${n} de 5) — usuário ${usuario ? "achado" : "NÃO achado"}, enviando por ${como}`);
      if (botao) botao.click();
      else if (senha.form) senha.form.requestSubmit();
      for (const ev of ["keydown", "keypress", "keyup"])
        senha.dispatchEvent(new KeyboardEvent(ev, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return true;
    }

    // sessão caiu: recarrega a página (F5) para aparecer a tela de login
    async function recarregar(destino) {
      if (site === "portal" && await pacsSemLogin()) return false;
      const st = await chrome.storage.local.get([kLogin, kTent, kRec]);
      const temCredenciais = !!(st[kLogin]?.usuario && st[kLogin]?.senha);
      if ((!st[kLogin]?.ativo && !temCredenciais) || !R.podeLogar(st[kTent])) return false;
      if (Date.now() - (st[kRec] || 0) < 2 * 60000) return false;   // no máximo 1 recarga a cada 2 min
      await chrome.storage.local.set({ [kRec]: Date.now() });
      log(`sessão do ${nome} caiu — recarregando a página para entrar de novo`);
      if (destino) window.top.location.href = destino; else window.top.location.reload();
      return true;
    }

    // a tela de login pode aparecer a qualquer momento (site de uma página só): olha a cada 5 s
    const vigia = setInterval(() => { if (!vivo()) clearInterval(vigia); else tentar(); }, 5000);
    setTimeout(tentar, 1500);
    return { tentar, recarregar };
  }

  globalThis.LoginAuto = { iniciar, vivo };
})();
