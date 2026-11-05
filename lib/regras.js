// Alerta de Exames HSI — regras puras (sem Chrome), usadas pelo content.js, pelo background.js, pelo popup e pelos testes.
(() => {
  const PADRAO = {
    intervaloMin: 1, campoHospital: "SiteId", textoHospital: "4946", som: true, ativo: true, enderecoPacs: "",
    ntfyTopico: "", ntfyAtivo: false, tasyAtivo: true, avisoSolicitado: true, avisoChegou: true, avisoEmExame: true, notasAtivo: true, fontePainel: 13,
  };
  const GUARDAR_H = 36; // exames vistos ficam guardados por 36 h (plantão que passa da meia-noite)

  // Busca padrão (copiada da que o portal faz com hoje + CT). "filter1" = hoje.
  const CORPO_PADRAO = {
    Fields: ["$patients_full_name", "$patients_banner_name", "$patients_last_name", "$patients_first_name",
      "$patients_ideographic_last_name", "$patients_ideographic_first_name", "PATIENT_ID", "$patients_birth_and_age",
      "$no_format_patient_birth", "PATIENTS_SEX", "$patient_last_scan_data", "TAMAR_STUDY_HAS_STICKY_NOTE",
      "TAMAR_STUDY_HAS_REPORT", "TAMAR_STUDY_HAS_KEY_IMAGE", "TAMAR_STUDY_HAS_KEY_SERIES", "$old_format_study_date"],
    Filters: { Text: "", LName: "", FName: "", PID: "", Acc: "", Date: "filter1", Loc: "", Report: false, Notes: false,
      KeyImgs: false, Status: "", Mod: "ct", RefName: "", CustomFilters: [] },
    PageNum: 1, PageSize: 200, Sort: "$patient_last_scan_data", SortDir: 2, GetTotal: true, Exact: false,
    IsPortalGlobalQuery: "", SearchPortalType: "CONN", SupportPaging: true, BGlassData: { IsBGlass: false, BGlassReason: "" },
    UnifiedMultiExamTag: "", WorkArchiveAETitle: "", WorkArchiveType: "", IsMobile: false, ClientTZOffsetUtc: 180,
  };
  // corpo de uma página: sempre CT; semData = os mais recentes sem filtro de data (pega o fim de ontem depois da meia-noite)
  function corpoPagina(base, pagina, tamanho, semData, mod = "ct") {
    let b; try { b = typeof base === "string" ? JSON.parse(base) : structuredClone(base); } catch { b = null; }
    b = b && b.Filters ? b : structuredClone(CORPO_PADRAO);
    // 0.15: o portal só manda o nome do paciente (FullName/BannerName) quando o pedido lista esses campos em "Fields"
    b.Fields = [...new Set([...CORPO_PADRAO.Fields, ...(Array.isArray(b.Fields) ? b.Fields : [])])];
    b.Filters = { ...b.Filters, Mod: mod, Text: "", LName: "", FName: "", PID: "", Acc: "", ...(semData ? { Date: "" } : {}) };
    if (!semData) b.Filters.Date = "filter2";   // 0.19: hoje + ontem (o plantão passa da meia-noite; exames de ontem sem laudo)
    Object.assign(b, { PageNum: pagina, PageSize: tamanho, GetTotal: true, Sort: "$patient_last_scan_data", SortDir: 2 });
    return JSON.stringify(b);
  }

  const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  const textos = (c) => String(c.textoHospital || "").split(/[,;]/).map(sem).filter(Boolean);
  const doHospital = (r, c) => !c.campoHospital || !textos(c).length ||
    textos(c).some((t) => /^\d+$/.test(t) ? sem(r[c.campoHospital]) === t : sem(r[c.campoHospital]).includes(t));   // número = igual (4946 ≠ 14946)
  const ehTC = (r) => /\bCT\b/i.test(String(r.StdyMod || ""));
  // modalidade do estudo no PACS → "TC" / "US" (o resto não interessa)
  const CARDIO = /ECOCARDIO|ECODOPPLERCARDIO|ECO TRANSTORAC|ECOTT\b|TRANSTORACICO|TRANSESOFAG/;   // eco = cardiologia
  const ehCardio = (s) => CARDIO.test(sem(desc(s)));
  const tipoPacs = (r) => ehCardio(r.StDesc) ? "" : /\bCT\b/i.test(String(r.StdyMod || "")) ? "TC" : /\bUS\b/i.test(String(r.StdyMod || "")) ? "US" : "";
  const laudado = (r) => String(r.stdStatus || "").toUpperCase() === "APPROVED";
  // texto do portal vem com entidades HTML (CR&#194;NIO, JO&#195;O, &amp;)
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const desc = (s) => String(s || "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&([a-z]+);/gi, (x, e) => ENT[e.toLowerCase()] ?? x);
  // nome do paciente no PACS: FullName; se vier vazio, BannerName ou sobrenome/nome (o "^" do DICOM vira espaço)
  const nome = (r) => desc(r.FullName || r.BannerName || [r.FName, r.LName].filter(Boolean).join(" ") || r.PatientName || r.PtName || "")
    .replace(/[\^,]+/g, " ").replace(/\s+/g, " ").trim();

  // Campos com poucos valores que se repetem (status, hospital...) — não mostra nomes de pacientes.
  function resumoCampos(lista) {
    const vals = {};
    for (const r of lista) for (const [k, v] of Object.entries(r || {})) {
      if (v === null || typeof v === "object") continue;
      const s = String(v).slice(0, 40);
      (vals[k] ||= new Map()).set(s, (vals[k].get(s) || 0) + 1);
    }
    const poucos = {};
    for (const [k, m] of Object.entries(vals)) {
      if (m.size > 1 && m.size <= 12 && lista.length >= 2 * m.size) poucos[k] = [...m.keys()];
    }
    return { campos: Object.keys(lista[0] || {}), poucosValores: poucos, total: lista.length };
  }

  // Para achar o campo do hospital: pega pacientes que o Artur sabe que são do HSI e mostra, campo a campo,
  // o valor deles e quantos exames da lista têm o mesmo valor. Sem nomes, ids nem tokens.
  const PRIVADOS = /name|nome|^id$|idunformatted|crn|bdate|birth|ticket|tok|suid|uid|^acc$|filename|^date$|ofdate|lastscan|histor|unification|pidiss/i;
  function acharCampoHospital(lista, nomesHsi) {
    const alvos = nomesHsi.map(sem).filter(Boolean);
    const achados = lista.filter((r) => alvos.some((a) => a.split(/\s+/).every((p) => sem(nome(r)).includes(p))));
    const campos = {};
    for (const k of Object.keys(lista[0] || {})) {
      if (PRIVADOS.test(k)) continue;
      const v = achados.map((r) => (r[k] === null || typeof r[k] === "object") ? JSON.stringify(r[k])?.slice(0, 60) : String(r[k]).slice(0, 60));
      if (!v.length) continue;
      const iguais = new Set(v).size === 1;
      const naLista = lista.filter((r) => String(r[k]).slice(0, 60) === v[0]).length;
      campos[k] = { valores: [...new Set(v)], todosIguais: iguais, exames_com_o_mesmo_valor: iguais ? naLista : undefined };
    }
    return { pacientesAchados: achados.length, de: alvos.length, totalNaLista: lista.length, campos };
  }

  // Junta a lista nova com os já vistos. Retorna os novos (vazio na 1ª carga, para não disparar tudo de uma vez).
  function mesclar(vistos, exames, agora = Date.now()) {
    const v = {};
    for (const [k, x] of Object.entries(vistos || {})) if (agora - x.vistoEm < GUARDAR_H * 36e5) v[k] = x;
    const primeira = Object.keys(v).length === 0;
    const novos = [];
    for (const e of exames) {
      if (!e.acc) continue;
      if (!v[e.acc]) {
        const antigo = e.quando && agora - e.quando > 6 * 36e5;   // estudo de horas atrás que só agora entrou na lista
        v[e.acc] = { ...e, vistoEm: agora, novo: !primeira && !antigo };
        if (!primeira && !antigo) novos.push(e);
      } else v[e.acc] = { ...v[e.acc], laudo: e.laudo };
    }
    return { vistos: v, novos, primeira };
  }

  // Login automático: até 5 tentativas seguidas (a cada 30 s) e janela zerada após 10 min.
  function podeLogar(t, agora = Date.now()) {
    if (!t) return true;
    if (agora - t.ultima > 10 * 60000) return true;      // janela de 10 min zerou
    return t.n < 5 && agora - t.ultima > 30 * 1000;
  }

  // ======================= TASY (Gestão de exames, somente leitura) =======================
  // Linhas de WCPanelDataProvider/getDataSource → dados.linhasResultSet. Só TC e US.
  const tipoTasy = (r) => {
    const s = sem([r.DS_PROCEDIMENTO, r.DS_PROC_INTERNO, r.EXAME].join(" "));
    if (/\bTC\b|TOMOGRAF|ANGIOTOMO|UROTOMO/.test(s)) return "TC";
    if (CARDIO.test(s)) return "";   // ecocardiograma = cardiologia
    if (/\bUS\b|\bUSG\b|ULTRASSO|ULTRA-SO|ECOGRAF|DOPPLER/.test(s)) return "US";
    const modalidade = sem(r.IE_MODALIDADE || r.DS_MODALIDADE || r.CD_MODALIDADE);
    if (/^(US|USG|ULTRASSONOGRAFIA)$/.test(modalidade)) return "US";
    if (/^(CT|TC)$/.test(modalidade)) return "TC";
    const agenda = sem(r.DS_AGENDA);
    if (/\bTC\b|\bCT\b|TOMOGRAF/.test(agenda)) return "TC";
    if (/ULTRASSO|ULTRA-SO/.test(agenda)) return "US";
    return "";
  };
  // Agenda: flag explícita. Gestão: código padrão do tipo de atendimento,
  // observado sem IE_PAC_INTERNADO. Setor/leito não comprovam internação.
  function atendimentoTasy(r) {
    const resultado = (tipo, campo) => ({ tipo, internado: tipo === "Internado", campoInternado: campo });
    for (const campo of ["IE_PAC_INTERNADO", "IE_INTERNADO"]) {
      const v = sem(r[campo]);
      if (["S", "SIM", "1", "TRUE"].includes(v)) return resultado("Internado", campo);
      if (["N", "NAO", "0", "FALSE"].includes(v)) {
        const reserva = atendimentoTasy(Object.fromEntries(Object.entries(r).filter(([k]) => !/^IE_(PAC_)?INTERNADO$/.test(k))));
        return { ...reserva, tipo: reserva.tipo === "Internado" ? "" : reserva.tipo, internado: false, campoInternado: campo };
      }
    }
    for (const campo of ["IE_TIPO_ATENDIMENTO", "IE_TIPO_ATEND"]) {
      const tipo = ({ 1: "Internado", 3: "PS", 7: "Externo", 8: "Ambulatorial" })[r[campo]];
      if (tipo) return resultado(tipo, campo);
    }
    for (const campo of ["DS_TIPO_ATENDIMENTO", "DS_TIPO_ATEND"]) {
      const texto = String(r[campo] || "").trim(), s = sem(texto);
      if (/^(?:PACIENTE )?(?:INTERNAD[OA]|INTERNACAO)$/.test(s)) return resultado("Internado", campo);
      if (/PRONTO|^PS$/.test(s)) return resultado("PS", campo);
      if (/AMBUL/.test(s)) return resultado("Ambulatorial", campo);
      if (/EXTERN/.test(s)) return resultado("Externo", campo);
    }
    for (const campo of ["DS_ICONE", "DS_IMAGEM", "NM_ICONE", "NM_IMAGEM"]) {
      if (/INTERN|MACA|STRETCHER|\bBED\b/.test(sem(r[campo]).replace(/[_./-]/g, " "))) return resultado("Internado", campo);
    }
    return resultado(String(r.DS_TIPO_ATENDIMENTO || r.DS_TIPO_ATEND || r.IE_TIPO_ATENDIMENTO || r.IE_TIPO_ATEND || ""), "");
  }
  function idTasy(r) {
    if (r.NR_SEQ_INTERNO != null) return String(r.NR_SEQ_INTERNO);
    if (r.NR_SEQUENCIA != null) return String(r.NR_SEQUENCIA);
    if (r.NR_PRESCRICAO != null && r.NR_SEQ_PROCED != null) return `${r.NR_PRESCRICAO}-${r.NR_SEQ_PROCED}`;
    // Sem sequência: apenas identidade e previsão; status/datas de execução,
    // indicação, médico e total da página não criam outro exame nem novo aviso.
    return "linha-" + JSON.stringify([
      String(r.NR_ATENDIMENTO ?? ""), String(r.CD_PESSOA_FISICA ?? ""),
      sem(r.CD_PROCEDIMENTO ?? r.CD_PROCED ?? r.NR_SEQ_PROC_INTERNO ?? r.DS_PROCEDIMENTO ?? r.DS_PROC_INTERNO ?? r.EXAME),
      dataTasy(r.DT_PREV_EXECUCAO),
    ]);
  }
  const dataTasy = (v) => {
    if (v && typeof v === "object") v = v.value ?? v.time ?? null;   // Instant do Tasy
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  };
  // "Data baixa": a coluna descoberta na tela, DT_BAIXA ou outro campo de data com BAIXA/EXECUCAO no nome
  // 0.18: nunca usar campos de PREVISÃO (DT_PREV_EXECUCAO vem preenchido em todos os exames e fazia tudo parecer
  // executado) nem de baixa especial/cancelamento
  const NAO_BAIXA = /PREV|ESPECIAL|CANCEL|SUSP|AGENDA/i;
  function dataBaixa(r, campos = {}) {
    const desc = campos.baixa && !NAO_BAIXA.test(campos.baixa) ? [campos.baixa] : [];
    const ks = ["DT_BAIXA", ...desc, ...Object.keys(r).filter((k) => /^DT_(BAIXA|EXECUCAO|REALIZACAO)(_EXAME)?$/i.test(k) && !NAO_BAIXA.test(k))];
    for (const k of ks) { const d = k && dataTasy(r[k]); if (d) return d; }
    return null;
  }
  // "Prescrito por": a coluna descoberta na tela; se vier vazia nessa linha, outros campos de médico do pedido
  // 0.12: só vale campo de nome de médico; os de prescritor/solicitante vêm antes do NM_MEDICO genérico
  // e antes da coluna descoberta na tela. NM_MEDICO é Requisitante na Agenda
  // e Prescrito por na Gestão (avaliação local de 03/11/2026).
  const PRESCRITORES = ["NM_MEDICO_PRESCR", "NM_MEDICO_PRESCRITOR", "NM_PRESCRITOR", "NM_MEDICO_PRESCRICAO", "NM_MEDICO_SOLIC",
    "NM_MEDICO_SOLICITANTE", "NM_MEDICO_REQUISITANTE", "NM_MEDICO_REQ"];
  const OUTROS_MEDICOS = ["NM_MEDICO", "NM_MEDICO_ATENDIMENTO", "NM_MEDICO_RESP", "NM_PROFISSIONAL_RESP"];
  const campoPrescritorOk = (k) => !!k && /MEDIC|PRESCR|SOLIC|REQUI|PROFISS/i.test(k) && !/PACIENTE|PESSOA|USUARIO|^CD_|^NR_|^DT_|^IE_/i.test(k);
  function prescritorTasy(r, campos = {}) {
    const desc = campoPrescritorOk(campos.prescritor) ? [campos.prescritor] : [];
    const auto = Object.keys(r).filter((x) => /^NM_.*(PRESCR|SOLIC|REQUI)/i.test(x));
    for (const k of [...PRESCRITORES, ...auto, ...desc, ...OUTROS_MEDICOS]) if (r[k] && String(r[k]).trim()) return String(r[k]).trim();
    return "";
  }
  const CAMPOS_CLINICOS = ["DS_DADO_CLINICO", "DS_SOLICITACAO_EXAME", "DS_RESUMO_CLINICO", "DS_JUSTIFICATIVA", "DS_OBS_PROCEDIMENTO", "DS_OBS_PROCED"];
  const CAMPOS_VINCULO_AGENDA = ["NR_PRESCR", "NR_PRESCRICAO", "NR_SEQ_INTERNO", "NR_SEQ_AGENDA", "DT_INICIO"];
  const CAMPOS_CONTRASTE = ["QT_IDADE_PACIENTE", "QT_IDADE", "IE_SEXO", "DS_SEXO", "DT_NASCIMENTO", "QT_CREATININA", "VL_CREATININA", "DT_CREATININA", "DS_UNIDADE_CREATININA", "QT_TFG", "VL_TFG", "DT_TFG", "DS_UNIDADE_TFG", "DS_ALERGIAS", "DS_ALERGIA", "DS_PREPARO", "DS_PREPARO_EXAME", "EXAME_LAB_RESULT_ITEM", "PACIENTE_ALERGIA"];
  const contextoContraste = (l) => Object.fromEntries(CAMPOS_CONTRASTE.filter((k) => l[k] != null && l[k] !== "").map((k) => [k, l[k]]));
  // Alternativas ainda dependem de confirmação no TASY; atualização genérica só
  // é chegada enquanto o status é explicitamente Chegou/Chegada no setor/CDI.
  function chegadaTasy(r) {
    for (const campo of ["DT_CHEGADA_PACIENTE", "DT_CHEGADA_CDI", "DT_CHEGADA"]) {
      const em = dataTasy(r[campo]);
      if (em) return { chegadaCdi: em, origemChegadaCdi: campo };
    }
    if (/^(CHEGOU|CHEGADA)( (NO )?(SETOR|CDI))?$/.test(sem(r.DS_STATUS_EXECUCAO || r.DS_STATUS_EXEC_GE))) {
      for (const campo of ["DT_ATUALIZACAO_STATUS", "DT_ATUALIZACAO"]) {
        const em = dataTasy(r[campo]);
        if (em) return { chegadaCdi: em, origemChegadaCdi: campo + " (status de chegada; não confirmado)" };
      }
    }
    return { chegadaCdi: null, origemChegadaCdi: "" };
  }
  const indicacaoTasy = (r) => CAMPOS_CLINICOS.map((k) => String(r?.[k] ?? "").trim())
    .find((v) => !/^(s|n|sim|não|nao)$/i.test(v) && (v.match(/\p{L}/gu) || []).length >= 3) || "";
  const canceladoTasy = (r) => r.IE_STATUS_EXECUCAO === "BE" ||
    [r.DS_STATUS_EXECUCAO, r.DS_STATUS_AGENDA, r.DS_STATUS_EXEC_GE].some((s) => /ESPECIAL|BAIXA\s*ESPERA/.test(sem(s)));
  // campos: colunas descobertas na tela ({ prescritor: "NM_...", baixa: "DT_..." }); sem elas, os nomes mais prováveis
  function tasyExames(linhas, campos = {}) {
    const out = [];
    let ordem = 0;
    for (const r of linhas || []) {
      ordem++;
      const tipo = tipoTasy(r);
      // 0.13: exame "baixado" é exame executado (a data baixa é a da execução) — antes ficava de fora por engano.
      // Baixa especial e Baixa espera são cancelamentos.
      if (!tipo) continue;
      // 0.19: IE_EXAME_CANCELADO vem "S" em TODO exame baixado (executado, envelopado, laudado) — não é cancelamento.
      const cancelado = canceladoTasy(r);
      const clinico = indicacaoTasy(r);
      const atendimento = atendimentoTasy(r);
      out.push({
        contextoContraste: contextoContraste(r),
        pedidoExterno: /^(S|SIM|1)$/i.test(String(r.IE_PEDIDO_EXTERNO || r.DS_SOLIC_EXTERNA || "")) || !!r.NR_SEQ_PEDIDO_EXTERNO,
        ...Object.fromEntries(CAMPOS_CLINICOS.map((k) => [k, r[k] ?? ""])),
        // O cache tasyEstado conserva estes campos pelo spread de tasyMudancas.
        // São dados de vínculo; não alteram a identidade estável do exame.
        ...Object.fromEntries(CAMPOS_VINCULO_AGENDA.filter((k) => r[k] != null).map((k) => [k, r[k]])),
        id: idTasy(r), ordem,
        tipo, nome: r.NM_PACIENTE || r.NM_PESSOA_FISICA || "", exame: String(r.DS_PROCEDIMENTO || r.DS_PROC_INTERNO || r.EXAME || ""),
        status: String(r.DS_STATUS_EXECUCAO || ""), cancelado, acc: r.NR_ACESSO_DICOM ? String(r.NR_ACESSO_DICOM) : "",
        agendado: dataTasy(r.DT_PREV_EXECUCAO), prescrito: dataTasy(r.DT_PRESCRICAO), chegou: chegadaTasy(r).chegadaCdi,
        origemChegadaCdi: chegadaTasy(r).origemChegadaCdi, inicio: dataTasy(r.DT_INICIO_EXAME),
        fim: dataTasy(r.DT_FIM_EXAME), urgencia: r.DS_CLASSIF_URGENCIA || r.DS_CONDICAO || "",
        internado: atendimento.internado, campoInternado: atendimento.campoInternado,
        atend: atendimento.tipo, setor: r.DS_SETOR_PACIENTE || r.DS_SETOR_ATENDIMENTO || "", clinico,
        prescritor: prescritorTasy(r, campos),
        baixa: dataBaixa(r, campos),
        atendimento: r.NR_ATENDIMENTO != null ? String(r.NR_ATENDIMENTO) : "",
        pessoa: r.CD_PESSOA_FISICA != null ? String(r.CD_PESSOA_FISICA) : "",
        prontuario: r.NR_PRONTUARIO != null ? String(r.NR_PRONTUARIO) : "",
      });
    }
    return out;
  }
  // etapa do exame no caminho até o laudo
  // o status do Tasy manda; as datas só servem quando o status vem vazio
  function etapaTasy(e) {
    const s = sem(e.status);
    if (e.cancelado) return "cancelado";
    if (/LAUDO/.test(s)) return "laudado";
    if (/EXECUTADO|ENVELOP|BAIXAD/.test(s)) return "executado";
    if (/EM EXAME/.test(s)) return "em exame";
    if (/CHEG/.test(s)) return "chegou";
    if (/PRESCRITO/.test(s)) return "prescrito";
    if (e.baixa || e.fim) return "executado";
    if (e.inicio) return "em exame";
    if (e.chegou) return "chegou";
    return "prescrito";
  }
  // o que mudou desde a última leitura → avisos
  const PENDENTE = new Set(["prescrito", "chegou", "em exame"]);
  function tasyMudancas(ant, exames, primeira) {
    const avisos = [], novo = {};
    // mantém por 36 h os que sumiram da tela (outro filtro no Tasy), para não avisar de novo quando voltarem
    // pendentes (prescrito/chegou/em exame) ficam até 7 dias: só saem quando executam, entram no PACS ou são cancelados
    for (const [k, x] of Object.entries(ant || {})) {
      const lim = PENDENTE.has(x.etapa) ? 7 * 24 : GUARDAR_H;
      if (Date.now() - x.vistoEm < lim * 36e5) novo[k] = { ...x, naTela: false };
    }
    for (const e of exames) {
      const et = etapaTasy(e), velho = ant?.[e.id];
      novo[e.id] = { ...e, etapa: et, naTela: true, vistoEm: velho?.vistoEm || Date.now() };
      if (primeira) continue;
      if (et === "cancelado") continue;
      if (!velho) {   // aviso de "solicitado" só para pedido recente (a leitura agora traz todas as páginas de uma vez)
        const recente = !e.prescrito || Date.now() - e.prescrito < 3 * 36e5;
        if (et !== "laudado" && et !== "executado" && recente) avisos.push({ ...e, etapa: et, evento: "solicitado" });
      }
      else if (velho.etapa !== et && (et === "chegou" || et === "em exame")) avisos.push({ ...e, etapa: et, evento: et });
    }
    return { estado: novo, avisos };
  }
  // mesmo paciente: as palavras do nome menor estão todas no maior (em qualquer ordem; ignora DA/DE/DOS…),
  // com pelo menos 2 palavras — "MARIA SOUZA" = "Maria Aparecida de Souza"
  const PEQUENAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);
  const palavras = (s) => sem(desc(s)).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((p) => p.length > 1 && !PEQUENAS.has(p));
  function mesmoPaciente(a, b) {
    const pa = palavras(a), pb = palavras(b);
    if (!pa.length || !pb.length) return false;
    const [menor, maior] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
    if (menor.length < 2) return menor[0] === maior[0] && maior.length === 1;
    return menor.every((p) => maior.includes(p));
  }
  // nome do exame sem o tipo e as palavras genéricas: "TC CRANIO" e "TC Crânio" → "CRANIO"
  const GENERICAS = /^(TC|US|USG|TOMOGRAFIA|COMPUTADORIZADA|ULTRASSONOGRAFIA|ULTRASSOM|ULTRA|SONOGRAFIA|DE|DO|DA|DOS|DAS|E|COM|SEM|CONTRASTE|C|S|EXAME)$/;
  const exameBase = (s) => sem(desc(s)).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((p) => p.length > 1 && !GENERICAS.test(p));
  function mesmoExame(a, b) {
    const ea = exameBase(a), eb = exameBase(b);
    if (!ea.length || !eb.length) return true;   // sem detalhe para comparar: não atrapalha
    return ea.some((p) => eb.some((q) => p.startsWith(q.slice(0, 4)) || q.startsWith(p.slice(0, 4))));
  }
  // casa Tasy × PACS: nº de acesso DICOM; senão mesmo paciente + mesmo tipo (TC/US), dando preferência ao mesmo exame
  // 0.19 (testado com os dados reais: 42 de 42 executados casaram — 23 pelo nº de acesso, 19 pelo nome): vários
  // exames do Tasy do mesmo paciente feitos juntos viram UM estudo no PACS, com um nº de acesso só. Por isso o
  // estudo pode valer para mais de um exame do Tasy. Pelo nome, só vale se o horário do PACS estiver perto do
  // da execução no Tasy (até 8 h), para não pegar um estudo antigo do mesmo paciente.
  const PERTO = 8 * 36e5;
  function acharPacs(e, vistosPacs, todosTasy) {
    const v = Object.entries(vistosPacs || {});
    if (e.acc) { const a = v.find(([acc]) => acc === e.acc); if (a) return a; }
    const ref = e.baixa || e.fim || e.inicio || e.chegou || null;
    const accsIrmaos = new Set(Array.isArray(todosTasy) && ref ? todosTasy.filter((o) => o !== e && o.acc && (o.tipo || "TC") === e.tipo &&
      ((e.pessoa && o.pessoa === e.pessoa) || (e.atendimento && o.atendimento === e.atendimento) || mesmoPaciente(e.nome, o.nome)) &&
      Math.abs((o.baixa || o.fim || o.inicio || o.chegou || 0) - ref) <= 30 * 60000).map((o) => o.acc) : []);
    const cands = v.filter(([, x]) => (x.tipo || "TC") === e.tipo && mesmoPaciente(e.nome, x.nome)).map(([acc, x]) => {
      const q = x.quando || x.vistoEm || null;
      return { acc, x, dif: ref && q ? Math.abs(q - ref) : null, irmao: accsIrmaos.has(acc) ? 1 : 0 };
    }).filter((c) => c.dif == null ? !ref : c.dif <= PERTO);
    if (!cands.length) return null;
    cands.sort((a, b) => (mesmoExame(e.exame, b.x.exame) - mesmoExame(e.exame, a.x.exame)) || (b.irmao - a.irmao) || ((a.dif ?? 0) - (b.dif ?? 0)));
    return [cands[0].acc, cands[0].x];
  }
  const noPacs = (e, vistosPacs) => !!acharPacs(e, vistosPacs);

  // data do estudo no PACS: /Date(ms)/, AAAAMMDDHHMMSS ou o que o dataTasy entender
  function dataPacs(v) {
    if (v == null || v === "") return null;
    const s = String(v);
    let m = s.match(/Date\((\d+)/);
    if (m) return +m[1];
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
    if (m && s.length >= 8) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
    return dataTasy(v);
  }

  // Painel: uma linha por exame do Tasy (TC/US) + as TC do HSI que só estão no PACS
  // tasyAccs: nº de acesso de TODAS as linhas da Gestão de exames (qualquer tipo) — exame do PACS com nº conhecido
  // no Tasy nunca vira "Só no PACS"
  function linhasPainel(tasyEstado, vistosPacs, tasyNotas, tasyAccs) {
    const usados = new Set(), linhas = [], casou = new Map();
    const todos = Object.values(tasyEstado || {}).filter((e) => !ehCardio(e.exame));
    // 1º pelo nº de acesso, depois por nome + exame — em todos os exames do Tasy, até os cancelados e os fora da tela
    for (const e of todos) {
      // pendente (prescrito) ainda não foi feito: só casa pelo nº de acesso
      const p = e.acc && vistosPacs?.[e.acc] ? [e.acc, vistosPacs[e.acc]] : e.etapa === "prescrito" ? null : acharPacs(e, vistosPacs, todos);
      if (p) { casou.set(e.id, p); usados.add(p[0]); }
    }
    for (const e of todos) {
      if (e.etapa === "cancelado") continue;
      if (e.naTela === false && !PENDENTE.has(e.etapa) && e.etapa !== "laudado") continue;
      const p = casou.get(e.id) || null;
      const nt = tasyNotas?.[e.id];
      linhas.push({
        id: "t" + e.id, origem: "tasy", naTela: e.naTela, tipo: e.tipo, etapa: e.etapa || etapaTasy(e), nome: e.nome, exame: e.exame,
        pessoa: e.pessoa || "", atendimento: e.atendimento || "", prontuario: e.prontuario || "",
        pedidoExterno: !!e.pedidoExterno, contextoContraste: e.contextoContraste || {},
        atend: e.atend, internado: e.internado ?? /intern/i.test(e.atend || ""), status: e.status,
        urgencia: e.urgencia, prescritor: e.prescritor || p?.[1].medico || "", clinico: e.clinico || "",
        prescrito: e.prescrito, execTasy: e.baixa || e.fim || null, chegou: e.chegou, inicio: e.inicio, ordem: e.ordem ?? 1e6,
        pacs: p ? { acc: p[0], quando: p[1].quando || p[1].vistoEm, laudo: !!p[1].laudo } : null,
        notas: nt ? { curto: resumoCurto(nt.resumo), resumo: resumoEssencial(nt.resumo), ultima: nt.ultima, evolucoes: nt.evolucoes, pareceresRadiologia: nt.pareceresRadiologia || [] } : null,
      });
    }
    for (const [acc, v] of Object.entries(vistosPacs || {})) {
      if (usados.has(acc) || tasyAccs?.[acc] || ehCardio(v.exame)) continue;
      linhas.push({
        id: "p" + acc, origem: "pacs", tipo: v.tipo || "TC", etapa: v.laudo ? "laudado" : "executado", nome: v.nome || "", exame: v.exame || "",
        atend: "", urgencia: "", prescritor: v.medico || "", clinico: "", prescrito: null, execTasy: null,
        pacs: { acc, quando: v.quando || v.vistoEm, laudo: !!v.laudo }, notas: null, ordem: 2e6 - (v.quando || v.vistoEm || 0) / 1e9,
      });
    }
    return linhas;
  }
  // lista corrida: o que ainda não foi feito aparece sempre; o que já foi executado (Tasy) ou está no PACS, só se
  // a execução foi nas últimas 24 h
  function naJanela(l, agora = Date.now()) {
    if (l.tipo === "US" && l.origem === "tasy" && l.naTela === true) return true;
    if (!l.pacs && PENDENTE.has(l.etapa)) return true;   // ainda não feito: sempre aparece
    const h = Math.max(l.execTasy || 0, l.pacs?.quando || 0);
    return !!h && agora - h < 24 * 36e5;
  }
  // ordem: pela hora de execução (Tasy ou PACS), mais recente em cima; o que ainda não foi feito vem antes, pela prescrição
  const horaExec = (l) => l.execTasy || l.pacs?.quando || null;
  function ordenarPainel(linhas) {
    return [...linhas].sort((a, b) => (a.ordem ?? 1e6) - (b.ordem ?? 1e6));
  }
  function ordenarPorExecucao(linhas) {
    return [...linhas].sort((a, b) => {
      const ea = horaExec(a), eb = horaExec(b);
      if (!ea !== !eb) return ea ? 1 : -1;
      if (!ea) return (b.prescrito || 0) - (a.prescrito || 0);
      return eb - ea;
    });
  }

  // ---------- Notas clínicas (PEP) ----------
  // Quando o Artur abre as notas de um paciente da lista, o pedido do Tasy tem o nº de atendimento (ou o código da
  // pessoa) desse paciente. Trocando o número por um marcador, o mesmo pedido serve para qualquer paciente.
  const temNumero = (s, n) => n && String(n).length >= 4 && new RegExp(`(?<![0-9])${n}(?![0-9])`).test(s);
  function aprenderModelo(corpo, exames, linhas = []) {
    const candidatos = [
      ...(exames || []),
      ...(Array.isArray(linhas) ? linhas.map((r) => ({
        id: "",
        atendimento: r?.NR_ATENDIMENTO != null ? String(r.NR_ATENDIMENTO) : "",
        pessoa: r?.CD_PESSOA_FISICA != null ? String(r.CD_PESSOA_FISICA) : "",
      })) : []),
    ];
    for (const e of candidatos) {
      const marcas = [];
      let c = String(corpo);
      if (temNumero(c, e.atendimento)) { c = c.replace(new RegExp(`(?<![0-9])${e.atendimento}(?![0-9])`, "g"), "{{ATEND}}"); marcas.push("ATEND"); }
      if (temNumero(c, e.pessoa)) { c = c.replace(new RegExp(`(?<![0-9])${e.pessoa}(?![0-9])`, "g"), "{{PESSOA}}"); marcas.push("PESSOA"); }
      if (marcas.length) return { corpo: c, marcas, de: e.id };
    }
    // Se o paciente aberto no TASY não estava na lista, aprende diretamente pelas chaves JSON NR_ATENDIMENTO / CD_PESSOA_FISICA
    try {
      const obj = JSON.parse(corpo);
      const marcas = [];
      const substituirChaves = (o) => {
        if (!o || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
          if (/^NR_ATENDIMENTO$/i.test(k) && (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)))) {
            o[k] = typeof v === "number" ? "__ATEND_NUM__" : "{{ATEND}}";
            if (!marcas.includes("ATEND")) marcas.push("ATEND");
          } else if (/^CD_PESSOA_FISICA$/i.test(k) && (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)))) {
            o[k] = typeof v === "number" ? "__PESSOA_NUM__" : "{{PESSOA}}";
            if (!marcas.includes("PESSOA")) marcas.push("PESSOA");
          } else substituirChaves(v);
        }
      };
      substituirChaves(obj);
      if (marcas.length) {
        const c = JSON.stringify(obj).replace(/"__ATEND_NUM__"/g, "{{ATEND}}").replace(/"__PESSOA_NUM__"/g, "{{PESSOA}}");
        return { corpo: c, marcas, de: "" };
      }
    } catch {}
    return null;
  }
  // rota do PEP do paciente no Tasy (ui-router: estado "atepaceh-episode")
  const rotaPep = (e) => `#/atepaceh/patientid/${encodeURIComponent(e.pessoa)}/episode/${encodeURIComponent(e.atendimento)}`;
  const notasPorPessoa = (modelo, e) => !!e.pessoa && /\{\{PESSOA\}\}|"CD_PESSOA_FISICA"\s*:/.test(modelo.corpo);
  function preencherIdsNotas(corpo, e) {
    if (!corpo) return corpo;
    let c = String(corpo)
      .replace(/"\{\{ATEND\}\}"/g, e.atendimento ? `"${e.atendimento}"` : "null")
      .replace(/\{\{ATEND\}\}/g, e.atendimento || "null")
      .replace(/"\{\{PESSOA\}\}"/g, e.pessoa ? `"${e.pessoa}"` : "null")
      .replace(/\{\{PESSOA\}\}/g, e.pessoa || "null");
    try {
      const obj = JSON.parse(c);
      const visitar = (o) => {
        if (!o || typeof o !== "object") return;
        for (const [k, f] of Object.entries(o)) {
          if (k === "NR_ATENDIMENTO" && e.atendimento) o[k] = typeof f === "string" ? String(e.atendimento) : Number(e.atendimento);
          else if (k === "CD_PESSOA_FISICA" && e.pessoa) o[k] = typeof f === "string" ? String(e.pessoa) : Number(e.pessoa);
          else visitar(f);
        }
      };
      visitar(obj);
      return JSON.stringify(obj);
    } catch { return c; }
  }
  function montarCorpo(modelo, e, ampliar = false, agora = Date.now()) {
    const pessoa = notasPorPessoa(modelo, e) ? e.pessoa : "";
    const molde = pessoa ? modelo.corpo.replace(/"\{\{ATEND\}\}"|\{\{ATEND\}\}/g, "null") : modelo.corpo;
    const corpo = molde.split("{{ATEND}}").join(e.atendimento || "").split("{{PESSOA}}").join(e.pessoa || "");
    const ajustado = contratoNotas(corpo, agora, pessoa);
    return ampliar ? contratoNotas(recuarPeriodoNotas(ajustado, agora), agora) : ajustado;
  }
  function corposNotas(modelo, e, agora = Date.now()) {
    const resultados = [];
    // 1. Corpo fiel ao pedido original do TASY (mantendo NR_ATENDIMENTO e CD_PESSOA_FISICA reais)
    const fielBase = preencherIdsNotas(corpoDeHoje(modelo.corpo, modelo.em, agora), e);
    if (fielBase) resultados.push(fielBase);
    // 2. Mesmo pedido fiel com janela recuada para 90 dias (se houver filtro de data)
    const fiel90 = recuarPeriodoNotas(fielBase, agora);
    if (fiel90) resultados.push(fiel90);
    // 3. Pedido amplo por pessoa física (todas as evoluções do paciente / equivalente ao Ctrl+F8)
    try {
      const amplo = montarCorpo(modelo, e, true, agora) || montarCorpo(modelo, e, false, agora);
      if (amplo) resultados.push(amplo);
    } catch {}
    return [...new Set(resultados.filter(Boolean))];
  }
  const textoBrutoEvolucao = (r) => String(r?.DS_EVOLUCAO ?? r?.DS_TEXTO ?? r?.DS_NOTA ?? r?.DS_NOTA_CLINICA ?? r?.TX_EVOLUCAO ?? r?.DS_CONTEUDO ?? r?.DS_EVOLUCAO_CLINICA ?? r?.DS_OBSERVACAO ?? "");
  function unirEvolucoes(...listas) {
    const vistas = new Map();
    for (const r of listas.flat().filter((x) => x && typeof x === "object").sort((a, b) => (dataTasy(b.DT_EVOLUCAO || b.DT_LIBERACAO || b.DT_ATUALIZACAO || b.DT_REGISTRO) || 0) -
      (dataTasy(a.DT_EVOLUCAO || a.DT_LIBERACAO || a.DT_ATUALIZACAO || a.DT_REGISTRO) || 0))) {
      const id = [r.NR_SEQ_EVOLUCAO, r.NR_SEQUENCIA, r.NR_EVOLUCAO].map((v) => String(v ?? "").trim()).find(Boolean);
      const chave = id != null ? `id:${id}` : JSON.stringify([dataTasy(r.DT_EVOLUCAO || r.DT_LIBERACAO || r.DT_ATUALIZACAO || r.DT_REGISTRO),
        autorNota(r), limparTexto(textoBrutoEvolucao(r))]);
      if (!vistas.has(chave)) vistas.set(chave, { ...r });
      else {
        const ant = vistas.get(chave);
        for (const [k, v] of Object.entries(r)) if ((ant[k] == null || ant[k] === "") && v != null && v !== "") ant[k] = v;
      }
    }
    return [...vistas.values()];
  }
  function contratoNotas(corpo, agora, pessoa = "") {
    if (!corpo) return corpo;
    let c; try { c = JSON.parse(corpo); } catch { return corpo; }
    const partes = new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
    const v = (k) => partes.find((p) => p.type === k).value;
    const meiaNoite = Date.parse(`${v("year")}-${v("month")}-${v("day")}T03:00:00.000Z`);
    let mudou = false;
    const visitar = (o) => {
      if (!o || typeof o !== "object") return;
      for (const [k, f] of Object.entries(o)) {
        if (pessoa && k === "NR_ATENDIMENTO") { o[k] = null; mudou = true; }
        else if (pessoa && k === "CD_PESSOA_FISICA") { o[k] = typeof f === "number" ? Number(pessoa) : String(pessoa); mudou = true; }
        else if (/^(filterValues|paramsByName)$/.test(k) && f && typeof f === "object") {
          if (pessoa && "NR_ATENDIMENTO" in f) f.NR_ATENDIMENTO = null;
          if (pessoa && "CD_PESSOA_FISICA" in f) f.CD_PESSOA_FISICA = typeof f.CD_PESSOA_FISICA === "number" ? Number(pessoa) : String(pessoa);
          for (const [chave, valor] of [["IE_TODAS_PACIENTE", "P"], ["IE_TODAS_CASE", "AP"]]) {
            f[chave] = valor; mudou = true;
          }
          for (const [chave, dias] of [["DT_INICIO", -90], ["DT_FIM", 1]]) {
            const d = f[chave];
            if (d && typeof d === "object" && typeof d.value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(d.value)) {
              const iso = new Date(meiaNoite + dias * 864e5).toISOString();
              d.value = d.value.includes(".") ? iso : iso.replace(".000", ""); mudou = true;
            }
          }
        } else visitar(f);
      }
    };
    visitar(c);
    return mudou ? JSON.stringify(c) : corpo;
  }
  // Retorna null quando não há filtro cujo formato possamos preservar com segurança.
  function recuarPeriodoNotas(corpo, agora = Date.now()) {
    let c; try { c = JSON.parse(corpo); } catch { return null; }
    let mudou = false;
    const formatar = (v, em) => {
      if (typeof v === "number" && Number.isFinite(v)) return em;
      if (typeof v !== "string") return null;
      if (/^\d{13}$/.test(v)) return String(em);
      const iso = v.match(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/);
      if (iso) {
        const zona = iso[2], min = zona && zona !== "Z" ? (zona[0] === "-" ? -1 : 1) * (+zona.slice(1, 3) * 60 + +zona.slice(4)) : 0;
        const d = new Date(em + min * 60000).toISOString();
        return zona ? d.slice(0, 19) + (iso[1] ? "." + (d.slice(20, 23) + "0".repeat(iso[1].length)).slice(0, iso[1].length - 1) : "") + zona : d.slice(0, 10);
      }
      const br = v.match(/^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/);
      if (!br) return null;
      const d = new Date(em), p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` + (br[1] ? ` ${p(d.getHours())}:${p(d.getMinutes())}` + (br[2] ? `:${p(d.getSeconds())}` : "") : "");
    };
    const visitar = (o, filtro = false) => {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) {
        const instant = filtro && v && typeof v === "object" && /Instant$/i.test(v["@class"] || "");
        if (/^DT_(INICIAL|INICIO|FINAL|FIM)$/i.test(k) || instant) {
          const em = agora + (/FINAL|FIM/i.test(k) ? 1 : -90) * 864e5;
          const objeto = v && typeof v === "object", valor = formatar(objeto ? v.value : v, em);
          if (valor !== null) { if (objeto) v.value = valor; else o[k] = valor; mudou = true; }
        } else if (/^(QT_DIAS|IE_PERIODO)$/i.test(k) && (typeof v === "number" || typeof v === "string")) {
          o[k] = typeof v === "number" ? 90 : "90"; mudou = true;
        } else visitar(v, filtro || /^(filterValues|paramsByName)$/i.test(k));
      }
    };
    visitar(c);
    return mudou ? JSON.stringify(c) : null;
  }
  function erroModeloNotas(modelo, e) {
    if (!modelo?.corpo) return "Abra as Notas clínicas de um paciente da Gestão uma vez no TASY para ativar.";
    if (modelo.corpo.includes("{{ATEND}}") && !e.atendimento && !notasPorPessoa(modelo, e)) return "notas indisponíveis: agendamento sem atendimento; abra Notas clínicas com filtro por pessoa no TASY";
    if (modelo.corpo.includes("{{PESSOA}}") && !e.pessoa) return "Notas indisponíveis: sem código de pessoa física.";
    if (!/\{\{(ATEND|PESSOA)\}\}/.test(modelo.corpo)) return "Molde de notas sem identificação variável; abra novamente as notas no TASY.";
    return "";
  }

  const escaparNota = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function sanitizarNota(s) {
    const tags = new Set("p br b strong i em u ul ol li table thead tbody tr td th span div font h1 h2 h3 h4 h5 h6".split(" "));
    const estilos = { "font-weight": /^(bold|normal|[1-9]00)$/i, "font-style": /^(italic|normal|oblique)$/i,
      "text-decoration": /^(underline|none)$/i, "text-align": /^(left|right|center|justify)$/i,
      color: /^(#[a-f0-9]{3,8}|[a-z]{1,20}|rgba?\(\s*[\d.,%\s]+\))$/i };
    let bloqueadas = [];
    // Nunca insere HTML original no DOM, nem em documento temporário.
    return String(s).replace(/<!--[\s\S]*?(?:-->|$)|<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</gi, (token) => {
      if (token.startsWith("<!--")) return "";
      const m = token.match(/^<(\/?)([a-z][a-z0-9]*)\b([\s\S]*?)>$/i);
      if (!m) return bloqueadas.length ? "" : token.replace(/</g, "&lt;");
      const [, fim, nome, attrs] = m, tag = nome.toLowerCase();
      if (/^(script|style|iframe|object|svg|math|template)$/.test(tag)) {
        if (fim) { if (bloqueadas.at(-1) === tag) bloqueadas.pop(); } else bloqueadas.push(tag);
        return "";
      }
      if (bloqueadas.length || !tags.has(tag)) return "";
      if (fim) return tag === "br" ? "" : `</${tag}>`;
      const permitidos = [];
      for (const a of attrs.matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g)) {
        const k = a[1].toLowerCase(), v = a[2] ?? a[3] ?? a[4] ?? "";
        if ((k === "colspan" || k === "rowspan") && /^[1-9]\d{0,2}$/.test(v)) permitidos.push(`${k}="${v}"`);
        if (k === "style") {
          const css = v.split(";").map((x) => x.split(":")).filter(([p, val, extra]) => !extra && estilos[p?.trim().toLowerCase()]?.test(val?.trim()))
            .map(([p, val]) => `${p.trim().toLowerCase()}:${val.trim()}`).join(";");
          if (css) permitidos.push(`style="${escaparNota(css)}"`);
        }
      }
      return `<${tag}${permitidos.length ? " " + permitidos.join(" ") : ""}>`;
    });
  }
  function rtfHtml(s) {
    let estado = { b: false, i: false, ul: false, skip: false, uc: 1 }, pilha = [], ignorar = 0, out = "";
    const render = (s) => {
      if (!s) return "";
      let texto = escaparNota(s);
      for (const tag of ["ul", "i", "b"]) if (estado[tag]) texto = `<${tag === "ul" ? "u" : tag}>${texto}</${tag === "ul" ? "u" : tag}>`;
      return texto;
    };
    for (const m of String(s).matchAll(/\\([a-z]+)(-?\d+)? ?|\\'([a-f0-9]{2})|\\([^a-z])|[{}]|[^\\{}]+/gi)) {
      const t = m[0];
      if (t === "{") { pilha.push({ ...estado }); continue; }
      if (t === "}") { estado = pilha.pop() || estado; continue; }
      if (m[1]) {
        const c = m[1].toLowerCase(), n = m[2] == null ? 1 : +m[2];
        if (/^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|fldinst)$/.test(c)) estado.skip = true;
        if (estado.skip) continue;
        if (["b", "i", "ul"].includes(c)) estado[c] = n !== 0;
        else if (c === "ulnone") estado.ul = false;
        else if (c === "plain") Object.assign(estado, { b: false, i: false, ul: false });
        else if (c === "par" || c === "line") out += "<br>";
        else if (c === "tab") out += "    ";
        else if (c === "uc") estado.uc = n;
        else if (c === "u") { out += render(String.fromCharCode(n < 0 ? n + 65536 : n)); ignorar = estado.uc; }
        continue;
      }
      if (m[4] === "*") { estado.skip = true; continue; }
      if (estado.skip) continue;
      let texto = m[3] ? String.fromCharCode(parseInt(m[3], 16)) : m[4] ? (/^[\\{}]$/.test(m[4]) ? m[4] : "") : t.replace(/[\r\n]/g, "");
      if (ignorar) { const n = Math.min(ignorar, texto.length); texto = texto.slice(n); ignorar -= n; }
      out += render(texto);
    }
    return out;
  }
  function formatarNota(s) {
    s = String(s || "");
    return /^\s*\{\\rtf/.test(s) ? rtfHtml(s) : /<[a-z][\s\S]*>/i.test(s) ? sanitizarNota(s) : escaparNota(s);
  }
  // texto da nota: o Tasy guarda em RTF ou HTML
  function limparTexto(s) {
    s = String(s || "");
    if (/^\s*\{\\rtf/.test(s)) {
      s = s.replace(/\{\\\*[^{}]*\}/g, "").replace(/\{\\(fonttbl|colortbl|stylesheet)[\s\S]*?\}\}/g, "")
        .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
        .replace(/\\(par|line)\b ?/g, "\n").replace(/\\tab\b ?/g, " ").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
    } else if (/<[a-z][\s\S]*>/i.test(s)) {
      s = s.replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
    }
    return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }

  // resumo por regras: das notas mais recentes (até 72 h), as linhas com motivo, hipótese, queixa, pedido de exame...
  const CHAVE = /\b(HD|HDA|QP|HMA|hip[oó]tese|diagn[oó]stic|queixa|motivo|suspeit|impress[aã]o|solicit|tomograf|\bTC\b|tc de|investiga|descartar|afastar|avalia[cç][aã]o|evolu[ií]u|refere|apresent|dor|trauma|queda|febre|d[eé]ficit|AVC|cefal|dispn|v[oô]mit|sangr|p[oó]s[- ]op|cirurgia|neoplasia|CA\b|onco)/i;
  function autorNota(r) {
    return String(r.NM_MEDICO || r.NM_USUARIO || r.DS_PROF_AGEND || r.NM_PROFISSIONAL || r.NM_PESSOA_FISICA_PROF || "");
  }
  function notaMedica(r) {
    const tipos = [r.DS_TIPO_EVOLUCAO, r.DS_SUBTIPO_EVOLUCAO, r.DS_ESPECIALIDADE_PROF, r.DS_ESPECIALIDADE, r.DS_TITULO, r.DS_ASSUNTO, r.DS_DESCRICAO, r.NM_TIPO_EVOLUCAO, r.DS_FUNCAO, r.DS_CARGO]
      .map((v) => sem(String(v || "")).toLowerCase().replace(/\s+/g, " ").trim());
    const txt = limparTexto(textoBrutoEvolucao(r));
    if (ehParecerRadiologia({ texto: txt, tipo: tipos.join(" · ") })) return true;
    if (tipos.some((t) => /enferm|tecnic|auxiliar de enferm|nutri|fisio|fono|psicol|farmac|servico social|assistente social|terap(?:ia|euta) ocupacional|odontol|pastoral|capel/.test(t))) return false;
    return tipos.some((t) => /medic|parecer|anamnese|admiss|interconsult|alta|radiolog|imagem|plantao|cirurg|clinic|residente|preceptor/.test(t)) ||
      !!tipos[2] || !!tipos[3] || !!String(r.DS_CRM_PROF || r.NR_CRM || r.CD_CRM || "").trim() ||
      r.IE_EVOLUCAO_CLINICA === "M" || !!String(r.NM_MEDICO || "").trim();
  }
  // Somente categorias técnicas: não incluir texto, autor ou identificadores nestas estatísticas.
  function estatisticasNotas(linhas) {
    const porSubtipo = new Map(), valoresClinica = new Set();
    for (const r of linhas) {
      const subtipo = String(r.DS_SUBTIPO_EVOLUCAO ?? r.DS_TIPO_EVOLUCAO ?? "").trim();
      porSubtipo.set(subtipo, (porSubtipo.get(subtipo) || 0) + 1);
      valoresClinica.add(String(r.IE_EVOLUCAO_CLINICA ?? "").trim());
    }
    return { total: linhas.length, medicas: linhas.filter((r) => notaMedica(r) && limparTexto(textoBrutoEvolucao(r))).length,
      porSubtipo: Object.fromEntries(porSubtipo), valoresClinica: [...valoresClinica] };
  }
  // Identifica pareceres da Radiologia publicados nas Notas Clínicas:
  // Procura especificamente por "PARECER PROVISORIO - RADIOLOGIA", "PARECER PROVISORIO RADIOLOGIA", "PARECER RADIOLOGIA" e todos os seus derivados.
  const RE_PARECER_RAD_TEXTO = /\b(?:PARECER|LAUDO)\b(?:[\s\-:–—/.]+(?:PROVISORI[OA]S?|PRELIMINAR(?:ES)?|DEFINITIV[OA]S?|MEDIC[OA]S?|TECNIC[OA]S?|URGENTE|URGENCIA|PLANTAO|INTERCONSULTA|DA|DE|DO|NA|NO|PELA|PELO|SETOR|SERVICO|EQUIPE))*[\s\-:–—/.]+(?:RADIOLOG\w*|DIAGNOSTICO\s+POR\s+IMAGEM)\b|\b(?:RADIOLOG\w*|DIAGNOSTICO\s+POR\s+IMAGEM)\b(?:[\s\-:–—/.]+(?:PARECER|LAUDO|NOTA|AVALIACAO|PROVISORI[OA]S?|PRELIMINAR(?:ES)?|DEFINITIV[OA]S?|MEDIC[OA]S?|DA|DE|DO|SETOR|SERVICO|EQUIPE))*[\s\-:–—/.]+(?:PARECER|LAUDO|NOTA|AVALIACAO|PROVISORI[OA]S?|PRELIMINAR(?:ES)?)\b|\b(?:PARECER|LAUDO)\s+(?:PROVISORI[OA]S?|PRELIMINAR(?:ES)?)\b[\s\-:–—/.]*(?:DA\s+|DE\s+|DO\s+)?(?:RADIOLOG\w*|TOMOGRAF\w*|ANGIOTC\b|TC\b|ULTRASSO\w*|USG?\b|IMAGEM\b)|\b(?:IMPRESSAO\s+RADIOLOGICA|AVALIACAO\s+RADIOLOGICA|NOTA\s+(?:PROVISORIA\s+)?(?:DA\s+|DE\s+)?RADIOLOGIA)\b/;
  const RE_CABECALHO_RAD = /^(?:\s*[\r\n]*)*(?:(?:PARECER|LAUDO)\b[^\r\n]{0,90}\b(?:RADIOLOG\w*|PROVISORI[OA]|PRELIMINAR|TOMOGRAF\w*|TC\b|ANGIOTC\b|US\b|USG\b|ULTRASSO\w*|IMAGEM)|RADIOLOG(?:IA|ICO)\b[\s\-:–—/\r\n]|EQUIPE\s+DE\s+RADIOLOGIA\b)/;
  const RE_PEDIDO_TERCEIROS = /\b(?:SOLICIT\w*|AGUARD\w*|PEDID\w*|PEDIR|PENDENTE|COBR\w*|SUGER\w*)\s+(?:DE\s+|O\s+|UM\s+|NOVO\s+)?(?=PARECER\b)/g;
  function ehParecerRadiologia(n) {
    if (!n) return false;
    const txt = sem(n.texto || limparTexto(n.original || ""));
    const tp = sem(n.tipo || "");
    if (!txt && !tp) return false;
    // Se o tipo/título/subtipo da nota já traz "PARECER PROVISORIO - RADIOLOGIA", "PARECER RADIOLOGIA", "RADIOLOGIA", etc.
    if (tp && (RE_PARECER_RAD_TEXTO.test(tp) || /\b(?:RADIOLOG\w*|DIAGNOSTICO\s+POR\s+IMAGEM|PARECER\s+PROVISORI[OA])\b/.test(tp))) return true;
    if (!txt) return false;
    // Remove menções de terceiros como "solicito parecer da radiologia" / "aguardando parecer radiologia" no meio de evolução clínica
    const txtLimpo = txt.replace(RE_PEDIDO_TERCEIROS, "");
    if (RE_PARECER_RAD_TEXTO.test(txtLimpo) || RE_CABECALHO_RAD.test(txtLimpo)) return true;
    const linhasIniciais = txtLimpo.split(/\n/).slice(0, 6).join(" ");
    if (/\b(?:PARECER\s+PROVISORI[OA]|PARECER\s+PRELIMINAR|LAUDO\s+PROVISORI[OA]|LAUDO\s+PRELIMINAR|PARECER\b[^\r\n]{0,60}\bRADIOLOG\w*|RADIOLOG\w*[^\r\n]{0,60}\bPARECER)\b/.test(linhasIniciais)) return true;
    if (/\b(PARECER|RADIOLOGIA)\b/.test(linhasIniciais) && /\b(RADIOLOG\w*|TOMOGRAF\w*|ANGIOTC|\bTC\b|\bUSG?\b|ULTRASSO\w*|IMAGEM|LAUDO|CONTRASTE)\b/.test(txtLimpo)) return true;
    return false;
  }
  function extrairPareceresRadiologia(notasOuLista) {
    if (!notasOuLista) return [];
    if (Array.isArray(notasOuLista.pareceresRadiologia) && notasOuLista.pareceresRadiologia.length) {
      return notasOuLista.pareceresRadiologia.slice(0, 2);
    }
    const base = Array.isArray(notasOuLista)
      ? notasOuLista
      : [...(notasOuLista.evolucoes || []), ...(notasOuLista.ultima ? [notasOuLista.ultima] : [])];
    const unicos = [];
    for (const u of base) {
      if (!ehParecerRadiologia(u)) continue;
      if (unicos.some((x) => x.quando === u.quando && x.texto === u.texto)) continue;
      unicos.push(u);
    }
    return unicos.sort((a, b) => (b.quando || 0) - (a.quando || 0)).slice(0, 2);
  }
  // Filtro por tipo de exame de TC: "abdome" (TC de Abdome/Pelve/Urotomo/AngioTC Abdome) e "torax" (TC de Tórax e AngioTC de Tórax/TEP/Aorta Torácica).
  function exameTcFiltro(l, filtro = "todos") {
    if (!l) return false;
    const ex = sem(desc(l.exame || ""));
    const isTc = l.tipo === "TC" || /\b(TC|CT|TOMOGRAF|ANGIOTC|ANGIOTOMOGRAF|UROTOMO|UROTC)\b/.test(ex);
    if (!isTc) return false;
    const ehTorax = /\b(TORAX|TORACIC[OA]|PULMONAR(?:ES)?|TEP|MEDIASTINO|CORONARIA)\b/.test(ex);
    const ehAbdome = /\b(ABDOME|ABDOMEN|ABDOMINAL|PELVE|PELVIC[OA]|BACIA|UROTOMO(?:GRAFIA)?|URO[\s-]*TC|APARELHO\s+URINARIO|VIAS\s+URINARIAS|ILIACAS?)\b/.test(ex);
    if (filtro === "torax") return ehTorax;
    if (filtro === "abdome") return ehAbdome;
    return ehAbdome || ehTorax;
  }
  function resumoNotas(linhas, agora = Date.now()) {
    const comTexto = unirEvolucoes(linhas || []).map((r) => {
      const bruto = textoBrutoEvolucao(r);
      const partesTipo = [];
      for (const v of [r.DS_TIPO_EVOLUCAO, r.DS_SUBTIPO_EVOLUCAO, r.DS_TITULO, r.DS_ASSUNTO, r.DS_DESCRICAO, r.NM_TIPO_EVOLUCAO, r.DS_ESPECIALIDADE_PROF || r.DS_ESPECIALIDADE]) {
        const s = String(v || "").trim();
        if (s && !partesTipo.some((p) => sem(p) === sem(s))) partesTipo.push(s);
      }
      return {
        quando: dataTasy(r.DT_EVOLUCAO || r.DT_LIBERACAO || r.DT_ATUALIZACAO || r.DT_REGISTRO),
        tipo: partesTipo.join(" · "),
        quem: autorNota(r), texto: limparTexto(bruto), original: String(bruto || ""),
        medica: notaMedica(r),
      };
    }).filter((n) => n.texto).sort((a, b) => (b.quando || 0) - (a.quando || 0))
      .filter((n, i, a) => a.findIndex((x) => x.texto === n.texto && x.quando === n.quando && x.quem === n.quem) === i);
    if (!comTexto.length) return null;
    const pareceresRadiologia = comTexto.filter(ehParecerRadiologia).slice(0, 2)
      .map((n) => ({ quando: n.quando, tipo: n.tipo, quem: n.quem, medica: n.medica, texto: n.texto, original: n.original }));
    const medicas = comTexto.filter((n) => n.medica);
    const todas = medicas.length ? medicas : comTexto;
    // resumo: só as notas recentes (72 h); se não houver, as mais novas que tiver
    const recentes = todas.filter((n) => r_ok(n.quando, agora));
    const notas = (recentes.length ? recentes : todas).sort((a, b) => (b.medica - a.medica) || ((b.quando || 0) - (a.quando || 0)));
    const vistas = new Set(), pedacos = [];
    for (const n of notas.slice(0, 3)) {
      for (const l of n.texto.split(/\n|(?<=[.;])\s+/)) {
        const t = l.trim();
        if (t.length < 8 || !CHAVE.test(t) || vistas.has(t.toLowerCase())) continue;
        vistas.add(t.toLowerCase()); pedacos.push(t);
        if (pedacos.join(" ").length > 600) break;
      }
      if (pedacos.join(" ").length > 600) break;
    }
    const n0 = notas[0];
    // Modal: cinco médicas; sem classificação médica, cinco notas de qualquer tipo.
    const porData = [...todas].sort((a, b) => (b.quando || 0) - (a.quando || 0));
    const evolucoes = porData.slice(0, 5)
      .sort((a, b) => (b.quando || 0) - (a.quando || 0))
      .map((n) => ({ quando: n.quando, tipo: n.tipo, quem: n.quem, medica: n.medica, texto: n.texto, original: n.original }));
    return { v: 6, evolucoes, pareceresRadiologia,
      resumo: resumoEssencial(pedacos.length ? pedacos : [n0.texto]),
      curto: resumoCurto(pedacos.length ? pedacos.join(" · ") : n0.texto.slice(0, 140)),
      ultima: { quando: n0.quando, tipo: n0.tipo, quem: n0.quem, texto: n0.texto.slice(0, 4000) }, n: notas.length,
    };
  }
  // resumo enxuto: frases com HD/hipótese/motivo/pedido primeiro, cada uma com até ~110 caracteres, no máximo 3
  const ESSENCIAL = /\b(HD|hip[oó]tese|suspeit|motivo|solicit|diagn[oó]stic|investiga|descartar|afastar|QP|queixa|trauma|queda|d[eé]ficit|AVC|dor)\b/i;
  function cortarFrase(t, max = 110) {
    t = String(t).replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const c = t.slice(0, max);
    return c.slice(0, Math.max(c.lastIndexOf(" "), max * 0.6)).replace(/[,;:.]$/, "") + "…";
  }
  function resumoEssencial(pedacos, max = 3) {
    const lista = (Array.isArray(pedacos) ? pedacos : String(pedacos || "").split(" · ")).map((x) => String(x).trim()).filter(Boolean);
    const ord = [...lista].sort((a, b) => (PRIORIDADE.test(b) - PRIORIDADE.test(a)) || (ESSENCIAL.test(b) - ESSENCIAL.test(a)));
    return ord.slice(0, max).map((x) => cortarFrase(x)).join(" · ");
  }
  const r_ok = (q, agora) => !q || agora - q < 72 * 36e5;
  const PRIORIDADE = /\b(HD|hip[oó]tese|suspeit|motivo|solicit|diagn[oó]stic|investiga|descartar|afastar|QP|queixa)/i;
  function resumoCurto(resumo, max = 220) {
    const p = String(resumo || "").split(" · ").map((x) => x.trim()).filter(Boolean);
    if (!p.length) return "";
    p.sort((a, b) => PRIORIDADE.test(b) - PRIORIDADE.test(a));
    let out = "";
    for (const x of p) {
      if (out && (out + " · " + x).length > max) continue;   // não cabe inteira: tenta a próxima
      out = out ? out + " · " + x : x;
    }
    if (out.length <= max) return out;
    const corte = out.slice(0, max);   // uma frase só e longa: corta no fim de uma palavra
    return corte.slice(0, Math.max(corte.lastIndexOf(" "), max * 0.6)).replace(/[,;:]$/, "") + "…";
  }

  // O filtro do Tasy guardado pode ter a data do dia em que foi visto. Nos dias seguintes, troca essa data pela de hoje
  // (DD/MM/AAAA, AAAA-MM-DD e milissegundos), para não ficar lendo a lista de um dia antigo.
  function corpoDeHoje(corpo, em, agora = Date.now()) {
    if (!corpo || !em) return corpo;
    const dia = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
    const dias = Math.round((dia(agora) - dia(em)) / 864e5);
    if (dias <= 0) return corpo;
    const d0 = dia(em), perto = (d) => { const dif = d - d0; return dif >= -30 * 864e5 - 1 && dif <= 2 * 864e5 + 1; };
    const p2 = (n) => String(n).padStart(2, "0");
    const mais = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
    return String(corpo)
      .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (x, dd, mm, aa) => {
        const d = new Date(+aa, mm - 1, +dd); if (!perto(d)) return x;
        const n = mais(d); return `${p2(n.getDate())}/${p2(n.getMonth() + 1)}/${n.getFullYear()}`;
      })
      .replace(/\b(\d{4})-(\d{2})-(\d{2})/g, (x, aa, mm, dd) => {
        const d = new Date(+aa, mm - 1, +dd); if (!perto(d)) return x;
        const n = mais(d); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}`;
      })
      .replace(/(?<![0-9])1\d{12}(?![0-9])/g, (x) => { const dif = +x - em; return dif >= -30 * 864e5 && dif <= 2 * 864e5 ? String(+x + dias * 864e5) : x; });
  }

  // A Gestão pode limitar a página mesmo quando pedimos 2.000 registros.
  // Preserva setor, status e intervalo escolhido no TASY; avança datas antigas.
  // pageBegin é o índice da primeira linha (base 1 no contrato WCPanel).
  function corpoTasy(corpo, em, agora = Date.now(), pagina = 0, recebidas = 0) {
    let c; try { c = JSON.parse(corpoDeHoje(corpo, em, agora)); } catch { return corpoDeHoje(corpo, em, agora); }
    const op = Array.isArray(c) ? c[0] : c;
    if (!op || typeof op !== "object" || !("recordsPerPage" in op || op.parameters)) return corpoDeHoje(corpo, em, agora);
    Object.assign(op, { recordsPerPage: 2000, page: (op.page === 0 ? 0 : 1) + pagina, pageBegin: 1 + recebidas });
    return JSON.stringify(c);
  }
  async function lerGestao(modelo, pedir, agora = Date.now()) {
    const linhas = [], paginas = new Set(); let total = null;
    for (let pagina = 0; pagina < 50; pagina++) {
      const raw = await pedir(corpoTasy(modelo.corpo, modelo.em, agora, pagina, linhas.length));
      let resposta;
      try { resposta = typeof raw === "string" ? JSON.parse(raw) : raw; }
      catch { throw new Error("Gestão: resposta JSON inválida (sessão indisponível)."); }
      const d = resposta?.dados;
      if (!Array.isArray(d?.linhasResultSet)) throw new Error("Gestão: resposta sem lista (sessão indisponível).");
      const ls = d.linhasResultSet;
      if (ls.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Gestão: linha inválida.");
      // WCPanel também informa o total nas linhas (modelo real: 100/127).
      const totais = [d.qtTotalRegistros, d.totalItems, resposta.totalItems, ...ls.map((r) => r.QT_TOT_REG_INT_WCP)]
        .filter((v) => v != null);
      for (const valor of totais) {
        const n = typeof valor === "string" && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
        if (!Number.isSafeInteger(n) || n < 0) throw new Error("Gestão: total inválido.");
        if (total !== null && total !== n) throw new Error("Gestão mudou durante a leitura; atualize novamente.");
        total = n;
      }
      if (total > 100000 || linhas.length + ls.length > 100000) throw new Error("Gestão excedeu o limite seguro de linhas.");
      if (total !== null && linhas.length + ls.length > total) throw new Error("Gestão: linhas excedem o total; leitura incompleta.");
      const assinatura = JSON.stringify(ls);
      if (ls.length && paginas.has(assinatura)) throw new Error("Gestão: paginação repetida; leitura incompleta.");
      paginas.add(assinatura); linhas.push(...ls);
      if (total !== null && linhas.length >= total) return linhas;
      if (!ls.length) {
        if (total !== null) throw new Error("Gestão: página vazia antes do total; leitura incompleta.");
        return linhas;
      }
      // Sem total, termina somente em página vazia: servidor pode limitar a página.
    }
    throw new Error("Gestão excedeu o limite seguro de páginas.");
  }
  function chaveBuscaGestao(b) {
    try {
      const c = JSON.parse(b.corpo), op = Array.isArray(c) ? c[0] : c;
      for (const k of ["page", "pageBegin", "recordsPerPage"]) delete op[k];
      for (const mapa of [op.parameters, op.filterValues]) for (const k of ["DT_INICIAL", "DT_FINAL"]) {
        if (mapa?.[k] && typeof mapa[k] === "object") mapa[k].value = "DATA";
      }
      return b.url + "|" + JSON.stringify(c);
    } catch { return b.url + "|" + b.corpo; }
  }
  const corTasyValida = (s) => typeof s === "string" && /^(#[a-f0-9]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(s);

  const exportar = { rotaPep, ehCardio, ordenarPorExecucao, naJanela, resumoEssencial, corpoTasy, mesmoPaciente, mesmoExame, campoPrescritorOk, prescritorTasy, corpoDeHoje, aprenderModelo, montarCorpo, limparTexto, resumoNotas, tipoTasy, dataTasy, tasyExames, etapaTasy, tasyMudancas, noPacs, acharPacs, dataPacs, linhasPainel, ordenarPainel, horaExec, resumoCurto, PADRAO, CORPO_PADRAO, corpoPagina, sem, doHospital, ehTC, tipoPacs, laudado, nome, desc, resumoCampos,
    acharCampoHospital, mesclar, podeLogar };
  Object.assign(exportar, { formatarNota, sanitizarNota, erroModeloNotas, indicacaoTasy, recuarPeriodoNotas, atendimentoTasy, idTasy, lerGestao, chaveBuscaGestao, corTasyValida, chegadaTasy, corposNotas, unirEvolucoes, contextoContraste, canceladoTasy });
  Object.assign(exportar, { estatisticasNotas, ehParecerRadiologia, extrairPareceresRadiologia, exameTcFiltro });
  if (typeof module !== "undefined") module.exports = exportar;
  else globalThis.Regras = exportar;
})();
