// Agenda de Exames AtePacA1: contrato de leitura observado em 03/11/2026.
(() => {
  const SALA = "Ultrassonografia - Sala 1", FUSO = "America/Sao_Paulo";
  const CHAVES_VINCULO = [["NR_PRESCRICAO", "NR_PRESCR"], ["NR_SEQ_AGENDA", "NR_SEQ_INTERNO"]];
  const ATIVAR = "abra Agenda de Exames > Ultrassonografia - Sala 1 > Filtrar uma vez para ativar";
  const SESSAO = "sessão do TASY indisponível";
  const RECARREGAR = "recarregue a aba do TASY (F5) uma vez";
  const objeto = (v) => v && typeof v === "object" && !Array.isArray(v);
  const json = (v) => typeof v === "string" ? JSON.parse(v) : v;
  function dataValida(d) {
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  }
  function hoje(agora = Date.now()) {
    const p = new Intl.DateTimeFormat("en", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
    const v = (k) => p.find((x) => x.type === k).value;
    return `${v("year")}-${v("month")}-${v("day")}`;
  }
  function deslocar(d, n) {
    if (!dataValida(d)) throw new Error("Escolha uma data válida.");
    return new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  }
  function motivoRecusa(url, metodo, corpo) {
    try {
      const u = new URL(url, "https://producao-tasy.acsc.org.br");
      if (u.origin !== "https://producao-tasy.acsc.org.br") return "origem inválida";
      if (u.pathname !== "/TasyAppServer/resources/service/DataSourceProvider/getDataSource") return "caminho diferente de DataSourceProvider/getDataSource";
      if (String(metodo).toUpperCase() !== "POST") return "método deve ser POST";
      const a = json(corpo), f = Array.isArray(a) && a.length === 1 && a[0]?.filterValues;
      if (!Array.isArray(a) || a.length !== 1 || !objeto(a[0])) return "corpo deve ser array de um objeto";
      if (!objeto(f)) return "filterValues ausente ou inválido";
      if (!(typeof f.CD_AGENDA === "number" && Number.isFinite(f.CD_AGENDA)) &&
          !(typeof f.CD_AGENDA === "string" && /^\d+$/.test(f.CD_AGENDA.trim()))) return "CD_AGENDA deve ser número ou string numérica";
      if (!objeto(f.DT_INICIAL) || typeof f.DT_INICIAL.value !== "string") return "DT_INICIAL deve ser objeto com value string";
      return "";
    } catch { return "URL ou JSON inválido"; }
  }
  function reconhecer(url, metodo, corpo) {
    return motivoRecusa(url, metodo, corpo) ? null : json(corpo)[0];
  }
  function dataNoFormato(dia, molde) {
    if (!dataValida(dia)) throw new Error("Escolha uma data válida.");
    let instante = Date.parse(dia + "T03:00:00Z");
    const partes = new Intl.DateTimeFormat("en", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let i = 0; i < 2; i++) {
      const p = partes.formatToParts(instante), v = (k) => p.find((x) => x.type === k).value;
      instante += Date.parse(dia + "T00:00:00Z") - Date.parse(`${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}:${v("second")}Z`);
    }
    const iso = String(molde).match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    if (iso) {
      const fracao = iso[1] ? "." + "0".repeat(iso[1].length - 1) : "";
      if (iso[2] === "Z") return new Date(instante).toISOString().slice(0, 19) + fracao + "Z";
      const sinal = iso[2][0] === "-" ? -1 : 1, minutos = sinal * (+iso[2].slice(1, 3) * 60 + +iso[2].slice(4));
      return new Date(instante + minutos * 60000).toISOString().slice(0, 19) + fracao + iso[2];
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(molde)) return dia;
    const br = String(molde).match(/^\d{2}\/\d{2}\/\d{4}( [0-9]{2}:[0-9]{2}(:[0-9]{2})?)?$/);
    if (br) return dia.slice(8) + "/" + dia.slice(5, 7) + "/" + dia.slice(0, 4) + (br[1] ? " 00:00" + (br[2] ? ":00" : "") : "");
    throw new Error("Formato de DT_INICIAL ainda não reconhecido; filtre novamente no TASY.");
  }
  function corpo(modelo, dia, pagina = 0, recebidas = 0) {
    const p = reconhecer(modelo.url, "POST", modelo.corpo);
    if (!p) throw new Error(ATIVAR);
    const a = JSON.parse(JSON.stringify([p])), x = a[0];
    x.filterValues.DT_INICIAL.value = dataNoFormato(dia, x.filterValues.DT_INICIAL.value);
    x.page = (p.page === 0 ? 0 : 1) + pagina;
    x.inicioPagina = (p.inicioPagina === 1 ? 1 : 0) + recebidas;
    return JSON.stringify(a);
  }
  function resposta(raw) {
    const d = json(raw)?.dados;
    if (!objeto(d) || !Array.isArray(d.linhasResultSet) || !Number.isSafeInteger(d.qtTotalRegistros) || d.qtTotalRegistros < 0 || d.linhasResultSet.some((l) => !objeto(l))) throw new Error(SESSAO);
    return d;
  }
  async function lerTodas(modelo, dia, pedir) {
    const linhas = [], vistos = new Set(); let total = null;
    for (let pagina = 0; pagina < 50; pagina++) {
      const d = resposta(await pedir(corpo(modelo, dia, pagina, linhas.length)));
      if (total !== null && total !== d.qtTotalRegistros) throw new Error("Agenda mudou durante a leitura; atualize novamente.");
      total = d.qtTotalRegistros;
      if (total > 5000) throw new Error("Agenda excedeu o limite seguro de leitura.");
      for (const l of d.linhasResultSet) {
        const id = JSON.stringify([l.NR_SEQUENCIA, l.HR_INICIO, l.DT_AGENDA]);
        if (vistos.has(id)) throw new Error("Paginação repetida; atualize novamente.");
        vistos.add(id); linhas.push(l);
      }
      if (linhas.length >= total) return linhas;
      if (!d.linhasResultSet.length) throw new Error("Agenda incompleta; atualize novamente.");
    }
    throw new Error("Agenda excedeu o limite seguro de páginas.");
  }
  function normalizar(linhas, dataTasy) {
    return linhas.map((l) => ({ id: String(l.NR_SEQUENCIA), inicio: dataTasy(l.HR_INICIO || l.DT_AGENDA),
      duracao: typeof l.NR_MINUTO_DURACAO === "number" ? l.NR_MINUTO_DURACAO : null,
      nome: l.NM_PACIENTE || l.NM_PACIENTE_AGENDA || "", idade: l.QT_IDADE_PACIENTE ?? "",
      exames: [l.DS_PROCEDIMENTO || l.DS_PROC_INTERNO, l.DS_EXAME_ADIC].filter(Boolean).join(" · "),
      examesLista: [l.DS_PROCEDIMENTO || l.DS_PROC_INTERNO, ...separarExames(l.DS_EXAME_ADIC)].filter(Boolean),
      status: [l.DS_STATUS_AGENDA || l.IE_STATUS_AGENDA, l.DS_STATUS_EXEC_GE || l.DS_STATUS_EXECUCAO].filter(Boolean).join(" · "),
      cancelado: regras().canceladoTasy(l) || /CANCELAD/.test(regras().sem(l.DS_STATUS_AGENDA)),
      pessoa: l.CD_PESSOA_FISICA == null ? "" : String(l.CD_PESSOA_FISICA),
      atendimento: l.NR_ATENDIMENTO == null ? "" : String(l.NR_ATENDIMENTO),
      ...Object.fromEntries(CHAVES_VINCULO.flat()
        .filter((k) => l[k] != null).map((k) => [k, l[k]])),
      chegada: dataTasy(l.DT_ENTRADA_ATEND), ...regras().atendimentoTasy(l), setor: l.DS_SETOR_PACIENTE || "",
      ...regras().chegadaTasy(l), contextoContraste: contextoContraste(l),
      prontuario: String(l.NR_PRONTUARIO ?? ""), pedidoExterno: pedidoExterno(l),
      indicacao: primeiraIndicacao(l, ["DS_INDICACAO", "DS_CIRURGIA", "DS_CIRURGIA_GRID"]), medico: l.NM_MEDICO || "",
      livre: !l.NM_PACIENTE && !l.NM_PACIENTE_AGENDA && !l.CD_PESSOA_FISICA,
    })).sort((a, b) => (a.inicio || 0) - (b.inicio || 0));
  }
  function tipoAtendimento(l) {
    return regras().atendimentoTasy(l).tipo;
  }
  const regras = () => typeof module !== "undefined" ? require("./regras.js") : globalThis.Regras;
  const hora = (em) => em ? new Date(em).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }) : "—";
  function separarExames(s) {
    const partes = []; let nivel = 0, trecho = "";
    for (const c of String(s || "").split(/(\s\+\s| · |[();,\r\n])/)) {
      if (c === "(") nivel++;
      if (c === ")") nivel = Math.max(0, nivel - 1);
      if (!nivel && /^(?:\s\+\s| · |[;,\r\n])$/.test(c)) {
        if (trecho.trim()) partes.push(trecho.trim());
        trecho = "";
      } else trecho += c;
    }
    if (trecho.trim()) partes.push(trecho.trim());
    return partes;
  }
  function expandirExames(linhas) {
    const grupos = new Map();
    for (const l of linhas) {
      // Só exames da mesma reserva compartilham horário e duração.
      const grupo = `${l.id}|${l.inicio}|${l.pessoa || l.nome}`;
      if (!grupos.has(grupo)) grupos.set(grupo, []);
      const exames = l.livre ? [] : l.examesLista || separarExames(l.exames);
      grupos.get(grupo).push(...(exames.length ? exames : [""]).map((exame, i) => ({ ...l, exame, primeiraReserva: i === 0 })));
    }
    return [...grupos.values()].flatMap((ls) => ls.map((l, i) => ({ ...l, primeira: i === 0, tamanhoGrupo: ls.length })));
  }
  const indicacaoValida = (v) => !/^(s|n|sim|não|nao)$/i.test(v) && (v.match(/\p{L}/gu) || []).length >= 3;
  const primeiraIndicacao = (r, campos) => campos.map((k) => String(r?.[k] ?? "").trim()).find(indicacaoValida) || "";
  function nomeCanonico(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()
      .replace(/ABDOMINAL/g, "ABDOME").replace(/RENAIS|RENAL|RINS/g, "RIM").replace(/VESICAL/g, "BEXIGA")
      .replace(/\b(D|DIR|DTO|E|ESQ)\b/g, (p, _grupo, i, texto) => {
        const antes = texto.slice(0, i);
        const contextual = (antes.match(/\(/g) || []).length > (antes.match(/\)/g) || []).length ||
          /[-/]\s*$/.test(antes) || !/[A-Z0-9]/.test(texto.slice(i + p.length));
        return contextual ? /^(D|DIR|DTO)$/.test(p) ? "DIREITO" : "ESQUERDO" : p;
      })
      .replace(/\bDIREIT[OA]S?\b/g, "DIREITO").replace(/\bESQUERD[OA]S?\b/g, "ESQUERDO")
      .replace(/\b(BILATERAIS|BILATERAL|BIL)\b/g, "BILATERAL").replace(/\bMEMBROS\b/g, "MEMBRO")
      .replace(/\bINFERIORES\b/g, "INFERIOR").replace(/\bSUPERIORES\b/g, "SUPERIOR")
      .replace(/\b(?:US|USG|ULTRASSOM|ULTRA[ -]?S?SONOGRAFIA)\b/g, "ULTRASSONOGRAFIA")
      .split(/[^A-Z0-9]+/).filter((p) => p && !/^(DE|DO|DA|DOS|DAS|E|COM)$/.test(p));
  }
  const lados = (ts) => ts.filter((p) => /^(DIREITO|ESQUERDO|BILATERAL|UNILATERAL)$/.test(p));
  const temLado = (ts) => lados(ts).length > 0;
  function similaridadeExame(a, b) {
    let ta = nomeCanonico(a);
    const tb = nomeCanonico(b), la = lados(ta), lb = lados(tb);
    // Exceção direcional: Unilateral na Agenda aceita um único lado D/E
    // na Gestão. Todos os demais termos e sua ordem continuam obrigatórios.
    if (la.length === 1 && la[0] === "UNILATERAL" && lb.length === 1 && /^(DIREITO|ESQUERDO)$/.test(lb[0]))
      ta = ta.map((p) => p === "UNILATERAL" ? lb[0] : p);
    if (temLado(ta) || temLado(tb)) return ta.join(" ") === tb.join(" ") ? 1 : 0;
    // Sem lado, conserva a comparação anterior por conjunto de termos.
    const termos = (ts) => [...new Set(ts.filter((p) => p.length > 1 && !/^(ULTRASSONOGRAFIA|COLORIDO|CONVENCIONAL|EXAME)$/.test(p)))];
    const x = termos(ta), y = termos(tb);
    if (!x.length || !y.length) return 0;
    // Só equivalências explícitas: prefixos parecidos não comprovam região,
    // lateralidade nem técnica. Informação ausente também não autoriza inferir.
    if (x.length !== y.length || x.some((p) => !y.includes(p))) return 0;
    return 1;
  }
  function cruzarGestao(linha, estado, dia) {
    if (linha.livre) return { ...linha, indicacao: "", status: "", medico: "", chegadaCdi: null };
    // Reconhece também o texto de caches anteriores, sem buscar dados do pedido.
    if (linha.cancelado || regras().canceladoTasy({ DS_STATUS_AGENDA: linha.status }) || /CANCELAD/.test(regras().sem(linha.status)))
      return { ...linha, cancelado: true, status: "Cancelado", indicacao: "", medico: "", chegadaCdi: null };
    const elegiveis = Object.values(estado || {}).filter((e) => {
      if (e.cancelado || e.etapa === "cancelado" || (e.tipo && e.tipo !== "US")) return false;
      // Pessoa prevalece inclusive quando o pedido pertence a outro atendimento.
      const identidade = linha.pessoa && e.pessoa ? String(linha.pessoa) === String(e.pessoa)
        : linha.atendimento && e.atendimento && String(linha.atendimento) === String(e.atendimento);
      return identidade;
    });
    const valores = (r, campos) => campos.map((k) => String(r[k] ?? "").trim()).filter(Boolean);
    const iguais = (e, campos) => valores(linha, campos).some((v) => valores(e, campos).includes(v));
    const diretos = elegiveis.filter((e) => {
      // DT_INICIO é o agendamento da Gestão; inicio/agendado têm outra origem.
      // Caches antigos podem não conter a data nem as chaves opcionais.
      const agendamento = regras().dataTasy(e.DT_INICIO);
      return CHAVES_VINCULO.some((campos) => iguais(e, campos)) ||
        (Number.isFinite(linha.inicio) && Number.isFinite(agendamento) && Math.floor(linha.inicio / 60000) === Math.floor(agendamento / 60000));
    });
    const candidatos = elegiveis.filter((e) => {
      const datas = [e.prescrito, e.agendado, e.chegou, e.inicio, e.fim, e.baixa].filter(Number.isFinite);
      return datas.some((d) => hoje(d) >= deslocar(dia, -7) && hoje(d) <= dia);
    });
    // A chave só restringe candidatos; região, técnica e lado continuam obrigatórios.
    const opcoes = diretos.length ? diretos : candidatos;
    const pontuados = opcoes.map((e) => ({ e, pontos: similaridadeExame(linha.exame || linha.exames, e.exame) }))
      .filter((x) => x.pontos > 0).sort((a, b) => b.pontos - a.pontos);
    const primeiro = pontuados[0], segundo = pontuados[1];
    const empate = segundo && primeiro.pontos === segundo.pontos;
    // Mesmo com chave direta, só um melhor candidato compatível permite vínculo.
    const e = !empate && primeiro ? primeiro.e : null;
    const indicacao = primeiraIndicacao(e, ["DS_DADO_CLINICO", "DS_SOLICITACAO_EXAME", "DS_RESUMO_CLINICO", "DS_JUSTIFICATIVA", "DS_OBS_PROCEDIMENTO", "DS_OBS_PROCED"]);
    const temIndicacao = opcoes.some((c) => regras().indicacaoTasy(c));
    const usarTipoGestao = !linha.campoInternado && !linha.tipo && !!e?.campoInternado;
    const tipo = usarTipoGestao ? e.atend : linha.tipo;
    const internado = usarTipoGestao ? e.internado : linha.internado ?? tipo === "Internado";
    const cdi = [linha.chegadaCdi, e?.chegou].find((d) => Number.isFinite(d) && hoje(d) === dia);
    return { ...linha, tipo, internado, campoInternado: usarTipoGestao ? e.campoInternado : linha.campoInternado,
      chegadaCdi: (internado || tipo === "PS") && cdi && hoje(cdi) === dia ? cdi : null,
      origemChegadaCdi: (cdi != null && cdi === linha.chegadaCdi ? linha.origemChegadaCdi : e?.origemChegadaCdi) || "DT_CHEGADA_PACIENTE (Gestão)",
      pedidoExterno: linha.pedidoExterno || e?.pedidoExterno || false,
      contextoContraste: { ...e?.contextoContraste, ...linha.contextoContraste },
      indicacao: (indicacaoValida(String(linha.indicacao || "").trim()) ? linha.indicacao : "") || indicacao ||
        (!e && temIndicacao ? opcoes.length > 1 ? "ver pedido (vários)" : "ver pedido (sem vínculo)" : "não"),
      medico: e?.prescritor || linha.medico || "" };
  }
  function camposPorExame(linhas) {
    let inicio = 0;
    while (inicio < linhas.length) {
      const grupo = linhas.slice(inicio, inicio + linhas[inicio].tamanhoGrupo);
      for (const l of grupo) l.grupoIndice = inicio;
      for (const campo of ["indicacao", "medico"]) {
        const diferente = new Set(grupo.map((l) => String(l[campo] || "").trim())).size > 1;
        for (const l of grupo) l[campo + "PorExame"] = diferente;
      }
      inicio += grupo.length;
    }
    return linhas;
  }
  const chegadaExibida = (l) => l.internado || l.tipo === "PS"
    ? { em: l.chegadaCdi, origem: l.origemChegadaCdi || "Chegada no CDI não encontrada" }
    : { em: l.chegada, origem: "DT_ENTRADA_ATEND" };
  function realcarBloco(corpo, alvo) {
    const tr = alvo?.closest("tr[data-agenda-grupo]");
    for (const linha of corpo.querySelectorAll("tr[data-agenda-grupo]"))
      linha.classList.toggle("agenda-realce", !!tr && linha.dataset.agendaGrupo === tr.dataset.agendaGrupo);
  }
  function moldeColunas(estado, padrao) {
    const salas = estado.agendaColunasPorSala || estado.agendaPreferenciasPorSala || {};
    const lista = Object.entries(salas).filter(([, v]) => objeto(v)).sort((a, b) => (b[1].em || 0) - (a[1].em || 0));
    const sala1 = Object.entries(modelos(estado)).find(([, v]) => /sala\s*1\b/i.test(v.nome))?.[0];
    const legado = [salas[sala1], salas['1'], lista.find(([k]) => /sala\s*1\b/i.test(k))?.[1], lista[0]?.[1]].find(objeto);
    const fonte = estado.agendaMoldeColunasV1?.v === 1 ? estado.agendaMoldeColunasV1 :
      legado || { ordem: estado.agendaColunas, larguras: estado.agendaLarguras, ocultas: estado.agendaOcultas };
    const ordem = Array.isArray(fonte.ordem) ? fonte.ordem.filter((k) => padrao.includes(k)) : [];
    const valida = new Set(ordem).size === ordem.length;
    return { v: 1, ordem: valida ? [...ordem, ...padrao.filter((k) => !ordem.includes(k))] : [...padrao],
      larguras: Object.fromEntries(Object.entries(fonte.larguras || {}).filter(([k, n]) => padrao.includes(k) && Number.isFinite(n) && n >= 28)),
      ocultas: Array.isArray(fonte.ocultas) ? fonte.ocultas.filter((k) => padrao.includes(k)) : [] };
  }
  function urlPacs(endereco, l) {
    if (!endereco?.trim()) return null;
    const valores = { prontuario: l.prontuario, nome: l.nome, atendimento: l.atendimento };
    let faltou = false;
    const texto = endereco.trim().replace(/\{(prontuario|nome|atendimento)\}/g, (_, k) => {
      if (!valores[k]) faltou = true;
      return encodeURIComponent(valores[k] || "");
    });
    try {
      const u = new URL(texto);
      return !faltou && !/[{}]/.test(texto) && /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
    } catch { return null; }
  }
  const pedidoExterno = (l) => /^(S|SIM|1)$/i.test(String(l.IE_PEDIDO_EXTERNO || l.DS_SOLIC_EXTERNA || "")) || !!l.NR_SEQ_PEDIDO_EXTERNO;
  const contextoContraste = (l) => regras().contextoContraste(l);
  // Detecção passiva: nenhuma action/consulta de laboratório é inventada ou repetida.
  // Só aceita uma resposta nativa com tabela explícita e identidade inequívoca.
  function contextoLido(corpo, linhas) {
    let pedido; try { pedido = json(corpo); } catch { return null; }
    const itens = Array.isArray(pedido) ? pedido : [pedido];
    if (itens.length !== 1 || !objeto(itens[0]) || !Array.isArray(linhas) || !linhas.length) return null;
    const tabela = itens[0].tableName;
    if (!["EXAME_LAB_RESULT_ITEM", "PACIENTE_ALERGIA"].includes(tabela)) return null;
    const pessoas = new Set();
    const visitar = (o) => {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) {
        if (k === "CD_PESSOA_FISICA" && v != null && /^\d+$/.test(String(v))) pessoas.add(String(v));
        else if (v && typeof v === "object") visitar(v);
      }
    };
    visitar(pedido); visitar(linhas);
    if (pessoas.size !== 1) return null;
    // Sem pessoa nas linhas, o filtro explícito por pessoa é obrigatório.
    const filtro = itens[0].filterValues || itens[0].paramsByName || itens[0].parameters;
    if (!linhas.every((l) => l.CD_PESSOA_FISICA != null) && !filtro?.CD_PESSOA_FISICA) return null;
    const campos = tabela === "EXAME_LAB_RESULT_ITEM" ? ["DS_EXAME_LAB", "DS_EXAME", "VL_RESULTADO", "DS_RESULTADO", "DS_UNIDADE", "DT_COLETA", "DT_RESULTADO"] : ["DS_ALERGIA"];
    return { pessoa: [...pessoas][0], campos: { [tabela]: linhas.map((l) => Object.fromEntries(campos.filter((k) => l[k] != null).map((k) => [k, l[k]]))) } };
  }
  function tfg2021(creatinina, idade, sexo) {
    const s = String(sexo || "").toUpperCase(), f = /^(F|FEMININO)$/.test(s);
    if (!/^(M|MASCULINO|F|FEMININO)$/.test(s) || !Number.isFinite(idade) || idade < 18 || idade > 120 || !Number.isFinite(creatinina) || creatinina <= 0) return null;
    const razao = creatinina / (f ? 0.7 : 0.9);
    return 142 * Math.min(razao, 1) ** (f ? -0.241 : -0.302) * Math.max(razao, 1) ** -1.2 * 0.9938 ** idade * (f ? 1.012 : 1);
  }
  function antesContraste(l) {
    const r = l.contextoContraste || l, motivos = [];
    const numero = (v) => typeof v === "number" ? v : typeof v === "string" && /^\d+(?:[.,]\d+)?$/.test(v.trim()) ? Number(v.replace(',', '.')) : NaN;
    const data = (v) => regras().dataTasy(v);
    const labor = Array.isArray(r.EXAME_LAB_RESULT_ITEM) ? r.EXAME_LAB_RESULT_ITEM : [];
    const resultados = labor.map((x) => ({ nome: regras().sem(x.DS_EXAME_LAB || x.DS_EXAME),
      valor: numero(x.VL_RESULTADO ?? x.DS_RESULTADO), data: data(x.DT_COLETA || x.DT_RESULTADO), unidade: x.DS_UNIDADE }));
    const validos = (x) => Number.isFinite(x.valor) && x.valor > 0 && Number.isFinite(x.data);
    const recentes = (a, b) => b.data - a.data;
    const cr = [...resultados.filter((x) => /^CREATININA(?: SERICA)?$/.test(x.nome)),
      { valor: numero(r.QT_CREATININA ?? r.VL_CREATININA), data: data(r.DT_CREATININA), unidade: r.DS_UNIDADE_CREATININA }]
      .filter((x) => validos(x) && /^MG\s*\/\s*DL$/.test(regras().sem(x.unidade))).sort(recentes)[0];
    const creatinina = cr ? { valor: cr.valor, data: cr.data, unidade: "mg/dL" } : null;
    if (!creatinina) motivos.push("creatinina: resultado numérico, data e unidade mg/dL não detectados em contrato confirmado");
    const labTfg = [...resultados.filter((x) => /^(TFG|TAXA DE FILTRACAO GLOMERULAR)$/.test(x.nome)),
      { valor: numero(r.QT_TFG ?? r.VL_TFG), data: data(r.DT_TFG), unidade: r.DS_UNIDADE_TFG }].filter(validos).sort(recentes)[0];
    let tfg = labTfg ? { valor: labTfg.valor, data: labTfg.data, origem: "TASY", unidade: labTfg.unidade || "unidade não encontrada" } : null;
    // Nascimento permite idade na coleta; senão usa a idade informada na
    // Agenda, deixando essa limitação explícita na origem do cálculo.
    const nascimento = data(r.DT_NASCIMENTO);
    let idade = numero(r.QT_IDADE_PACIENTE ?? r.QT_IDADE ?? l.idade);
    if (creatinina && nascimento) {
      const a = hoje(creatinina.data), n = hoje(nascimento);
      idade = +a.slice(0, 4) - +n.slice(0, 4) - (a.slice(5) < n.slice(5) ? 1 : 0);
    }
    if (!tfg && creatinina) {
      const valor = tfg2021(creatinina.valor, idade, r.IE_SEXO || r.DS_SEXO);
      if (valor != null) tfg = { valor, data: creatinina.data, origem: `calculada (CKD-EPI 2021, sem raça; idade ${nascimento ? "na coleta" : "informada na Agenda"})`, unidade: "mL/min/1,73 m²" };
    }
    if (!tfg) motivos.push("TFG: resultado TASY datado ou entradas adultas completas para CKD-EPI 2021 não detectados");
    const alergias = r.DS_ALERGIAS || r.DS_ALERGIA || (Array.isArray(r.PACIENTE_ALERGIA) ? r.PACIENTE_ALERGIA.map((x) => x.DS_ALERGIA).filter(Boolean).join("; ") : "");
    const preparo = r.DS_PREPARO_EXAME || r.DS_PREPARO || "";
    if (!alergias) motivos.push("alergias: PACIENTE_ALERGIA/alertas PEP sem contrato detectado; vazio não significa ausência de alergia");
    if (!preparo) motivos.push("preparo: DS_PREPARO_EXAME/DS_PREPARO não detectados; contrato do procedimento pendente");
    return { creatinina, tfg, alergias: String(alergias || ""), preparo: String(preparo), motivos };
  }
  const codigo = (modelo) => {
    const p = reconhecer(modelo?.url, "POST", modelo?.corpo);
    return p ? String(p.filterValues.CD_AGENDA) : "";
  };
  function nomeSala(modelo, linhas = []) {
    const nome = linhas.find((l) => typeof l.DS_AGENDA === "string" && l.DS_AGENDA.trim())?.DS_AGENDA;
    const pedido = reconhecer(modelo?.url, "POST", modelo?.corpo)?.filterValues.DS_AGENDAS;
    return nome?.trim() || (typeof pedido === "string" && /[a-zà-ú]/i.test(pedido) ? pedido.trim() : "");
  }
  function modelos(estado = {}) {
    const todos = { ...(estado.tasyAgendaModelos || {}) }, antigo = estado.tasyAgendaModelo, cd = codigo(antigo);
    if (cd && !todos[cd]) todos[cd] = { modelo: antigo, nome: nomeSala(antigo) || `Agenda ${cd}` };
    return todos;
  }
  function salas(estado) {
    return Object.entries(modelos(estado)).map(([cd, v]) => ({ cd, ...v }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  }
  function selecionar(estado, cd) {
    const lista = salas(estado);
    if (cd != null && cd !== "") return lista.find((s) => s.cd === String(cd)) || null;
    return lista.find((s) => /sala\s*1\b/i.test(s.nome)) || lista[0] || null;
  }
  function trocarSala(modelo, cd, aprendidos) {
    if (!aprendidos[String(cd)] || !codigo(modelo)) throw new Error(ATIVAR);
    const p = JSON.parse(modelo.corpo), valor = p[0].filterValues.CD_AGENDA;
    p[0].filterValues.CD_AGENDA = typeof valor === "number" ? Number(cd) : String(cd);
    return { ...modelo, corpo: JSON.stringify(p) };
  }
  const chave = (modelo, dia) => `${reconhecer(modelo?.url, "POST", modelo?.corpo)?.filterValues.CD_AGENDA}|${dia}`;
  // 0.29: caixa "paciente ou nº do atendimento" do painel. Procura nos pacientes já lidos (Gestão + Agenda, só no PC).
  // Número sem paciente conhecido ainda pode ser aberto pelo TASY (Localizar paciente › Atendimento).
  function buscarPacientes(q, tasyEstado = {}, tasyAgendaCache = {}) {
    const texto = String(q ?? "").trim();
    if (!texto) return [];
    const todos = [...Object.values(tasyEstado || {}), ...Object.values(tasyAgendaCache || {}).flatMap((c) => c?.linhas || [])]
      .filter((e) => e && (e.pessoa || e.atendimento) && !e.livre);
    const numero = /^\d+$/.test(texto);
    const palavras = regras().sem(texto).split(/\s+/).filter(Boolean);
    const achados = todos.filter((e) => numero ? String(e.atendimento) === texto
      : palavras.every((w) => regras().sem(e.nome).split(/\s+/).some((n) => n.startsWith(w))));
    const unicos = new Map();
    for (const e of achados) {
      const k = e.pessoa ? "P" + e.pessoa : "A" + e.atendimento, velho = unicos.get(k);
      if (!velho || (!velho.atendimento && e.atendimento)) unicos.set(k, { nome: e.nome || "", pessoa: String(e.pessoa || ""), atendimento: String(e.atendimento || "") });
    }
    const lista = [...unicos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return lista.length || !numero ? lista.slice(0, 20) : [{ nome: "", pessoa: "", atendimento: texto }];
  }
  // 0.29: horário bloqueado na agenda (nome ou status "Bloqueado") aparece sem negrito
  const bloqueado = (l) => !!l && /BLOQUEI?AD/.test(regras().sem(l.nome) + " " + regras().sem(l.status));
  const rotaPep = (e) => e?.pessoa ? `#/atepaceh/patientid/${encodeURIComponent(e.pessoa)}` + (e.atendimento ? `/episode/${encodeURIComponent(e.atendimento)}` : "") : null;
  const api = { SALA, FUSO, ATIVAR, SESSAO, RECARREGAR, motivoRecusa, dataValida, hoje, deslocar, reconhecer, dataNoFormato, corpo, resposta, lerTodas, normalizar, chave, rotaPep };
  Object.assign(api, { tipoAtendimento, hora, separarExames, expandirExames, cruzarGestao, similaridadeExame, codigo, nomeSala, modelos, salas, selecionar, trocarSala });
  Object.assign(api, { buscarPacientes, bloqueado, camposPorExame, chegadaExibida, realcarBloco, moldeColunas, urlPacs, pedidoExterno, contextoContraste, contextoLido, antesContraste, tfg2021 });
  if (typeof module !== "undefined") module.exports = api; else globalThis.Agenda = api;
})();
