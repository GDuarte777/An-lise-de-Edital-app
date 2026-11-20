import { useState, useEffect, useMemo, useRef } from "react";
import { urlDaApi } from "../utils/apiBase";
import {
  Search, ShieldCheck, MapPin, Calendar, Clock, Landmark, Coins,
  ExternalLink, Sparkles, RefreshCw, AlertCircle, FileText, CheckCircle2,
  Filter, Info, ChevronLeft, ChevronRight, ChevronDown, X, Check, Building2, SlidersHorizontal, RotateCcw, Download, Eye
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { type StatusBuscaPncp } from "../utils/pncpQuery";
import {
  buscarContratacoesPncp,
  enriquecerPrecosEmSegundoPlano,
  listarArquivosPncp,
  baixarArquivoPncpComoBase64,
  listarItensCompraPncp,
  type ItemPrecoPncp,
} from "../utils/pncpClient";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  resolverCapagPorOrgaoOuLocal,
  obterEstiloNotaCapag,
} from "../utils/capagData";

interface RadarOportunidadesTabProps {
  onSelectForAnalysis: (text: string) => void;
  onNavigateToCapag?: (focus: { uf?: string; municipio?: string; orgao?: string }) => void;
}

interface LicitacaoDetailed {
  id: string;
  numeroControlePNCP: string;
  numero: string;
  orgao: string;
  cnpjOrgao?: string;
  uf: string;
  municipio: string;
  unidade: string;
  uasg?: string;
  objeto: string;
  dataPublicacao: string;
  dataAbertura: string;
  valorEstimadoRaw: number;
  valorEstimado: string;
  valorHomologadoRaw?: number;
  valorHomologado?: string;
  orcamentoSigiloso?: boolean;
  precoCarregando?: boolean;
  modalidade: string;
  modalidadeId?: string | number;
  situacao: string;
  linkPNCP?: string;
}

const ALL_UFS = [
  { sigla: "AC", nome: "Acre" },
  { sigla: "AL", nome: "Alagoas" },
  { sigla: "AP", nome: "Amapá" },
  { sigla: "AM", nome: "Amazonas" },
  { sigla: "BA", nome: "Bahia" },
  { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" },
  { sigla: "ES", nome: "Espírito Santo" },
  { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" },
  { sigla: "MT", nome: "Mato Grosso" },
  { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MG", nome: "Minas Gerais" },
  { sigla: "PA", nome: "Pará" },
  { sigla: "PB", nome: "Paraíba" },
  { sigla: "PR", nome: "Paraná" },
  { sigla: "PE", nome: "Pernambuco" },
  { sigla: "PI", nome: "Piauí" },
  { sigla: "RJ", nome: "Rio de Janeiro" },
  { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RS", nome: "Rio Grande do Sul" },
  { sigla: "RO", nome: "Rondônia" },
  { sigla: "RR", nome: "Roraima" },
  { sigla: "SC", nome: "Santa Catarina" },
  { sigla: "SP", nome: "São Paulo" },
  { sigla: "SE", nome: "Sergipe" },
  { sigla: "TO", nome: "Tocantins" }
];

// Tabela de domínio oficial do PNCP.
// ⚠️ O código anterior usava 5 para "Pregão Eletrônico", mas 5 é Concorrência
// PRESENCIAL — Pregão Eletrônico é 6. A modalidade mais usada do país nunca era
// consultada, e era essa a maior razão de "só aparecem algumas oportunidades".
const ALL_MODALIDADES = [
  { id: "6", nome: "Pregão Eletrônico" },
  { id: "8", nome: "Dispensa de Licitação" },
  { id: "4", nome: "Concorrência Eletrônica" },
  { id: "9", nome: "Inexigibilidade" },
  { id: "12", nome: "Credenciamento" },
  { id: "7", nome: "Pregão Presencial" },
  { id: "5", nome: "Concorrência Presencial" },
  { id: "1", nome: "Leilão Eletrônico" },
  { id: "3", nome: "Concurso" },
  { id: "2", nome: "Diálogo Competitivo" }
];

export default function RadarOportunidadesTab({
  onSelectForAnalysis,
  onNavigateToCapag,
}: RadarOportunidadesTabProps) {
  // Filter States
  const [keyword, setKeyword] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [selectedUfs, setSelectedUfs] = useState<string[]>([]); // Default empty = All UFs (Brasil)
  const [selectedModalidades, setSelectedModalidades] = useState<string[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<StatusBuscaPncp>("todos");
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [periodDays, setPeriodDays] = useState<number>(90);

  // UI & Data States
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<LicitacaoDetailed[]>([]);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [activeItem, setActiveItem] = useState<LicitacaoDetailed | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Arquivos oficiais (edital, anexos, termo de referência) da contratação
  // selecionada, buscados sob demanda no PNCP.
  const [arquivos, setArquivos] = useState<Array<{ sequencialDocumento: number; titulo: string; tipo: string; uri: string }>>([]);
  const [arquivosLoading, setArquivosLoading] = useState(false);
  const [arquivosError, setArquivosError] = useState<string | null>(null);
  const [itensDisputa, setItensDisputa] = useState<ItemPrecoPncp[]>([]);
  const [itensLoading, setItensLoading] = useState(false);
  const [preparandoAnalise, setPreparandoAnalise] = useState<string | null>(null);
  const [resultadoParcial, setResultadoParcial] = useState(false);
  // Modalidades que o PNCP recusou nesta busca: o usuário precisa saber que o
  // que está vendo não é o portal inteiro, senão conclui que a licitação não existe.
  const [avisosPNCP, setAvisosPNCP] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [dataSource, setDataSource] = useState<string>("PNCP Live");
  const [showStatePicker, setShowStatePicker] = useState<boolean>(false);
  const [showModalidadesPicker, setShowModalidadesPicker] = useState<boolean>(false);
  const [ufSearchQuery, setUfSearchQuery] = useState<string>("");
  const fetchGenerationRef = useRef<number>(0);

  // Toggle UF Selection
  const handleToggleUf = (sigla: string) => {
    setSelectedUfs(prev => {
      if (prev.includes(sigla)) {
        return prev.filter(s => s !== sigla);
      } else {
        return [...prev, sigla];
      }
    });
    setPage(1);
  };

  const handleSelectAllUfs = () => {
    setSelectedUfs([]);
    setPage(1);
  };

  // Toggle Modalidade Selection
  const handleToggleModalidade = (id: string) => {
    setSelectedModalidades(prev => {
      if (prev.includes(id)) {
        return prev.filter(m => m !== id);
      } else {
        return [...prev, id];
      }
    });
    setPage(1);
  };

  // Filter UFs list by search query
  const filteredUfs = useMemo(() => {
    if (!ufSearchQuery.trim()) return ALL_UFS;
    const q = ufSearchQuery.toLowerCase();
    return ALL_UFS.filter(uf => uf.sigla.toLowerCase().includes(q) || uf.nome.toLowerCase().includes(q));
  }, [ufSearchQuery]);

  // Clear all filters
  const handleResetFilters = () => {
    setKeyword("");
    setCityQuery("");
    setSelectedUfs([]);
    setSelectedModalidades([]);
    setStatusFiltro("todos");
    setValorMin("");
    setValorMax("");
    setPeriodDays(90);
    setUfSearchQuery("");
    setPage(1);
  };

  // Fetch from PNCP (Direct Browser Search + Automatic Progressive Price Resolution)
  const handleFetchPNCP = async (targetPage = page) => {
    const currentGeneration = ++fetchGenerationRef.current;
    setLoading(true);
    setError(null);
    setResultadoParcial(false);
    setAvisosPNCP([]);

    try {
      const json = await buscarContratacoesPncp({
        pagina: targetPage,
        tamanhoPagina: pageSize,
        status: statusFiltro,
        q: keyword.trim() || undefined,
        municipio: cityQuery.trim() || undefined,
        ufs: selectedUfs,
        modalidades: selectedModalidades,
        periodDays,
      });

      if (currentGeneration !== fetchGenerationRef.current) return;

      if (json && Array.isArray(json.data)) {
        const mapped: LicitacaoDetailed[] = json.data.map((item: any, idx: number) => {
          const numControle = item.idContratacaoPNCP || item.numeroControlePNCP || `${item.cnpjOrgao || '00000000000100'}-1-${idx}/${item.anoCompra || 2026}`;
          const cnpj = item.cnpjOrgao || item.orgaoEntidade?.cnpj || "";
          const ano = item.anoCompra || 2026;
          const seq = item.sequencialCompra || idx + 1;
          const linkDirect = item.linkPNCP || (cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : `https://pncp.gov.br/app/editais?q=${encodeURIComponent(numControle)}`);

          const orgaoNome = item.orgaoEntidade?.razaoSocial || "Órgão Público Proponente";
          const ufSigla = item.unidadeOrgao?.ufSigla || item.uf || (selectedUfs.length === 1 ? selectedUfs[0] : "BR");
          const municipioNome = item.unidadeOrgao?.municipioNome || "Município Atendido";
          const unidadeNome = item.unidadeOrgao?.nomeUnidade || "Setor de Licitações e Compras";
          const uasgFormatted = item.uasg || (item.unidadeOrgao?.codigoUnidade ? `UASG ${item.unidadeOrgao.codigoUnidade}` : "");
          const desc = item.objetoCompra || item.objeto || "Objeto de aquisição ou prestação de serviço público.";

          const rawVal =
            typeof item.valorTotalEstimado === "number"
              ? item.valorTotalEstimado
              : Number(item.valorTotalEstimado) || 0;
          const rawHomologado =
            typeof item.valorTotalHomologado === "number"
              ? item.valorTotalHomologado
              : Number(item.valorTotalHomologado) || 0;
          const sigiloso = Boolean(item.orcamentoSigiloso);
          const pendente = Boolean(item.precoPendente) && rawVal <= 0 && rawHomologado <= 0;

          const valorFormatted =
            rawVal > 0
              ? `R$ ${rawVal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : rawHomologado > 0
              ? `R$ ${rawHomologado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Homologado)`
              : pendente
              ? "Calculando preço no PNCP..."
              : sigiloso
              ? "Orçamento Sigiloso"
              : "Preço somente no PDF do Edital";

          const valorHomologadoFormatted =
            rawHomologado > 0
              ? `R$ ${rawHomologado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : undefined;

          const pubDateFormatted = item.dataPublicacaoPncp
            ? new Date(item.dataPublicacaoPncp).toLocaleDateString("pt-BR")
            : "Data Recente";

          const openDateFormatted = item.dataAberturaProposta
            ? new Date(item.dataAberturaProposta).toLocaleDateString("pt-BR") + " às " + new Date(item.dataAberturaProposta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : "Ver Cronograma no Edital";

          return {
            id: `pncp-${numControle}-${idx}`,
            numeroControlePNCP: numControle,
            numero: `Certame PNCP: ${item.processo || item.numeroCompra || seq}/${ano}`,
            orgao: orgaoNome,
            cnpjOrgao: cnpj,
            uf: ufSigla,
            municipio: municipioNome,
            unidade: unidadeNome,
            uasg: uasgFormatted,
            objeto: desc,
            dataPublicacao: pubDateFormatted,
            dataAbertura: openDateFormatted,
            valorEstimadoRaw: rawVal > 0 ? rawVal : rawHomologado,
            valorEstimado: valorFormatted,
            valorHomologadoRaw: rawHomologado,
            valorHomologado: valorHomologadoFormatted,
            orcamentoSigiloso: sigiloso,
            precoCarregando: pendente,
            modalidade: item.modalidadeNome || "Pregão Eletrônico",
            modalidadeId: item.modalidadeId,
            situacao: item.situacaoCompraNome || "Divulgada no PNCP",
            linkPNCP: linkDirect
          };
        });

        // Client-side filtering for value ranges if provided (mantém itens cujo preço ainda está carregando)
        let filtered = mapped;
        const minV = parseFloat(valorMin);
        const maxV = parseFloat(valorMax);

        if (!isNaN(minV) && minV > 0) {
          filtered = filtered.filter(i => i.precoCarregando || i.valorEstimadoRaw >= minV);
        }
        if (!isNaN(maxV) && maxV > 0) {
          filtered = filtered.filter(i => i.precoCarregando || i.valorEstimadoRaw <= maxV);
        }

        setResults(filtered);
        setTotalRecords(json.totalRegistros || filtered.length);
        setTotalPages(json.totalPaginas || Math.ceil((json.totalRegistros || filtered.length) / pageSize));
        setResultadoParcial(Boolean(json.resultadoParcial));
        setAvisosPNCP(Array.isArray(json.avisosPNCP) ? json.avisosPNCP : []);
        setDataSource(json.source === "pncp_api_real" ? "Portal PNCP Oficial (tempo real)" : "Origem desconhecida");
        setLastUpdated(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        setActiveItem(null);

        // Dispara o enriquecimento automático de todos os cards da página em segundo plano (4 por vez)
        const filaPrecos = filtered
          .filter((i) => i.precoCarregando)
          .map((i) => ({ numeroControlePNCP: i.numeroControlePNCP, precoPendente: true }));

        if (filaPrecos.length > 0) {
          enriquecerPrecosEmSegundoPlano(
            filaPrecos,
            (numControle, detalhe) => {
              if (currentGeneration !== fetchGenerationRef.current) return;

              const vEst = detalhe?.valorTotalEstimado && detalhe.valorTotalEstimado > 0 ? detalhe.valorTotalEstimado : 0;
              const vHom = detalhe?.valorTotalHomologado && detalhe.valorTotalHomologado > 0 ? detalhe.valorTotalHomologado : 0;
              const sig = Boolean(detalhe?.orcamentoSigiloso);
              const rawFinal = vEst > 0 ? vEst : vHom;

              const txtValor =
                vEst > 0
                  ? `R$ ${vEst.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : vHom > 0
                  ? `R$ ${vHom.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Homologado)`
                  : sig
                  ? "Orçamento Sigiloso"
                  : "Preço somente no PDF do Edital";

              const txtHomologado =
                vHom > 0
                  ? `R$ ${vHom.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : undefined;

              const novaAbertura =
                detalhe?.dataAberturaProposta || detalhe?.dataEncerramentoProposta
                  ? new Date(detalhe.dataAberturaProposta || detalhe.dataEncerramentoProposta!).toLocaleDateString("pt-BR") +
                    " às " +
                    new Date(detalhe.dataAberturaProposta || detalhe.dataEncerramentoProposta!).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : undefined;

              const atualizarCard = (card: LicitacaoDetailed): LicitacaoDetailed => {
                if (card.numeroControlePNCP !== numControle) return card;
                return {
                  ...card,
                  valorEstimadoRaw: rawFinal > 0 ? rawFinal : card.valorEstimadoRaw,
                  valorEstimado: rawFinal > 0 ? txtValor : card.valorEstimadoRaw > 0 ? card.valorEstimado : txtValor,
                  valorHomologadoRaw: vHom > 0 ? vHom : card.valorHomologadoRaw,
                  valorHomologado: txtHomologado || card.valorHomologado,
                  orcamentoSigiloso: sig,
                  precoCarregando: false,
                  dataAbertura:
                    card.dataAbertura === "Ver Cronograma no Edital" && novaAbertura
                      ? novaAbertura
                      : card.dataAbertura,
                };
              };

              setResults((prev) => {
                let atualizados = prev.map(atualizarCard);
                if (!isNaN(minV) && minV > 0) {
                  atualizados = atualizados.filter((i) => i.precoCarregando || i.valorEstimadoRaw >= minV);
                }
                if (!isNaN(maxV) && maxV > 0) {
                  atualizados = atualizados.filter((i) => i.precoCarregando || i.valorEstimadoRaw <= maxV);
                }
                return atualizados;
              });

              setActiveItem((prev) => (prev && prev.numeroControlePNCP === numControle ? atualizarCard(prev) : prev));
            },
            {
              concorrencia: 4,
              shouldCancel: () => currentGeneration !== fetchGenerationRef.current,
            }
          ).catch(() => {});
        }
      } else {
        setResults([]);
        setTotalRecords(0);
        setActiveItem(null);
      }

      // "Nenhum resultado para este filtro" passou a ser uma resposta de
      // sucesso, e não mais um 502. São situações diferentes: numa o usuário
      // ajusta a busca, na outra o portal falhou.
      if (json?.aviso) setError(json.aviso);
    } catch (err: any) {
      console.error("Error fetching PNCP:", err);
      // A mensagem do servidor diz o que o PNCP respondeu. Trocá-la por um
      // texto genérico foi o que deixou um erro 400 de parâmetro parecer
      // instabilidade do portal durante meses.
      setError(err?.message || "Não foi possível carregar as licitações. Tente novamente.");
      setResults([]);
      setActiveItem(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    handleFetchPNCP(1);
  }, [selectedUfs, selectedModalidades, statusFiltro, pageSize, periodDays]);

  // Fecha o popup de detalhes ao pressionar ESC
  useEffect(() => {
    if (!activeItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveItem(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItem]);

  // Busca os documentos oficiais e os itens com preços da contratação selecionada assim que ela muda.
  useEffect(() => {
    setArquivos([]);
    setArquivosError(null);
    setItensDisputa([]);
    if (!activeItem?.numeroControlePNCP) return;

    let cancelado = false;
    setArquivosLoading(true);
    setItensLoading(true);

    listarArquivosPncp(activeItem.numeroControlePNCP)
      .then((lista) => {
        if (cancelado) return;
        setArquivos(Array.isArray(lista) ? lista : []);
      })
      .catch((err) => {
        if (!cancelado) setArquivosError(err?.message || "Não foi possível listar os arquivos deste edital.");
      })
      .finally(() => {
        if (!cancelado) setArquivosLoading(false);
      });

    listarItensCompraPncp(activeItem.numeroControlePNCP)
      .then((itens) => {
        if (cancelado) return;
        const lista = Array.isArray(itens) ? itens : [];
        setItensDisputa(lista);

        // Se o cabeçalho não trouxe o preço global, soma os itens e atualiza o card ativo e a lista
        if (activeItem.valorEstimadoRaw <= 0 && lista.length > 0) {
          const soma = lista.reduce((acc, it) => acc + (it.valorTotal > 0 ? it.valorTotal : 0), 0);
          if (soma > 0) {
            const formatado = `R$ ${soma.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            setActiveItem((prev) =>
              prev && prev.numeroControlePNCP === activeItem.numeroControlePNCP
                ? { ...prev, valorEstimadoRaw: soma, valorEstimado: formatado }
                : prev
            );
            setResults((prev) =>
              prev.map((r) =>
                r.numeroControlePNCP === activeItem.numeroControlePNCP
                  ? { ...r, valorEstimadoRaw: soma, valorEstimado: formatado }
                  : r
              )
            );
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setItensLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [activeItem?.numeroControlePNCP]);

  const baixarArquivo = (arq: { uri: string; titulo: string }) => {
    if (/^https:\/\/pncp\.gov\.br\//.test(arq.uri)) {
      window.open(arq.uri, "_blank");
      return;
    }
    const nome = /\.\w{2,5}$/.test(arq.titulo) ? arq.titulo : `${arq.titulo}.pdf`;
    window.open(urlDaApi(`/api/pncp/arquivo?uri=${encodeURIComponent(arq.uri)}&nome=${encodeURIComponent(nome)}`), "_blank");
  };

  /**
   * Manda o ARQUIVO REAL do edital para a análise.
   */
  const analisarArquivoComIA = async (item: LicitacaoDetailed, arq: { uri: string; titulo: string }) => {
    setPreparandoAnalise(arq.uri);
    try {
      const arquivoPronto = await baixarArquivoPncpComoBase64(arq);
      if (!arquivoPronto) {
        throw new Error("Não foi possível baixar o arquivo selecionado do PNCP.");
      }

      (window as any).__aipPendingEdital = {
        numeroControlePNCP: item.numeroControlePNCP,
        file: arquivoPronto,
      };

      onSelectForAnalysis(`Edital oficial do PNCP ${item.numeroControlePNCP} — ${item.orgao}`);
    } catch (err: any) {
      alert(err?.message || "Não foi possível preparar a análise deste edital.");
    } finally {
      setPreparandoAnalise(null);
    }
  };

  /**
   * Análise apenas com a FICHA OFICIAL, quando a contratação não tem edital
   * publicado no PNCP.
   *
   * O que havia aqui antes montava um texto com as seções "DAS CONDIÇÕES
   * GERAIS E OBRIGAÇÕES DA CONTRATADA" e "DOCUMENTAÇÃO HABILITATÓRIA EXIGIDA"
   * — seis certidões listadas — e mandava para a IA como se fosse o conteúdo
   * do certame. Nada disso vinha do edital: era texto fixo, igual para toda
   * licitação do país. A IA extraía aquelas exigências como se fossem reais, e
   * o Checklist de Habilitação passava a conferir documentos que o órgão pode
   * nunca ter pedido — com a aparência de quem leu o edital.
   *
   * Agora só entra o que o órgão publicou. O que não veio na API fica de fora,
   * e o cabeçalho avisa a IA de que este é um resumo de ficha, não o edital,
   * para que ela marque como não identificado em vez de completar a lacuna.
   */
  const analisarSomenteFichaOficial = (item: LicitacaoDetailed) => {
    const campos: string[] = [
      "FICHA OFICIAL DE CONTRATAÇÃO — DADOS PUBLICADOS PELO ÓRGÃO NO PNCP",
      "",
      "ATENÇÃO: este é o registro resumido da contratação no PNCP, NÃO é o edital.",
      "O arquivo do edital não está publicado no portal para este certame.",
      "Não infira exigências de habilitação, prazos, obrigações ou condições que",
      "não estejam escritas abaixo — liste-as como não identificadas.",
      "",
    ];

    const adicionar = (rotulo: string, valor?: string | null) => {
      const texto = String(valor ?? "").trim();
      if (texto) campos.push(`${rotulo}: ${texto}`);
    };

    adicionar("NÚMERO DE CONTROLE PNCP", item.numeroControlePNCP);
    adicionar("NÚMERO DO PROCESSO/CERTAME", item.numero);
    adicionar("MODALIDADE", item.modalidade);
    adicionar("SITUAÇÃO DO REGISTRO", item.situacao);
    adicionar("ÓRGÃO COMPRADOR", item.orgao);
    adicionar("CNPJ DO ÓRGÃO", item.cnpjOrgao);
    adicionar("UNIDADE ADMINISTRATIVA", item.unidade);
    adicionar("LOCALIZAÇÃO", [item.municipio, item.uf].filter(Boolean).join(" - "));
    adicionar("OBJETO", item.objeto);
    adicionar("DATA DE PUBLICAÇÃO NO PNCP", item.dataPublicacao);
    adicionar("DATA/HORA DA SESSÃO", item.dataAbertura);
    adicionar("VALOR TOTAL ESTIMADO", item.valorEstimado);
    adicionar("LINK OFICIAL", item.linkPNCP);

    onSelectForAnalysis(campos.join("\n"));
  };

  /**
   * Caminho principal da busca: envia a contratação direto para a Análise de Edital,
   * onde o servidor baixa automaticamente o Edital + Termo de Referência + Itens Oficiais
   * publicados no PNCP sem que o usuário precise baixar e fazer upload manualmente.
   */
  const analisarEditalDaLista = async (item: LicitacaoDetailed) => {
    const chave = `lista:${item.numeroControlePNCP}`;
    setPreparandoAnalise(chave);
    try {
      (window as any).__aipPendingEdital = {
        numeroControlePNCP: item.numeroControlePNCP
      };
      onSelectForAnalysis(
        `Contratação Oficial PNCP ${item.numeroControlePNCP}\nÓrgão: ${item.orgao}\nModalidade: ${item.modalidade} (${item.numero})\nObjeto: ${item.objeto}\nLink Oficial: ${item.linkPNCP || ""}`
      );
    } catch (err: any) {
      alert(err?.message || "Não foi possível preparar a análise deste edital.");
    } finally {
      setPreparandoAnalise(null);
    }
  };

  return (
    <div id="radar-oportunidades-tab" className="space-y-6 animate-fade-in font-sans text-xs">

      {/* Top Banner Header */}
      <Card className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 md:p-6 rounded-xl shadow-xs relative overflow-hidden">

        <div className="flex items-start gap-4">
          <div className="p-3.5 bg-primary/10 text-primary rounded-xl border border-primary/20 shrink-0 shadow-2xs">
            <Search className="w-6 h-6 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground text-base">Radar de Oportunidades PNCP</h3>
              <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold">
                Portal Nacional de Contratações Públicas
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed max-w-3xl">
              Monitore licitações, pregões eletrônicos e dispensas federais, estaduais e municipais em tempo real. Filtre por múltiplos estados, cidades e modalidades.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start lg:self-center bg-muted px-3.5 py-2 rounded-xl border border-border">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
          </span>
          <div className="text-left">
            <p className="text-foreground font-bold text-[10px]">{dataSource}</p>
            {lastUpdated && <p className="text-muted-foreground font-mono text-[9px]">Atualizado às {lastUpdated}</p>}
          </div>
        </div>
      </Card>

      {/* Main Layout: Top Horizontal Filters & Bottom 2 Vertical Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Top Horizontal Filter Controls (Full Width) */}
        <Card className="lg:col-span-12 rounded-xl shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              <h4 className="font-bold text-foreground text-sm">Filtros Avançados PNCP</h4>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="h-auto p-0 text-[10px] text-muted-foreground hover:text-primary hover:bg-transparent flex items-center gap-1 font-medium"
              title="Limpar todos os filtros"
            >
              <RotateCcw className="w-3 h-3" />
              Limpar Filtros
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {/* Keyword Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Palavra-Chave / Produto / Objeto</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Notebook, Medicamento, Reforma, Software..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full pl-9 text-xs font-medium"
                />
              </div>
            </div>

            {/* City / Municipality Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Cidade / Município / Órgão</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Mauá, Salvador, São Paulo, Campinas..."
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetchPNCP(1)}
                  className="w-full pl-9 text-xs font-medium"
                />
              </div>
            </div>

            {/* Multi-State Dropdown */}
            <div className="space-y-1.5 relative">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
                Estados / UFs {selectedUfs.length > 0 ? `(${selectedUfs.length} selecionados)` : "(Brasil Inteiro)"}
              </label>

              {/* Trigger Button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowStatePicker(!showStatePicker);
                  setShowModalidadesPicker(false);
                }}
                className="w-full h-9 px-2.5 text-xs justify-between gap-2 font-normal"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate font-semibold text-foreground">
                    {selectedUfs.length === 0
                      ? "Brasil Inteiro (Todos os 27 Estados)"
                      : selectedUfs.length === 1
                      ? ALL_UFS.find(u => u.sigla === selectedUfs[0]) ? `${ALL_UFS.find(u => u.sigla === selectedUfs[0])?.nome} (${selectedUfs[0]})` : selectedUfs[0]
                      : `${selectedUfs.slice(0, 3).join(", ")}${selectedUfs.length > 3 ? ` (+${selectedUfs.length - 3})` : ""}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedUfs.length > 0 && (
                    <Badge className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                      {selectedUfs.length}
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showStatePicker ? "rotate-180 text-primary" : ""}`} />
                </div>
              </Button>

              {/* Dropdown Menu Popover */}
              {showStatePicker && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                  {/* Search inside dropdown */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Buscar estado (ex: SP, Bahia, Rio)..."
                      value={ufSearchQuery}
                      onChange={(e) => setUfSearchQuery(e.target.value)}
                      className="w-full h-auto bg-muted pl-8 pr-2 py-1.5 text-xs"
                    />
                    {ufSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setUfSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center justify-between border-b border-border pb-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={handleSelectAllUfs}
                      className={`font-bold transition-colors ${selectedUfs.length === 0 ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                    >
                      ✓ Brasil Inteiro
                    </button>
                    {selectedUfs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedUfs([])}
                        className="text-destructive hover:underline font-medium"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>

                  {/* Scrollable UF Options List */}
                  <div className="max-h-52 overflow-y-auto space-y-1 scrollbar-thin pr-1">
                    {filteredUfs.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">Nenhum estado encontrado</div>
                    ) : (
                      filteredUfs.map(uf => {
                        const isSelected = selectedUfs.includes(uf.sigla);
                        return (
                          <button
                            type="button"
                            key={uf.sigla}
                            onClick={() => handleToggleUf(uf.sigla)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-primary/10 text-primary font-bold"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-6 h-5 flex items-center justify-center rounded text-[10px] font-mono font-bold ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                {uf.sigla}
                              </span>
                              <span>{uf.nome}</span>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="pt-1 border-t border-border flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowStatePicker(false)}
                      className="h-auto px-3 py-1 text-[10px] font-bold"
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Modalidade Dropdown */}
            <div className="space-y-1.5 relative">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
                Modalidade PNCP {selectedModalidades.length > 0 ? `(${selectedModalidades.length})` : "(Todas)"}
              </label>

              {/* Trigger Button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowModalidadesPicker(!showModalidadesPicker);
                  setShowStatePicker(false);
                }}
                className="w-full h-9 px-2.5 text-xs justify-between gap-2 font-normal"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate font-semibold text-foreground">
                    {selectedModalidades.length === 0
                      ? "Todas as Modalidades (Pregão, Dispensa...)"
                      : selectedModalidades
                          .map(id => ALL_MODALIDADES.find(m => m.id === id)?.nome)
                          .filter(Boolean)
                          .join(", ")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedModalidades.length > 0 && (
                    <Badge className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                      {selectedModalidades.length}
                    </Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showModalidadesPicker ? "rotate-180 text-primary" : ""}`} />
                </div>
              </Button>

              {/* Dropdown Menu Popover */}
              {showModalidadesPicker && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-2.5 space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                  {/* Actions Header */}
                  <div className="flex items-center justify-between border-b border-border pb-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setSelectedModalidades([])}
                      className={`font-bold transition-colors ${selectedModalidades.length === 0 ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                    >
                      ✓ Todas as Modalidades
                    </button>
                    {selectedModalidades.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedModalidades([])}
                        className="text-destructive hover:underline font-medium"
                      >
                        Limpar
                      </button>
                    )}
                  </div>

                  {/* Options */}
                  <div className="space-y-1">
                    {ALL_MODALIDADES.map(m => {
                      const isSelected = selectedModalidades.includes(m.id);
                      return (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => handleToggleModalidade(m.id)}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary/10 text-primary font-bold"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">Cod {m.id}</span>
                            <span>{m.nome}</span>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-1.5 border-t border-border flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowModalidadesPicker(false)}
                      className="h-auto px-3 py-1 text-[10px] font-bold"
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Status Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Situação / Status no PNCP</label>
              <Select value={statusFiltro} onValueChange={(v) => setStatusFiltro(v as StatusBuscaPncp)}>
                <SelectTrigger className="w-full text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas as Publicadas (Abertas e Encerradas)</SelectItem>
                  <SelectItem value="recebendo_proposta">Recebendo Propostas (Em Aberto)</SelectItem>
                  <SelectItem value="encerradas">Em Julgamento / Encerradas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Period Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Período de Publicação</label>
              <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
                <SelectTrigger className="w-full text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="60">Últimos 60 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias (Padrão)</SelectItem>
                  <SelectItem value="180">Últimos 180 dias</SelectItem>
                  <SelectItem value="365">Último 1 ano (365 dias)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Value Range Filters */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Faixa de Valor Estimado (R$)</label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Mínimo R$"
                  value={valorMin}
                  onChange={(e) => setValorMin(e.target.value)}
                  className="w-full text-xs"
                />
                <Input
                  type="number"
                  placeholder="Máximo R$"
                  value={valorMax}
                  onChange={(e) => setValorMax(e.target.value)}
                  className="w-full text-xs"
                />
              </div>
            </div>

            {/* Search Action Button */}
            <Button
              type="button"
              onClick={() => handleFetchPNCP(1)}
              disabled={loading}
              className="w-full h-9 font-bold text-xs gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Buscando no Portal PNCP...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Buscar Licitações no PNCP
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Bottom Section: Full-Width Results List */}
        <div className="lg:col-span-12">

          {/* List Card (Full Width) */}
          <Card className="rounded-xl shadow-xs p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3.5">

              {/* Header Info */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <span className="font-bold text-foreground text-xs uppercase tracking-wider block">
                    Licitações ({totalRecords})
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {selectedUfs.length > 0 ? `UFs: ${selectedUfs.join(", ")}` : "Todos os Estados"} • Clique em &ldquo;Ver detalhes&rdquo; ou em qualquer card para abrir a ficha completa
                  </span>
                </div>

                {/* Page Size Selector */}
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger size="sm" className="text-[10px] font-mono h-auto px-2 py-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 por pág.</SelectItem>
                    <SelectItem value="15">15 por pág.</SelectItem>
                    <SelectItem value="25">25 por pág.</SelectItem>
                    <SelectItem value="50">50 por pág.</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!loading && error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 mb-3">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-relaxed text-foreground">{error}</p>
                </div>
              )}

              {!loading && !error && (resultadoParcial || avisosPNCP.length > 0) && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 mb-3">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div className="text-[10px] leading-relaxed text-foreground space-y-1">
                    <p className="font-bold">Esta busca não cobriu o PNCP inteiro.</p>
                    {resultadoParcial && (
                      <p>
                        A varredura atingiu o limite de tempo antes de terminar. Estreite o período, os estados ou as
                        modalidades para que o resultado fique completo.
                      </p>
                    )}
                    {avisosPNCP.map((aviso, i) => (
                      <p key={i} className="text-muted-foreground">{aviso}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Items List Container */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                  <p className="font-semibold text-xs">Consultando base oficial do PNCP...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2 text-center">
                  <AlertCircle className="w-9 h-9 text-warning" />
                  <div>
                    <p className="font-bold text-foreground text-xs">Nenhum certame localizado com estes filtros</p>
                    <p className="text-[10px] text-muted-foreground max-w-[200px] mt-1">Experimente limpar as palavras-chave ou selecionar mais estados.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 max-h-[650px] overflow-y-auto pr-1 scrollbar-thin">
                  {results.map((item) => {
                    const isActive = activeItem?.id === item.id;
                    const capagEnte = resolverCapagPorOrgaoOuLocal({
                      uf: item.uf,
                      municipio: item.municipio,
                      orgao: item.orgao,
                    });
                    const capagEstilo = obterEstiloNotaCapag(capagEnte.notaCapag);
                    return (
                      <Card
                        key={item.id}
                        onClick={() => setActiveItem(item)}
                        className={`p-3.5 rounded-xl transition-all cursor-pointer text-left flex flex-col justify-between space-y-2.5 gap-2 shadow-none ${
                          isActive
                            ? "bg-primary/10 border-primary text-foreground shadow-xs"
                            : "text-foreground hover:border-primary/40 hover:bg-muted/50"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <Badge variant="outline" className="font-bold text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20 rounded font-mono truncate max-w-[165px]">
                              {item.numero}
                            </Badge>
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                title={`${capagEnte.nome} — ${capagEnte.veredito.statusPagador} (${capagEnte.veredito.prazoMedioRecebimento})`}
                                className={`text-[9px] font-mono font-extrabold px-1.5 py-0.5 rounded border ${capagEstilo.badgeBg} ${capagEstilo.badgeText} ${capagEstilo.badgeBorder}`}
                              >
                                {capagEstilo.labelCurto}
                              </span>
                              <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-1 font-bold shrink-0 bg-muted px-1.5 py-0.5 rounded border border-border">
                                <MapPin className="w-3 h-3 text-primary" />
                                {item.municipio} - {item.uf}
                              </span>
                            </div>
                          </div>

                          <p className="font-bold text-foreground text-[11px] truncate" title={item.orgao}>{item.orgao}</p>

                          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                            {item.objeto}
                          </p>
                        </div>

                        <div className="space-y-2 pt-1.5 border-t border-border">
                          <div className="flex items-center justify-between gap-2 bg-success/10 border border-success/25 rounded-lg px-2.5 py-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              {item.precoCarregando ? (
                                <RefreshCw className="w-3 h-3 text-primary animate-spin shrink-0" />
                              ) : (
                                <Coins className="w-3 h-3 text-success shrink-0" />
                              )}
                              Preço da Disputa:
                            </span>
                            <span
                              className={`font-extrabold font-mono text-[11px] ${
                                item.precoCarregando ? "text-primary animate-pulse" : "text-success"
                              }`}
                            >
                              {item.valorEstimado}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] font-mono px-0.5">
                            <span className="text-muted-foreground">{item.modalidade}</span>
                            {item.valorHomologado && item.valorEstimadoRaw !== item.valorHomologadoRaw && (
                              <span className="text-primary font-semibold">Homologado: {item.valorHomologado}</span>
                            )}
                          </div>

                          {/* Action Buttons: Ver detalhes (abre popup) + Analisar com IA */}
                          <div className="grid grid-cols-2 gap-2 pt-0.5">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveItem(item);
                              }}
                              className="w-full h-auto py-1.5 text-[10px] font-bold gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                            >
                              <Eye className="w-3 h-3" />
                              Ver detalhes
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={preparandoAnalise !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                analisarEditalDaLista(item);
                              }}
                              className="w-full h-auto py-1.5 text-[10px] font-bold gap-1.5"
                            >
                              <Sparkles className="w-3 h-3 text-primary" />
                              {preparandoAnalise === `lista:${item.numeroControlePNCP}`
                                ? "Baixando..."
                                : "Analisar com IA"}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination Bar */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    const next = Math.max(1, page - 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="h-auto px-2.5 py-1.5 text-[10px] gap-1"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Anterior
                </Button>

                <span className="text-[10px] text-muted-foreground font-mono">
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    const next = Math.min(totalPages, page + 1);
                    setPage(next);
                    handleFetchPNCP(next);
                  }}
                  className="h-auto px-2.5 py-1.5 text-[10px] gap-1"
                >
                  Próxima
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            )}
          </Card>

        </div>

      </div>

      {/* Popup Modal: Ficha Oficial do Edital (abre somente quando o usuário clica em uma licitação ou em "Ver detalhes") */}
      {activeItem && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/65 backdrop-blur-xs overflow-y-auto animate-fade-in"
          onClick={() => setActiveItem(null)}
        >
          <Card
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden my-auto"
          >
            {/* Popup Header */}
            <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-border bg-muted/60 shrink-0">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-primary uppercase font-mono font-bold tracking-wider">
                    Ficha Oficial do Edital
                  </span>
                  <Badge variant="secondary" className="text-[9px] px-2 py-0.5 rounded font-mono">
                    {activeItem.situacao}
                  </Badge>
                </div>
                <h4 className="font-bold text-foreground text-sm sm:text-base truncate">{activeItem.numero}</h4>
                <p className="text-muted-foreground text-[11px] font-mono">{activeItem.modalidade}</p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveItem(null)}
                className="h-8 w-8 p-0 rounded-lg shrink-0"
                title="Fechar detalhes"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Popup Scrollable Content */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
              {/* Fields */}
              <div className="space-y-3 text-foreground text-[11px] leading-relaxed">
                <div className="space-y-1">
                  <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Órgão Comprador</span>
                  <p className="text-foreground font-semibold flex items-center gap-1.5 text-xs">
                    <Landmark className="w-4 h-4 text-primary shrink-0" />
                    {activeItem.orgao}
                  </p>
                  {activeItem.cnpjOrgao && (
                    <p className="text-[10px] text-muted-foreground font-mono">CNPJ: {activeItem.cnpjOrgao}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="bg-muted p-2.5 rounded-lg border border-border">
                    <span className="font-bold text-muted-foreground uppercase text-[8px] block tracking-wider">UASG / Unidade</span>
                    <p className="text-foreground font-extrabold text-[11px] truncate" title={activeItem.uasg || activeItem.unidade}>
                      {activeItem.uasg || activeItem.unidade}
                    </p>
                  </div>

                  <div className="bg-muted p-2.5 rounded-lg border border-border">
                    <span className="font-bold text-muted-foreground uppercase text-[8px] block tracking-wider">ID Contratação PNCP</span>
                    <p className="text-primary font-mono font-bold text-[11px] truncate" title={activeItem.numeroControlePNCP}>
                      {activeItem.numeroControlePNCP}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Localização</span>
                  <p className="text-foreground font-medium flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    {activeItem.municipio} - {activeItem.uf} ({activeItem.unidade})
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="font-bold text-muted-foreground uppercase text-[9px] block tracking-wider">Objeto / Termo de Referência</span>
                  <div className="bg-muted p-3 rounded-xl text-foreground border border-border text-xs leading-relaxed max-h-40 overflow-y-auto font-sans scrollbar-thin">
                    {activeItem.objeto}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="bg-success/10 p-3 rounded-xl border border-success/30 space-y-0.5">
                    <span className="text-[8px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                      <Coins className="w-3 h-3 text-success" />
                      Preço Estimado da Disputa
                    </span>
                    <p className="text-success font-extrabold font-mono text-sm">{activeItem.valorEstimado}</p>
                    {activeItem.valorHomologado && (
                      <p className="text-[9px] font-mono text-primary font-semibold">
                        Homologado: {activeItem.valorHomologado}
                      </p>
                    )}
                  </div>
                  <div className="bg-muted p-3 rounded-xl border border-border space-y-0.5">
                    <span className="text-[8px] text-muted-foreground uppercase font-bold block">Abertura de Propostas</span>
                    <p className="text-warning font-bold font-mono text-xs">{activeItem.dataAbertura}</p>
                    <p className="text-[9px] text-muted-foreground font-mono">Publicado: {activeItem.dataPublicacao}</p>
                  </div>
                </div>

                {/* Diagnóstico CAPAG & Capacidade de Pagamento do Órgão Comprador */}
                {(() => {
                  const capagEnte = resolverCapagPorOrgaoOuLocal({
                    uf: activeItem.uf,
                    municipio: activeItem.municipio,
                    orgao: activeItem.orgao,
                  });
                  const capagEstilo = obterEstiloNotaCapag(capagEnte.notaCapag);
                  return (
                    <div className={`p-3.5 rounded-xl border ${capagEstilo.badgeBg} ${capagEstilo.badgeBorder} space-y-2.5`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className={`w-4 h-4 shrink-0 ${capagEstilo.badgeText}`} />
                          <div>
                            <span className="text-[8px] font-mono uppercase tracking-wider font-bold text-muted-foreground block">
                              Saúde Fiscal &amp; Capacidade de Pagamento (CAPAG / Tesouro Nacional)
                            </span>
                            <p className={`text-xs font-extrabold ${capagEstilo.badgeText}`}>
                              Nota CAPAG {capagEnte.notaCapag} — {capagEnte.veredito.statusPagador} ({capagEnte.nome})
                            </p>
                          </div>
                        </div>

                        {onNavigateToCapag && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const itemRef = activeItem;
                              setActiveItem(null);
                              onNavigateToCapag({
                                uf: itemRef.uf,
                                municipio: itemRef.municipio,
                                orgao: itemRef.orgao,
                              });
                            }}
                            className="h-7 px-2.5 text-[10px] font-bold gap-1 bg-card"
                          >
                            <ExternalLink className="w-3 h-3 text-primary" />
                            Ver no Consulta CAPAG
                          </Button>
                        )}
                      </div>

                      <p className="text-[10px] text-foreground leading-relaxed">
                        {capagEnte.veredito.resumoDividaCaixa}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
                        <div className="bg-card/85 p-2 rounded-lg border border-border">
                          <span className="text-[8px] font-mono uppercase text-muted-foreground block">
                            Indicadores STN (I / II / III)
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            Endiv. {capagEnte.indicadores.endividamento.valorPercentual}% ({capagEnte.indicadores.endividamento.nota}) • Liq.{" "}
                            {capagEnte.indicadores.liquidez.valorPercentual}% ({capagEnte.indicadores.liquidez.nota})
                          </span>
                        </div>
                        <div className="bg-card/85 p-2 rounded-lg border border-border">
                          <span className="text-[8px] font-mono uppercase text-muted-foreground block">
                            Prazo Médio de Pagamento
                          </span>
                          <span className="font-bold text-foreground">
                            {capagEnte.veredito.prazoMedioRecebimento}
                          </span>
                        </div>
                        <div className="bg-card/85 p-2 rounded-lg border border-border">
                          <span className="text-[8px] font-mono uppercase text-muted-foreground block">
                            Margem Recomendada
                          </span>
                          <span className="font-bold text-primary">
                            {capagEnte.veredito.margemFinanceiraRecomendada}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Preços por Item da Disputa */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-muted-foreground uppercase text-[9px] tracking-wider flex items-center gap-1">
                      <Coins className="w-3 h-3 text-primary" />
                      Preços dos Itens da Disputa
                    </span>
                    {itensDisputa.length > 0 && (
                      <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0">
                        {itensDisputa.length} {itensDisputa.length === 1 ? "item" : "itens"}
                      </Badge>
                    )}
                  </div>
                  {itensLoading ? (
                    <p className="text-[10px] text-muted-foreground py-1.5">Consultando preços dos itens no PNCP...</p>
                  ) : itensDisputa.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground py-1">
                      Itens e preços unitários detalhados diretamente no PDF do edital.
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
                      {itensDisputa.map((it) => (
                        <div
                          key={it.numeroItem}
                          className="p-2.5 rounded-lg border border-border bg-muted/60 text-[10px] space-y-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-foreground">
                              Item {String(it.numeroItem).padStart(2, "0")}:{" "}
                              <span className="font-normal text-foreground/90">{it.descricao}</span>
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] pt-1 border-t border-border/60">
                            <span className="text-muted-foreground">
                              Qtd: <strong className="text-foreground">{it.quantidade}</strong> {it.unidadeMedida}
                            </span>
                            <span className="text-muted-foreground">
                              Unit.:{" "}
                              <strong className="text-foreground">
                                {it.valorUnitarioEstimado > 0
                                  ? `R$ ${it.valorUnitarioEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "Sigiloso"}
                              </strong>
                            </span>
                            <span className="text-success font-bold">
                              Total:{" "}
                              {it.valorTotal > 0
                                ? `R$ ${it.valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "Sob consulta"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Official Portal Link */}
                {activeItem.linkPNCP && (
                  <div className="pt-1">
                    <Button
                      asChild
                      variant="secondary"
                      className="w-full h-auto py-2 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-xs font-bold gap-2 shadow-2xs"
                    >
                      <a
                        href={activeItem.linkPNCP}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Ver Edital Completo no Portal PNCP Oficial</span>
                      </a>
                    </Button>
                  </div>
                )}
              </div>

              {/* Documentos oficiais da contratação */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-foreground text-[11px] uppercase tracking-wide">Documentos do Edital</h5>
                  {arquivos.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0.5 rounded-full">
                      {arquivos.length} arquivo{arquivos.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>

                {arquivosLoading && (
                  <p className="text-muted-foreground text-[10px] py-2">Buscando os arquivos oficiais no PNCP...</p>
                )}

                {!arquivosLoading && arquivosError && (
                  <p className="text-destructive text-[10px] py-2">{arquivosError}</p>
                )}

                {!arquivosLoading && !arquivosError && arquivos.length === 0 && (
                  <p className="text-muted-foreground text-[10px] py-2">
                    Esta contratação não tem arquivos publicados no PNCP.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {arquivos.map(arq => (
                    <div
                      key={arq.sequencialDocumento}
                      className="p-2.5 rounded-xl border border-border bg-muted/40 space-y-2 flex flex-col justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-[11px] truncate" title={arq.titulo}>{arq.titulo}</p>
                        <p className="text-muted-foreground text-[10px]">{arq.tipo}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => baixarArquivo(arq)}
                          className="flex-1 h-auto py-1.5 text-[10px] gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar
                        </Button>
                        <Button
                          type="button"
                          onClick={() => analisarArquivoComIA(activeItem, arq)}
                          disabled={preparandoAnalise === arq.uri}
                          className="flex-1 h-auto py-1.5 text-[10px] gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {preparandoAnalise === arq.uri ? "Preparando..." : "Analisar com IA"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Popup Footer: Análise Completa Automática + Fechar */}
            <div className="p-4 sm:p-5 border-t border-border bg-muted/60 space-y-2.5 shrink-0">
              <div className="p-2.5 bg-primary/10 rounded-xl border border-primary/20 text-foreground text-[10px] leading-normal flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>
                  Ao clicar abaixo, o servidor baixa e lê automaticamente o <strong>Edital + Termo de Referência + Itens Oficiais</strong> direto do PNCP, sem precisar baixar e enviar arquivos manualmente.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveItem(null)}
                  className="sm:w-32 h-auto py-2.5 font-bold text-xs"
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  onClick={() => analisarEditalDaLista(activeItem)}
                  disabled={preparandoAnalise !== null}
                  className="flex-1 h-auto py-2.5 font-bold text-xs gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Analisar Edital + TR + Itens com IA (Automático)
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}
