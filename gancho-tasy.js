// Leitura passiva dos pedidos nativos. A repetição usa fetch do mundo ISOLATED.
// 0.29+: repassa também o cabeçalho de sessão de QUALQUER chamada do TasyAppServer (só cabeçalhos, sem corpo), para as
// leituras guardadas continuarem valendo depois de um novo login ou atualização da extensão sem precisar dar F5.
(() => {
  if (window.__alertaHsiTasyAgendaV4) {
    if (window.__alertaHsiUltimoCab) {
      window.postMessage({ __alertaHsiTasy: 1, versao: 4, tipo: "cab", cab: window.__alertaHsiUltimoCab }, location.origin);
    }
    return;
  }
  window.__alertaHsiTasyAgendaV4 = true;
  window.__alertaHsiTasy = true;
  const ehLista = (u) => /\/TasyAppServer\/resources\/service\//i.test(String(u || "")) && !/\/keepAlive|\/ping/i.test(String(u || ""));
  const ligado = () => { try { return +localStorage.getItem("alertaHsi.mapear") > Date.now(); } catch { return false; } };
  const repassar = (tipo, url, metodo, corpo, resp, cab) => {
    if (!ehLista(url) && !ligado()) return;
    window.postMessage({ __alertaHsiTasy: 1, versao: 4, tipo, url: String(url || ""), metodo, corpo, resp,
      lista: ehLista(url), cab, mapa: ligado() }, location.origin);
  };
  const ehServidor = (u) => /\/TasyAppServer\//i.test(String(u || ""));
  let ultimoCab = "";
  const repassarCab = (url, cab) => {
    if (!ehServidor(url) || !cab || !Object.keys(cab).length) return;
    window.__alertaHsiUltimoCab = cab;
    const j = JSON.stringify(cab);
    if (j === ultimoCab) return;
    ultimoCab = j;
    window.postMessage({ __alertaHsiTasy: 1, versao: 4, tipo: "cab", cab }, location.origin);
  };
  const abrir = XMLHttpRequest.prototype.open, enviar = XMLHttpRequest.prototype.send, cabecalho = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (metodo, url) { this.__ah = { metodo, url, cab: {} }; return abrir.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__ah) this.__ah.cab[k] = v; return cabecalho.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (corpo) {
    const i = this.__ah || {};
    try { repassarCab(i.url, i.cab); } catch {}
    if (ligado() || ehLista(i.url)) this.addEventListener("load", () => {
      if (this.status !== 200) return;
      try {
        const t = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        repassar("xhr", i.url, i.metodo, typeof corpo === "string" ? corpo : "", t, i.cab);
      } catch {}
    });
    return enviar.apply(this, arguments);
  };
  const fetchOrig = window.fetch;
  window.fetch = async function (entrada, opcoes) {
    const url = typeof entrada === "string" ? entrada : entrada?.url || entrada?.href;
    const observar = ligado() || ehLista(url);
    try { if (ehServidor(url)) repassarCab(url, Object.fromEntries(new Headers(opcoes?.headers || entrada?.headers || {}))); } catch {}
    let corpo = Promise.resolve(typeof opcoes?.body === "string" ? opcoes.body : "");
    if (observar && opcoes?.body === undefined && typeof entrada?.clone === "function") corpo = entrada.clone().text().catch(() => "");
    const cab = observar ? Object.fromEntries(new Headers(opcoes?.headers || entrada?.headers || {})) : {};
    const resp = await fetchOrig.apply(this, arguments);
    if (observar && resp.ok) Promise.all([corpo, resp.clone().text()]).then(([c, t]) =>
      repassar("fetch", url, opcoes?.method || entrada?.method || "GET", c, t, cab)).catch(() => {});
    return resp;
  };
  // Mantém o detector de inatividade do Angular/Tasy ativo no mundo MAIN para evitar logout por tempo ocioso
  const pulsoAtividade = () => {
    try {
      if (document.querySelector('input[type="password"]')) return;
      const x = 10 + Math.floor(Math.random() * 40), y = 10 + Math.floor(Math.random() * 40);
      for (const alvo of [document, window, document.body].filter(Boolean)) {
        alvo.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        alvo.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Shift", code: "ShiftLeft", keyCode: 16 }));
      }
    } catch {}
  };
  window.addEventListener("message", (e) => {
    if (e.source === window && e.origin === location.origin) {
      if (e.data?.__alertaHsiKeepAlive) pulsoAtividade();
      if (e.data?.__alertaHsiPedirCab && window.__alertaHsiUltimoCab) {
        window.postMessage({ __alertaHsiTasy: 1, versao: 4, tipo: "cab", cab: window.__alertaHsiUltimoCab }, location.origin);
      }
    }
  });
  setInterval(pulsoAtividade, 45000);
})();
