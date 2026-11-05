// Alerta de Exames HSI — roda DENTRO da página do Vue Motion (mundo MAIN), antes do site carregar.
// Só observa a busca de exames que o próprio site faz (GetPatientList) e repassa endereço, filtros e resposta
// para o content.js. Não altera nada do site.
(() => {
  if (window.__alertaHsiGancho) return;
  window.__alertaHsiGancho = true;

  const ehLista = (u) => /GetPatientList\b/i.test(String(u || ""));
  const avisar = (url, corpo, resp) => {
    try {
      window.postMessage({ __alertaHsi: "busca", url: new URL(url, location.href).href, corpo, resp }, location.origin);
    } catch {}
  };

  // A chave da sessão fica em window.AppConfig.ACLTicket (o content script não enxerga variáveis da página).
  // Repassa quando aparece ou muda — assim a extensão busca logo depois do login, sem esperar o site fazer uma busca.
  let chaveAnt = "";
  const repassarChave = () => {
    try {
      const k = window.AppConfig && window.AppConfig.ACLTicket;
      if (k && k !== chaveAnt) { chaveAnt = k; window.postMessage({ __alertaHsi: "chave", k: String(k) }, location.origin); }
    } catch {}
  };
  setInterval(repassarChave, 5000);
  window.addEventListener("load", () => setTimeout(repassarChave, 1500));

  const abrir = XMLHttpRequest.prototype.open;
  const enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__ahUrl = url;
    return abrir.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    if (ehLista(this.__ahUrl) && typeof corpo === "string") {
      this.addEventListener("load", () => { if (this.status === 200) avisar(this.__ahUrl, corpo, this.responseText); });
    }
    return enviar.apply(this, arguments);
  };

  const fetchOrig = window.fetch;
  window.fetch = async function (entrada, opcoes) {
    const resp = await fetchOrig.apply(this, arguments);
    try {
      const url = typeof entrada === "string" ? entrada : entrada?.url;
      if (ehLista(url) && typeof opcoes?.body === "string" && resp.ok) {
        resp.clone().text().then((t) => avisar(url, opcoes.body, t)).catch(() => {});
      }
    } catch {}
    return resp;
  };
})();
