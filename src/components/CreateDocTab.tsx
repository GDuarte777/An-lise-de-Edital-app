import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileEdit,
  Sparkles,
  Download,
  FileText,
  FileCode,
  CheckSquare,
  Building2,
  Save,
  Printer,
  Copy,
  Check,
  Search,
  ChevronRight,
  Send,
  Wand2,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Table,
  Eye,
  Edit3,
  Layers,
  FileCheck,
  ShieldAlert,
  HelpCircle,
  HardDriveDownload,
  Bot,
  Info,
  Loader2,
  Zap,
  X,
  Strikethrough,
  Maximize2,
  Minimize2,
  Undo,
  Redo,
  ChevronDown,
  Trash2,
  Sparkle,
  PenTool
} from "lucide-react";
import { CompanyData, EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
import confetti from "canvas-confetti";

interface CreateDocTabProps {
  companyData: CompanyData;
  activeEdital: EditalAnalysis | null;
  onOpenDocPreview?: (title: string, markdownText: string, type: "proposal" | "declaration") => void;
  initialTemplateId?: string;
}

export interface DocumentTemplate {
  id: string;
  title: string;
  category: "propostas" | "declaracoes" | "recursos" | "atestados" | "outros";
  description: string;
  badgeText: string;
  defaultMarkdown: string;
}

const TEMPLATES_CATALOG: DocumentTemplate[] = [
  {
    id: "proposta_comercial",
    title: "Proposta Comercial de Preços (Modelo Oficial)",
    category: "propostas",
    description: "Proposta comercial completa com seções destacadas, tabela de quantitativos e preços, condições gerais e área de assinatura.",
    badgeText: "Lei 14.133/2021",
    defaultMarkdown: `# PROPOSTA COMERCIAL

Aviso de Contratação Direta nº {NumeroPregao} — Processo Dispensa Eletrônica nº {NumeroPregao}

Ao Setor de Dispensa / Comissão de Licitação da **{OrgaoComprador}**

A empresa proponente abaixo identificada apresenta sua proposta comercial escrita e formal para o fornecimento de subscrição de licença de uso de software / serviços e materiais destinados ao preenchimento integral das metas e necessidades do órgão, declarando aceitar irrestritamente todas as diretrizes regulamentares da presente Chamada Pública/Licitação.

### 1. IDENTIFICAÇÃO DO CONCORRENTE

| Campo | Informação Oficial do Licitante |
| :--- | :--- |
| **Razão Social:** | {RazaoSocial} |
| **CNPJ:** | {CNPJ} |
| **Endereço Comercial:** | {Endereco} |
| **Telefone / WhatsApp:** | {Telefone} |
| **E-mail Comercial:** | {Email} |
| **Responsável Legal:** | {RepresentanteLegal} (CPF: {CPF}) |
| **Dados Bancários:** | Banco: {Banco} \| Agência: {Agencia} \| Conta: {Conta} |

### 2. PLANILHA DE QUANTITATIVOS, ESPECIFICAÇÕES E PREÇOS

| Item | Descrição Detalhada do Produto Conforme o Edital e Marca Ofertada | Qtd. | Marca / Modelo | Valor Unit. | Valor Total |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **01** | **{Objeto}**<br>Fornecimento e prestação em estrita conformidade com as condições, exigências e especificações estabelecidas no Termo de Referência do Edital. | 02 | Marca Oficial / Padrão | R$ 390,00 | R$ 780,00 |

**VALOR TOTAL GLOBAL DA PROPOSTA:** **R$ 780,00**

**VALOR TOTAL POR EXTENSO:** Setecentos e oitenta reais.

### 3. CONDIÇÕES COMERCIAIS OBRIGATÓRIAS

| Condição | Especificação Pactuada |
| :--- | :--- |
| **Prazo de Validade:** | 90 (noventa) dias, a contar da data de apresentação deste documento. |
| **Condições de Pagamento:** | Em até 10 (dez) dias úteis, contados da finalização da regular liquidação da despesa pelo órgão contratante. |
| **Prazo de Entrega:** | Em até (cinco) dias corridos, contados a partir do recebimento da correspondente Nota de Empenho ({PrazoEntrega}). |
| **Local de Entrega:** | De forma digital / presencial no endereço e e-mail institucional do órgão, sem custos logísticos adicionais. |

### 4. DECLARAÇÕES LEGAIS OBRIGATÓRIAS

- Declaramos que a presente proposta está em conformidade com todos os preceitos legais e regulamentares em vigor.
- Declaramos que a validade desta proposta é de 90 (noventa) dias, a contar da data de sua entrega.
- Declaramos expressamente que, nos preços acima ofertados, estão inclusos todos os custos indiretos tais como: impostos, taxas, fretes, seguros, embalagens, montagem e entrega do material, bem como quaisquer outras despesas diretas e indiretas.
- Declaramos que concordamos com as cláusulas dispostas no Edital, Termo de Referência e demais anexos, referentes à presente aquisição.
- Declaramos que a empresa não está sob pena de interdição de direitos previstos na Lei N 9.605 de 12.02.98 (Lei de crimes ambientais).
- Declaramos que o prazo de entrega do material cotado acima é de 5 (cinco) dias corridos contados a partir do primeiro dia útil subsequente ao recebimento da respectiva Nota de Empenho.

{Local}, {DataAtual}.

___________________________________________________
**{RazaoSocial}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}
`
  },
  {
    id: "declaracao_unificada",
    title: "Declaração Unificada (Anexo IV / Habilitação)",
    category: "declaracoes",
    description: "Declaração unificada padrão RFB e Lei 14.133/2021 abrangendo requisitos de habilitação, idoneidade, não-emprego de menor e obrigações acessórias.",
    badgeText: "Exigência Obrigatória",
    defaultMarkdown: `# ANEXO IV
# DECLARAÇÃO A SER APRESENTADA PELA PESSOA JURÍDICA
(Redação dada pela Instrução Normativa RFB nº 1.244 de 30 de janeiro de 2012) (Vide art. 3º da IN RFB nº 1.244/2012)

**Ilmo. Sr. Pregoeiro(a) / Comissão de Licitação**  
**BASE DE ADMINISTRAÇÃO E APOIO / ÓRGÃO:** {OrgaoComprador}  
**LICITAÇÃO / PREGÃO ELETRÔNICO Nº:** {NumeroPregao}  

**{RazaoSocial}**, com sede à {Endereco}, inscrita no CNPJ sob o nº **{CNPJ}**, declara a **{OrgaoComprador}**, para fins de não incidência na fonte do IRPJ, da Contribuição Social sobre o Lucro Líquido (CSLL), da Contribuição para o Financiamento da Seguridade Social (COFINS), da contribuição para o PIS/PASEP, a que se refere o art. 64 da Lei nº 9.430, de 27 de dezembro de 1996, que é regularmente inscrita no Regime Especial Unificado de Arrecadação de Tributos e Contribuições devidos pela Microempresas e Empresas de Pequeno Porte – Simples Nacional, de que se trata o art.12 da Lei Complementar nº 123, de 14 de dezembro de 2006.

Para esse efeito, a declarante informa que:

### 1. REQUISITOS E OBRIGAÇÕES ACESSÓRIAS
a) **Conserva em boa ordem**, pelo prazo de 5 (cinco) anos, contado da data de emissão, os documentos que comprovam a origem de suas receitas e a efetivação de suas despesas, bem como a realização de quaisquer outros atos ou operações que venham a modificar a sua situação patrimonial; e
b) **Cumpre as obrigações acessórias** a que está sujeita, em conformidade a legislação pertinente;
c) O signatário é representante legal desta empresa, assumindo o compromisso de informar à Secretaria da Receita Federal do Brasil e à pessoa jurídica pagadora, imediatamente, eventual desenquadramento da presente situação e esta ciente de que a falsidade na prestação destas informações, sem prejuízo do disposto no art. 32 da Lei nº 9.430, de 1996, o sujeitará, com as demais pessoas que para ela concorrem, às penalidades previstas na legislação criminal e tributária, relativas à falsidade ideológica (art. 299 do Decreto-Lei nº 8.137, de 27 de dezembro de 1990).

{Local}, {DataAtual}.

___________________________________________________
**{RazaoSocial}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}
`
  },
  {
    id: "atested_capacidade",
    title: "Atestado de Capacidade Técnica (Modelo Oficial)",
    category: "atestados",
    description: "Modelo oficial de atestado de capacidade técnica emitido por órgão público ou empresa contratante comprovando fornecimento e execução regular.",
    badgeText: "Comprovação Técnica",
    defaultMarkdown: `# ATESTADO DE CAPACIDADE TÉCNICA

Atestamos para os devidos fins de direito, sob as penas da Lei, que a empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, estabelecida na {Endereco}, prestou a esta Organização serviços de tecnologia da informação e fornecimento / locação temporária de licenças de software, cumprindo fielmente com todas as obrigações pactuadas.

Os serviços foram executados e entregues dentro do prazo estabelecido, de forma regular e satisfatória, em conformidade com as especificações exigidas e com o padrão de qualidade técnica demandado por este órgão público, conforme detalhado a seguir:

### 1. RESUMO DO CONTRATO E FORNECIMENTO

| Campo | Detalhamento Oficial do Contrato |
| :--- | :--- |
| **CONTRATANTE:** | {OrgaoComprador} |
| **CONTRATADO:** | {RazaoSocial} (CNPJ: {CNPJ}) |
| **OBJETO DO SERVIÇO:** | **{Objeto}** |
| **FUNDAMENTO LEGAL:** | Dispensa de Licitação - Lei Federal nº 14.133/2021 |
| **NOTA DE EMPENHO:** | Nota de Empenho nº 17301.0001.26.0000344-9 |

Por ser a expressão da verdade e em virtude do fiel cumprimento do contrato, expedimos o presente atestado de capacidade técnica para que produza os seus devidos efeitos legais junto a processos licitatórios futuros.

{Local}, {DataAtual}.

___________________________________________________
**Fiscal Administrativo / Responsável Técnico**
{OrgaoComprador}
`
  },
  {
    id: "impugnacao_edital",
    title: "Petição de Impugnação ao Edital de Licitação",
    category: "recursos",
    description: "Peça jurídica formal para contestar cláusulas ilegais, restritivas ou abusivas do instrumento convocatório.",
    badgeText: "Peça Jurídica",
    defaultMarkdown: `# PETIÇÃO DE IMPUGNAÇÃO AO EDITAL DE LICITAÇÃO

**ILUSTRÍSSIMO(A) SENHOR(A) PREGOEIRO(A) E AUTORIDADE COMPETENTE**  
**ÓRGÃO:** {OrgaoComprador}  
**PREGÃO ELETRÔNICO Nº:** {NumeroPregao}  

**{RazaoSocial}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **{CNPJ}**, com sede à **{Endereco}**, vem, tempestivamente, com fulcro na Lei nº 14.133/2021, apresentar **IMPUGNAÇÃO AO EDITAL**, pelos fatos e fundamentos jurídicos a seguir expostos:

### 1. DOS FATOS E DA TEMPESTIVIDADE
O Edital do Pregão Eletrônico nº {NumeroPregao} tem por objeto {Objeto}. Ocorre que, ao analisar as cláusulas do edital, verifica-se a exigência de requisitos restritivos e desproporcionais que afrontam a competitividade do certame.

A presente impugnação é plenamente tempestiva, protocolada dentro do prazo legal de 3 (três) dias úteis antes da data fixada para abertura do certame.

### 2. DOS FUNDAMENTOS JURÍDICOS
A exigência contida na cláusula impugnada viola frontalmente os princípios da **competitividade, razoabilidade e proporcionalidade**, expressamente garantidos pelo art. 5º da Lei nº 14.133/2021.

A jurisprudência consolidada do Tribunal de Contas da União (TCU) proíbe cláusulas que limitem injustificadamente o universo de competidores, conforme Súmula TCU nº 272.

### 3. DOS PEDIDOS
Diante do exposto, requer a V. Sa.:
1. O **recebimento e acolhimento** da presente Impugnação com Efeito Suspensivo;
2. A **retificação do Edital** para excluir/adequar a cláusula impugnada;
3. A **republicação do instrumento convocatório** com a reabertura do prazo de apresentação de propostas.

{Local}, {DataAtual}.

___________________________________________________
**{RazaoSocial}**
{RepresentanteLegal} - Representante Legal / Advogado
`
  },
  {
    id: "declaracao_me_epp",
    title: "Declaração de Enquadramento ME / EPP (LC 123/2006)",
    category: "declaracoes",
    description: "Declaração sob penas da lei assegurando o direito ao tratamento diferenciado e favorecido da Lei Complementar nº 123/2006.",
    badgeText: "Tratamento Favorecido",
    defaultMarkdown: `# DECLARAÇÃO DE ENQUADRAMENTO COMO ME OU EPP
(Lei Complementar nº 123/2006 e Lei nº 14.133/2021)

**AO(À) PREGOEIRO(A) / COMISSÃO DE LICITAÇÃO**  
**ÓRGÃO:** {OrgaoComprador}  
**LICITAÇÃO / PREGÃO ELETRÔNICO Nº:** {NumeroPregao}  

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, por seu representante legal infra-assinado, **DECLARA**, sob as penas da lei (art. 299 do Código Penal), que se enquadra na condição de **Microempresa (ME) / Empresa de Pequeno Porte (EPP)**, nos termos do art. 3º da Lei Complementar nº 123/2006.

Declaramos ainda que a receita bruta anual da empresa não ultrapassa os limites legais estabelecidos e que a empresa não se encontra em nenhuma das situações de vedação previstas no § 4º do artigo 3º da referida Lei Complementar.

{Local}, {DataAtual}.

___________________________________________________
**{RazaoSocial}**
{RepresentanteLegal} - Representante Legal
`
  },
  {
    id: "recurso_administrativo",
    title: "Recurso Administrativo Licitatório (Lei 14.133/2021)",
    category: "recursos",
    description: "Minuta jurídica para recorrer de decisão desfavorável do pregoeiro durante a sessão do pregão eletrônico.",
    badgeText: "Recurso Formal",
    defaultMarkdown: `# RECURSO ADMINISTRATIVO LICITATÓRIO

**À AUTORIDADE COMPETENTE E AO(À) PREGOEIRO(A)**  
**ÓRGÃO:** {OrgaoComprador}  
**PREGÃO ELETRÔNICO Nº:** {NumeroPregao}  

**{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, inconformada com a r. decisão que a inabilitou/desclassificou na sessão do Pregão em epígrafe, vem interpor o presente **RECURSO ADMINISTRATIVO**, com fulcro no art. 165 da Lei nº 14.133/2021.

### 1. RAZÕES DO RECURSO
A decisão recorrida equivocou-se ao considerar desatendida a exigência do Edital. Conforme se comprova pela documentação acostada, a recorrente apresentou integralmente a comprovação solicitada, tratando-se de mero apego ao formalismo excessivo vedado no ordenamento licitatório.

### 2. DO PEDIDO
Requer o conhecimento do presente recurso e, no mérito, o seu **PROVIMENTO** para reformar a r. decisão, declarando a recorrente habilitada e classificada.

{Local}, {DataAtual}.

___________________________________________________
**{RazaoSocial}**
{RepresentanteLegal} - Representante Legal
`
  }
];

export default function CreateDocTab({
  companyData,
  activeEdital,
  onOpenDocPreview,
  initialTemplateId
}: CreateDocTabProps) {
  // Category filter
  const [activeCategory, setActiveCategory] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Selected template
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate>(
    () => TEMPLATES_CATALOG.find(t => t.id === initialTemplateId) || TEMPLATES_CATALOG[0]
  );

  // Document title and markdown content
  const [docTitle, setDocTitle] = useState<string>(selectedTemplate.title);
  const [documentContent, setDocumentContent] = useState<string>(selectedTemplate.defaultMarkdown);

  // AI Fill Options
  const [useCompanyContext, setUseCompanyContext] = useState<boolean>(true);
  const [useEditalContext, setUseEditalContext] = useState<boolean>(true);
  const [customInstructions, setCustomInstructions] = useState<string>("");
  const [uploadedAttachmentText, setUploadedAttachmentText] = useState<string>("");
  const [showAttachmentBox, setShowAttachmentBox] = useState<boolean>(false);

  // AI Assist / Inline Copilot
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [aiAssistPrompt, setAiAssistPrompt] = useState<string>("");
  const [showAiAssist, setShowAiAssist] = useState<boolean>(false);

  // Fullscreen Editing Mode (Google Docs Full View)
  const [isFullscreenDocs, setIsFullscreenDocs] = useState<boolean>(false);

  // Download Dropdown Menu open state
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);

  // Drafts history
  const [draftsList, setDraftsList] = useState<Array<{ id: string; title: string; date: string; content: string }>>([]);
  const [showDraftsModal, setShowDraftsModal] = useState<boolean>(false);

  // Notification States
  const [copied, setCopied] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Ref for the editable A4 paper sheet div
  const paperEditableRef = useRef<HTMLDivElement>(null);

  // Render Formatted A4 Document View matching Model PDFs
  const renderFormattedA4Document = (content: string, isEditable: boolean = true) => {
    return (
      <div
        ref={paperEditableRef}
        contentEditable={isEditable}
        suppressContentEditableWarning={true}
        onBlur={() => {
          if (paperEditableRef.current) {
            const newText = paperEditableRef.current.innerText;
            if (newText && newText.trim() !== documentContent.trim()) {
              setDocumentContent(newText);
            }
          }
        }}
        className={`official-a4-paper prose prose-slate max-w-none text-xs text-slate-900 leading-relaxed space-y-3 font-sans selection:bg-indigo-100 selection:text-indigo-900 outline-none ${
          isEditable ? "focus:ring-2 focus:ring-indigo-500/40 rounded p-1 transition-all" : ""
        }`}
        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <div className="bg-slate-100 border border-slate-300 rounded-lg p-3.5 my-4 text-center shadow-2xs">
                <h1 className="text-sm md:text-base font-black text-slate-900 tracking-wider uppercase m-0 leading-tight">
                  {children}
                </h1>
              </div>
            ),
            h2: ({ children }) => (
              <h2 className="text-xs md:text-sm font-bold text-slate-900 text-center uppercase tracking-wide my-3 pb-1 border-b border-slate-200">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <div className="bg-sky-100 text-sky-950 border-l-4 border-sky-600 px-3.5 py-2 my-4 font-bold text-xs uppercase tracking-wide rounded-r-md shadow-2xs flex items-center justify-between">
                <span>{children}</span>
              </div>
            ),
            p: ({ children }) => {
              const strChildren = String(children);
              if (
                strChildren.includes("________________________________") ||
                strChildren.includes("Representante Legal")
              ) {
                return (
                  <div className="my-8 pt-4 text-center space-y-1 font-sans select-none">
                    <div className="w-80 mx-auto border-t-2 border-slate-700 pt-2"></div>
                    <div className="font-extrabold text-slate-950 text-xs uppercase tracking-wider">
                      {companyData.razonSocial || "SUA EMPRESA LTDA"}
                    </div>
                    <div className="text-slate-700 text-[11px] font-semibold">
                      {companyData.representativeName || "Representante Legal / Titular"}
                    </div>
                    <div className="text-slate-500 text-[10px] font-mono">
                      CPF: {companyData.representativeCpf || "000.000.000-00"} | CNPJ: {companyData.cnpj || "00.000.000/0001-00"}
                    </div>
                  </div>
                );
              }
              return (
                <p className="text-slate-900 text-xs leading-relaxed my-2.5 text-justify font-sans">
                  {children}
                </p>
              );
            },
            table: ({ children }) => (
              <div className="overflow-x-auto my-4 rounded-md border border-slate-300 shadow-2xs">
                <table className="w-full border-collapse text-xs text-slate-900 bg-white">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-slate-100 text-slate-900 font-bold border-b border-slate-300 text-[11px] uppercase tracking-wider">
                {children}
              </thead>
            ),
            th: ({ children }) => (
              <th className="p-2.5 border border-slate-300 text-left font-bold bg-slate-100 text-slate-950">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="p-2.5 border border-slate-200 text-slate-800 text-xs align-top leading-relaxed bg-white">
                {children}
              </td>
            ),
            ul: ({ children }) => (
              <ul className="list-disc pl-6 space-y-1.5 my-3 text-xs text-slate-900">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-6 space-y-1.5 my-3 text-xs text-slate-900">
                {children}
              </ol>
            ),
            hr: () => <hr className="border-0 border-t border-slate-300 my-5" />,
            strong: ({ children }) => (
              <strong className="font-extrabold text-slate-950">{children}</strong>
            )
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  };

  // Helper to substitute placeholders with real data
  const applyLocalSubstitutions = (templateText: string): string => {
    const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const localStr = "São Paulo - SP";

    let result = templateText;

    // Company Data
    result = result.replace(/{RazaoSocial}/g, companyData.razonSocial || "SUA EMPRESA LTDA");
    result = result.replace(/{CNPJ}/g, companyData.cnpj || "00.000.000/0001-00");
    result = result.replace(/{Endereco}/g, companyData.address || "Endereço Não Cadastrado");
    result = result.replace(/{Telefone}/g, companyData.phone || "(11) 99999-0000");
    result = result.replace(/{Email}/g, companyData.email || "contato@empresa.com.br");
    result = result.replace(/{RepresentanteLegal}/g, companyData.representativeName || "Nome do Representante");
    result = result.replace(/{CPF}/g, companyData.representativeCpf || "000.000.000-00");

    // Bank details
    const bankDetailsStr = companyData.bankDetails || "Banco Itaú | Ag: 0001 | CC: 12345-6";
    result = result.replace(/{Banco}/g, bankDetailsStr.split("|")[0]?.trim() || "Banco Itaú");
    result = result.replace(/{Agencia}/g, "0001");
    result = result.replace(/{Conta}/g, "12345-6");

    // Edital Analysis Data
    if (activeEdital) {
      const orgao = activeEdital.identificacaoCertame?.orgaoComprador || "Órgão Licitante Público";
      const pregao = activeEdital.identificacaoCertame?.identificacaoNumerica || "Pregão Eletrônico nº 01/2026";
      const objeto = activeEdital.descricaoProduto || "Fornecimento de bens/serviços conforme Edital";
      const prazo = activeEdital.prazoEntrega || "15 dias úteis";

      result = result.replace(/{OrgaoComprador}/g, orgao);
      result = result.replace(/{NumeroPregao}/g, pregao);
      result = result.replace(/{Objeto}/g, objeto);
      result = result.replace(/{PrazoEntrega}/g, prazo);
    } else {
      result = result.replace(/{OrgaoComprador}/g, "ÓRGÃO PÚBLICO CONTRATANTE");
      result = result.replace(/{NumeroPregao}/g, "PREGÃO ELETRÔNICO Nº 00/2026");
      result = result.replace(/{Objeto}/g, "FORNECIMENTO DE MATERIAIS / SERVIÇOS TÉCNICOS");
      result = result.replace(/{PrazoEntrega}/g, "15 (quinze) dias úteis");
    }

    result = result.replace(/{Local}/g, localStr);
    result = result.replace(/{DataAtual}/g, today);

    return result;
  };

  // Select template handler
  const handleSelectTemplate = (template: DocumentTemplate) => {
    setSelectedTemplate(template);
    setDocTitle(`${template.title} - ${activeEdital?.identificacaoCertame?.identificacaoNumerica || "Novo Rascunho"}`);
    const filledText = applyLocalSubstitutions(template.defaultMarkdown);
    setDocumentContent(filledText);
  };

  // Load saved drafts on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("aip_created_docs_drafts");
      if (saved) {
        setDraftsList(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, []);

  // Save draft
  const handleSaveDraft = () => {
    const newDraft = {
      id: `draft-${Date.now()}`,
      title: docTitle || "Documento Sem Título",
      date: new Date().toLocaleString("pt-BR"),
      content: documentContent
    };
    const updated = [newDraft, ...draftsList.filter(d => d.title !== docTitle)].slice(0, 30);
    setDraftsList(updated);
    localStorage.setItem("aip_created_docs_drafts", JSON.stringify(updated));

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
    confetti({ particleCount: 30, spread: 50 });
  };

  // AI AutoFill / Generation with Agente IA
  const handleAiAutoFill = async (customPromptOverride?: string) => {
    setIsGenerating(true);

    try {
      const companyContextStr = useCompanyContext ? `
[DADOS DA EMPRESA LICITANTE]
- Razão Social: ${companyData.razonSocial || "Não informado"}
- CNPJ: ${companyData.cnpj || "Não informado"}
- Endereço: ${companyData.address || "Não informado"}
- Telefone: ${companyData.phone || "Não informado"}
- E-mail: ${companyData.email || "Não informado"}
- Representante Legal: ${companyData.representativeName || "Não informado"} (CPF: ${companyData.representativeCpf || "Não informado"})
- Dados Bancários: ${companyData.bankDetails || "Não informado"}
` : "";

      const editalContextStr = (useEditalContext && activeEdital) ? `
[DADOS DO EDITAL E ANÁLISE ATIVA]
- Órgão Comprador: ${activeEdital.identificacaoCertame?.orgaoComprador || "Não especificado"}
- Modalidade/Pregão: ${activeEdital.identificacaoCertame?.identificacaoNumerica || "Não especificado"}
- Objeto do Certame: ${activeEdital.descricaoProduto || "Não especificado"}
- Prazo de Entrega Exigido: ${activeEdital.prazoEntrega || "Não especificado"}
- Prazo de Pagamento: ${activeEdital.prazoPagamento || "Não especificado"}
- Documentos Exigidos: ${(activeEdital.documentosExigidos || []).join(", ")}
` : "";

      const attachmentStr = uploadedAttachmentText ? `
[ANEXO / TEXTO ADICIONAL FORNECIDO PELO USUÁRIO]
${uploadedAttachmentText}
` : "";

      const userInstructionsStr = customInstructions || customPromptOverride ? `
[INSTRUÇÕES ESPECÍFICAS DO USUÁRIO]
${customPromptOverride || customInstructions}
` : "";

      const prompt = `Você é o Agente IA Assessor de Licitações do HORASIS.
Sua tarefa é criar ou editar um documento jurídico/comercial perfeito e pronto para envio em uma licitação pública no Brasil (regido pela Lei nº 14.133/2021).

[MODELO BASE SELECIONADO]
Título: ${selectedTemplate.title}
Conteúdo Base Atual:
\`\`\`markdown
${documentContent}
\`\`\`

${companyContextStr}
${editalContextStr}
${attachmentStr}
${userInstructionsStr}

REGRAS RÍGIDAS DE GERAÇÃO:
1. Retorne o documento COMPLETO e devidamente formatado em Markdown profissional.
2. Substitua TODOS os campos genéricos, lacunas e colchetes por dados reais extraídos do contexto da Empresa e do Edital fornecidos.
3. Se houver tabela de preços ou proposta comercial, monte uma tabela Markdown limpa com valores realistas e coerentes.
4. Mantenha tom jurídico formal, impecável e perfeitamente adequado para órgãos públicos.
5. NÃO inclua saudações, nem texto explicativo antes ou depois do Markdown. Retorne APENAS o documento final pronto para uso.`;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`Erro no servidor: ${response.status}`);
      }

      const data = await response.json();
      if (data.reply) {
        setDocumentContent(data.reply);
        confetti({ particleCount: 40, spread: 60, colors: ["#6366f1", "#10b981"] });
      }
    } catch (err: any) {
      console.error("Erro na geração com o Agente IA:", err);
      alert("Não foi possível gerar o documento com o Agente IA no momento. Verifique sua conexão e tente novamente.");
    } finally {
      setIsGenerating(false);
      setAiAssistPrompt("");
      setShowAiAssist(false);
    }
  };

  // Google Docs Style Exec Command for Rich Editing directly on Paper
  const execCmd = (cmd: string, val: string = "") => {
    document.execCommand(cmd, false, val);
  };

  // Insert Table in paper
  const handleInsertTable = () => {
    const tableMd = `\n| Item | Descrição / Especificação | Qtd. | Unid. | Valor Unit. (R$) | Valor Total (R$) |\n| :---: | :--- | :---: | :---: | :---: | :---: |\n| **01** | Descrição do item conforme Edital | 10 | Unid | R$ 100,00 | R$ 1.000,00 |\n\n`;
    setDocumentContent(prev => prev + tableMd);
  };

  // Insert Variable in paper
  const handleInsertVariable = (varName: string) => {
    setDocumentContent(prev => prev + ` ${varName} `);
  };

  // Download Word (.docx)
  const handleDownloadWord = () => {
    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${docTitle}</title>
<style>
  body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.6; color: #111827; padding: 30px; }
  h1 { font-size: 18pt; font-weight: bold; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-top: 20px; }
  h2 { font-size: 14pt; font-weight: bold; color: #1e40af; margin-top: 18px; }
  h3 { font-size: 12pt; font-weight: bold; color: #1e293b; margin-top: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; font-size: 10pt; }
  table, th, td { border: 1px solid #94a3b8; padding: 8px; }
  th { background-color: #f1f5f9; font-weight: bold; text-align: left; }
  hr { border: 0; border-top: 1px solid #cbd5e1; margin: 20px 0; }
  p { margin-bottom: 10px; }
</style>
</head><body>`;
    const footer = "</body></html>";

    const htmlBody = documentContent
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/---/g, "<hr>")
      .replace(/\n/g, "<br>");

    const sourceHTML = header + htmlBody + footer;
    const blob = new Blob(["\ufeff" + sourceHTML], { type: "application/msword" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  // Download PDF
  const handleDownloadPdf = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${docTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          @page { size: A4; margin: 2cm; }
          body { font-family: 'Inter', sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt; padding: 0; margin: 0; }
          .letterhead-header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
          .letterhead-title { font-size: 14pt; font-weight: 800; color: #1e3a8a; text-transform: uppercase; }
          .letterhead-details { font-size: 8.5pt; color: #475569; text-align: right; }
          h1 { font-size: 16pt; font-weight: 700; color: #1e3a8a; border-bottom: 2px solid #2563eb; padding-bottom: 6px; text-transform: uppercase; margin-top: 15px; }
          h2 { font-size: 13pt; font-weight: 700; color: #0f172a; margin-top: 18px; }
          h3 { font-size: 11pt; font-weight: 600; color: #334155; margin-top: 14px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background-color: #f8fafc; font-weight: 600; }
          hr { border: 0; height: 1px; background: #e2e8f0; margin: 20px 0; }
          .letterhead-footer { margin-top: 50px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 8pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="letterhead-header">
          <div>
            <div class="letterhead-title">${companyData.razonSocial || "SUA EMPRESA LTDA"}</div>
            <div style="font-size: 9pt; color: #3b82f6; font-weight: 600;">CNPJ: ${companyData.cnpj || "00.000.000/0001-00"}</div>
          </div>
          <div class="letterhead-details">
            ${companyData.address || "Endereço da Empresa"}<br>
            Tel: ${companyData.phone || "(11) 99999-0000"} | E-mail: ${companyData.email || "contato@empresa.com.br"}
          </div>
        </div>
        <div id="content"></div>
        <div class="letterhead-footer">
          Documento Licitação Oficial • ${companyData.razonSocial || "Empresa Licitante"} • Gerado via HORASIS Assessor IA
        </div>
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <script>
          const markdownText = ${JSON.stringify(documentContent)};
          document.getElementById('content').innerHTML = marked.parse(markdownText);
          setTimeout(() => { window.print(); }, 500);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
    setShowDownloadMenu(false);
  };

  // Download Markdown (.md)
  const handleDownloadMarkdown = () => {
    const blob = new Blob([documentContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  // Sync Drive
  const handleGoogleDriveSync = async () => {
    setIsSyncing(true);
    try {
      addSyncedItem(
        docTitle,
        selectedTemplate.category === "propostas" ? "proposal" : "declaration",
        documentContent
      );
      confetti({ particleCount: 30, spread: 50 });
      alert("Documento sincronizado com o Google Drive / Workspace!");
    } catch {
      // ignore
    } finally {
      setIsSyncing(false);
    }
  };

  // Copy text
  const handleCopyText = () => {
    navigator.clipboard.writeText(documentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowDownloadMenu(false);
  };

  // Filter templates
  const filteredTemplates = TEMPLATES_CATALOG.filter(t => {
    const matchCat = activeCategory === "todos" || t.category === activeCategory;
    const matchSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        t.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-6 animate-fade-in pb-16">
      
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3.5">
            <div className="bg-gradient-to-tr from-indigo-600 to-blue-500 p-3 rounded-xl text-white shadow-lg shadow-indigo-600/30">
              <FileEdit className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight">Estúdio Criar Documentos & Propostas</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Agente IA + Papel Timbrado
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                Crie propostas comerciais, recursos e declarações com autopreenchimento pelo Agente IA e edição direta no papel timbrado A4.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDraftsModal(true)}
              className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
            >
              <FileCode className="w-4 h-4 text-indigo-400" />
              <span>Rascunhos ({draftsList.length})</span>
            </button>

            <button
              onClick={handleSaveDraft}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
            >
              {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              <span>{savedSuccess ? "Salvo!" : "Salvar Rascunho"}</span>
            </button>
          </div>
        </div>

        {/* ACTIVE CONTEXT BADGES */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium">Fontes de Dados Conectadas:</span>
            
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
              companyData.razonSocial ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"
            }`}>
              <Building2 className="w-3.5 h-3.5" />
              <span>Empresa: {companyData.razonSocial ? companyData.razonSocial.slice(0, 22) + "..." : "Não Configurada"}</span>
            </span>

            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
              activeEdital ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300" : "bg-slate-800 border-slate-700 text-slate-400"
            }`}>
              <Zap className="w-3.5 h-3.5" />
              <span>Edital Ativo: {activeEdital?.identificacaoCertame?.identificacaoNumerica || "Nenhum Selecionado"}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-slate-400 text-[11px]">
            <Info className="w-3.5 h-3.5 text-indigo-400" />
            <span>O Agente IA preencherá automaticamente todos os dados do edital e da sua empresa.</span>
          </div>
        </div>
      </div>

      {/* TEMPLATE SELECTION CATALOG */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: "todos", label: "Todos os Modelos" },
              { id: "propostas", label: "Propostas Comerciais" },
              { id: "declaracoes", label: "Habilitação & Declarações" },
              { id: "recursos", label: "Recursos & Impugnações" },
              { id: "atestados", label: "Atestados & Vistorias" }
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  activeCategory === cat.id
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar modelos..."
              className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-2">
          {filteredTemplates.map(tpl => {
            const isSelected = selectedTemplate.id === tpl.id;
            return (
              <div
                key={tpl.id}
                onClick={() => handleSelectTemplate(tpl)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between group ${
                  isSelected
                    ? "bg-gradient-to-br from-indigo-950/70 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-950/50 ring-1 ring-indigo-500/50"
                    : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      isSelected ? "bg-indigo-500/30 text-indigo-200 border border-indigo-500/40" : "bg-slate-800 text-slate-400"
                    }`}>
                      {tpl.badgeText}
                    </span>
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                        <Check className="w-3 h-3" /> Selecionado
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors">
                    {tpl.title}
                  </h3>
                  <p className="text-slate-400 text-xs mt-1.5 line-clamp-2 leading-relaxed">
                    {tpl.description}
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[11px]">
                  <span className="text-indigo-400 font-medium group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                    Carregar no Papel Timbrado <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI AUTOFILL CONTROLS */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-500/10 p-2 rounded-lg text-indigo-400 border border-indigo-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Preencher e Adequar com Agente IA</h3>
              <p className="text-slate-400 text-xs">Selecione os dados que o Agente IA deve usar para adaptar este documento às exigências do edital.</p>
            </div>
          </div>

          <button
            onClick={() => handleAiAutoFill()}
            disabled={isGenerating}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all shrink-0"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span>{isGenerating ? "Processando Agente IA..." : "Preencher Documento com Agente IA"}</span>
          </button>
        </div>

        {/* AI Checkboxes & Attachment option */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
            useCompanyContext ? "bg-indigo-500/10 border-indigo-500/40 text-white" : "bg-white/5 border-white/10 text-slate-400"
          }`}>
            <input
              type="checkbox"
              checked={useCompanyContext}
              onChange={(e) => setUseCompanyContext(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="font-semibold block text-slate-200">Inserir Dados da Empresa</span>
              <span className="text-[10px] text-slate-400">CNPJ, Razão Social, Endereço, Representante e Banco</span>
            </div>
          </label>

          <label className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
            useEditalContext ? "bg-indigo-500/10 border-indigo-500/40 text-white" : "bg-white/5 border-white/10 text-slate-400"
          }`}>
            <input
              type="checkbox"
              checked={useEditalContext}
              onChange={(e) => setUseEditalContext(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="font-semibold block text-slate-200">Extrair Requisitos do Edital Ativo</span>
              <span className="text-[10px] text-slate-400">Órgão, Pregão nº, Objeto, Prazos e Especificações</span>
            </div>
          </label>

          <button
            onClick={() => setShowAttachmentBox(!showAttachmentBox)}
            className={`p-3 rounded-xl border flex items-center justify-between text-left cursor-pointer transition-all ${
              showAttachmentBox || uploadedAttachmentText ? "bg-indigo-500/10 border-indigo-500/40 text-white" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            <div>
              <span className="font-semibold block text-slate-200">Modelo Anexo do Edital</span>
              <span className="text-[10px] text-slate-400">{uploadedAttachmentText ? "Anexo Carregado" : "Colar texto do anexo do edital"}</span>
            </div>
            <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
          </button>
        </div>

        {/* Attachment text area */}
        {showAttachmentBox && (
          <div className="bg-slate-950 border border-white/10 rounded-xl p-3 space-y-2 animate-fade-in">
            <span className="text-xs font-semibold text-slate-300 block">Cole abaixo o modelo exigido no edital do órgão:</span>
            <textarea
              value={uploadedAttachmentText}
              onChange={(e) => setUploadedAttachmentText(e.target.value)}
              placeholder="Cole aqui o texto exigido no anexo do edital..."
              className="w-full h-28 bg-slate-900 border border-white/10 rounded-lg p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed font-mono"
            />
          </div>
        )}

        {/* Custom Instructions */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300 block">Instruções adicionais para o Agente IA (Opcional):</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Ex: Ajuste a proposta com 30 dias de entrega e garantia estendida de 24 meses..."
              className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => handleAiAutoFill()}
              disabled={isGenerating}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shrink-0 disabled:opacity-50"
            >
              Aplicar Instrução
            </button>
          </div>
        </div>
      </div>

      {/* DOCUMENT STUDIO - DIRECT A4 PAPER EDITOR (GOOGLE DOCS STYLE) */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-4">
        
        {/* Title & Top Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Título do Documento</label>
            <input
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2 text-sm font-bold text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Fullscreen Button */}
            <button
              onClick={() => setIsFullscreenDocs(true)}
              className="px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Maximize2 className="w-4 h-4" />
              <span>Editar em Tela Cheia (Página Inteira)</span>
            </button>

            {/* DOWNLOAD BUTTON DROPDOWN */}
            <div className="relative">
              <button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/25 flex items-center gap-2 cursor-pointer transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Documento</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {/* Download Menu Dropdown Modal */}
              {showDownloadMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-2 z-50 animate-fade-in space-y-1">
                  <button
                    onClick={handleDownloadPdf}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-red-500/20 hover:text-red-200 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-red-400" />
                    <div>
                      <span className="block font-bold">Baixar como PDF (.pdf)</span>
                      <span className="text-[10px] text-slate-400">Formatação A4 Oficial para Impressão</span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadWord}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-blue-500/20 hover:text-blue-200 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-blue-400" />
                    <div>
                      <span className="block font-bold">Baixar para Word (.docx)</span>
                      <span className="text-[10px] text-slate-400">Editável no Microsoft Word</span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadMarkdown}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-indigo-500/20 hover:text-indigo-200 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileCode className="w-4 h-4 text-indigo-400" />
                    <div>
                      <span className="block font-bold">Baixar em Markdown (.md)</span>
                      <span className="text-[10px] text-slate-400">Marcação técnica de texto</span>
                    </div>
                  </button>

                  <div className="h-px bg-white/10 my-1"></div>

                  <button
                    onClick={handleCopyText}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-white/10 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>Copiar Texto Formatado</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleGoogleDriveSync}
              disabled={isSyncing}
              className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
            >
              <HardDriveDownload className="w-4 h-4" />
              <span>Drive</span>
            </button>
          </div>
        </div>

        {/* GOOGLE DOCS STYLE FORMATTING TOOLBAR */}
        <div className="bg-slate-950 p-2.5 rounded-xl border border-white/10 flex flex-wrap items-center justify-between gap-2 text-slate-300 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            
            <button
              onClick={() => handleInsertVariable("\n# TÍTULO DO DOCUMENTO\n")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Título H1"
            >
              <Heading1 className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n## SUBTÍTULO\n")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Subtítulo H2"
            >
              <Heading2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n### SEÇÃO TÉCNICA\n")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Seção H3"
            >
              <Heading3 className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1"></div>

            <button
              onClick={() => handleInsertVariable("**Texto em Negrito**")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer font-bold"
              title="Negrito (**)"
            >
              <Bold className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("*Texto em Itálico*")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer italic"
              title="Itálico (*)"
            >
              <Italic className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1"></div>

            <button
              onClick={() => handleInsertVariable("\n- Item 1\n- Item 2\n")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Lista com Marcadores"
            >
              <List className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n1. Primeiro item\n2. Segundo item\n")}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Lista Numerada"
            >
              <ListOrdered className="w-4 h-4" />
            </button>

            <button
              onClick={handleInsertTable}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Inserir Tabela de Preços"
            >
              <Table className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1"></div>

            {/* Quick Variables */}
            <div className="relative group">
              <button className="px-2.5 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] font-semibold text-indigo-300 border border-white/10 flex items-center gap-1 cursor-pointer">
                <span>+ Variável Dinâmica</span>
              </button>
              
              <div className="absolute top-full left-0 mt-1 w-56 bg-slate-900 border border-white/10 rounded-xl shadow-2xl p-1.5 hidden group-hover:block z-50 space-y-0.5">
                {[
                  { label: "Razão Social", val: "{RazaoSocial}" },
                  { label: "CNPJ da Empresa", val: "{CNPJ}" },
                  { label: "Representante Legal", val: "{RepresentanteLegal}" },
                  { label: "Órgão Comprador", val: "{OrgaoComprador}" },
                  { label: "Número do Pregão", val: "{NumeroPregao}" },
                  { label: "Objeto da Licitação", val: "{Objeto}" },
                  { label: "Data Atual", val: "{DataAtual}" },
                  { label: "Cidade / Local", val: "{Local}" }
                ].map(v => (
                  <button
                    key={v.val}
                    onClick={() => handleInsertVariable(v.val)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-indigo-600 hover:text-white text-slate-300 transition-colors block"
                  >
                    {v.label} <span className="text-[10px] opacity-60 font-mono">({v.val})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Copiloto Agente IA */}
            <button
              onClick={() => setShowAiAssist(!showAiAssist)}
              className="px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-900/30 cursor-pointer transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Copiloto Agente IA</span>
            </button>
          </div>
        </div>

        {/* INLINE AGENTE IA COPILOT DRAWER */}
        {showAiAssist && (
          <div className="bg-gradient-to-r from-indigo-950/80 via-slate-900 to-purple-950/80 border border-purple-500/30 rounded-xl p-4 space-y-3 animate-fade-in shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-white">Ajude-me a Escrever (Agente IA)</span>
              </div>
              <button onClick={() => setShowAiAssist(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {[
                "📜 Adicionar fundamentação da Lei 14.133/2021",
                "⚖️ Ajustar para tom estritamente jurídico formal",
                "🔍 Corrigir erros de pontuação e gramática",
                "📊 Inserir quadro de valores e dados bancários",
                "✂️ Resumir mantendo clareza técnica"
              ].map(chip => (
                <button
                  key={chip}
                  onClick={() => handleAiAutoFill(chip)}
                  className="px-2.5 py-1 bg-white/5 hover:bg-purple-500/20 text-purple-200 border border-purple-500/30 rounded-lg transition-colors cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={aiAssistPrompt}
                onChange={(e) => setAiAssistPrompt(e.target.value)}
                placeholder="Ex: Reescreva a introdução reforçando que nossa garantia é de 24 meses..."
                className="flex-1 bg-slate-950 border border-purple-500/30 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
              />
              <button
                onClick={() => handleAiAutoFill(aiAssistPrompt)}
                disabled={isGenerating || !aiAssistPrompt}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Executar</span>
              </button>
            </div>
          </div>
        )}

        {/* DIRECT A4 PAPEL TIMBRADO EDITOR (GOOGLE DOCS / WORD STAGE) */}
        <div className="bg-slate-950/80 p-4 md:p-8 rounded-2xl border border-white/10 min-h-[750px] overflow-y-auto flex flex-col items-center">
          
          <div className="w-full max-w-[210mm] flex items-center justify-between mb-4 px-1 gap-2 flex-wrap">
            <div className="text-slate-400 text-xs flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Papel Timbrado Oficial • A4 (210mm x 297mm) • Edição Direta no Documento</span>
            </div>
          </div>

          {/* PHYSICAL A4 PAPER CONTAINER */}
          <div 
            className="official-a4-paper bg-white text-slate-900 shadow-2xl rounded-sm w-full max-w-[210mm] min-h-[297mm] p-8 md:p-14 font-sans relative border border-slate-200 flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          >
            
            {/* PAPEL TIMBRADO: HEADER */}
            <div className="border-b-2 border-indigo-600 pb-4 mb-6 flex items-center justify-between gap-4 select-none">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-tr from-indigo-700 to-blue-600 text-white p-2.5 rounded-xl shadow-md">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="font-extrabold text-indigo-950 text-base tracking-tight uppercase">
                    {companyData.razonSocial || "SUA EMPRESA LTDA"}
                  </h2>
                  <p className="text-indigo-600 font-bold text-xs">
                    CNPJ: {companyData.cnpj || "00.000.000/0001-00"}
                  </p>
                </div>
              </div>

              <div className="text-right text-[10px] text-slate-500 font-medium leading-relaxed">
                <p>{companyData.address || "Endereço Não Cadastrado"}</p>
                <p>Tel: {companyData.phone || "(11) 99999-0000"} | E-mail: {companyData.email || "contato@empresa.com.br"}</p>
              </div>
            </div>

            {/* DIRECT EDITABLE / VISUAL DOCUMENT AREA */}
            <div className="flex-1">
              {renderFormattedA4Document(documentContent, true)}
            </div>

            {/* PAPEL TIMBRADO: FOOTER */}
            <div className="border-t border-slate-200 pt-4 mt-8 flex items-center justify-between text-[10px] text-slate-400 select-none">
              <div>
                Documento Licitação Oficial • <strong>{companyData.razonSocial || "Empresa Licitante"}</strong>
              </div>
              <div>
                Página 1 de 1
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* FULLSCREEN GOOGLE DOCS CANVAS MODAL */}
      {isFullscreenDocs && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-fade-in overflow-hidden">
          
          {/* Top Bar */}
          <div className="bg-slate-900 border-b border-white/10 px-6 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-600 p-2 rounded-lg text-white">
                <FileEdit className="w-5 h-5" />
              </div>
              <div>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="bg-transparent text-white font-bold text-base focus:outline-none focus:border-b border-indigo-500"
                />
                <p className="text-slate-400 text-[10px]">Modo Edição Página Inteira (Estúdio Google Docs)</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadPdf}
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>PDF</span>
              </button>

              <button
                onClick={handleDownloadWord}
                className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Word</span>
              </button>

              <button
                onClick={handleSaveDraft}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
              >
                Salvar
              </button>

              <button
                onClick={() => setIsFullscreenDocs(false)}
                className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                title="Sair da Tela Cheia"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-slate-900/90 border-b border-white/10 px-6 py-2 flex items-center gap-3 text-xs shrink-0 overflow-x-auto">
            <button onClick={() => handleInsertVariable("**Texto**")} className="p-1.5 hover:bg-white/10 rounded font-bold text-white">
              <Bold className="w-4 h-4" />
            </button>
            <button onClick={() => handleInsertVariable("*Texto*")} className="p-1.5 hover:bg-white/10 rounded italic text-white">
              <Italic className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10"></div>
            <button onClick={() => handleInsertVariable("\n# Título\n")} className="p-1.5 hover:bg-white/10 rounded text-white">
              <Heading1 className="w-4 h-4" />
            </button>
            <button onClick={() => handleInsertVariable("\n## Subtítulo\n")} className="p-1.5 hover:bg-white/10 rounded text-white">
              <Heading2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10"></div>
            <button onClick={handleInsertTable} className="p-1.5 hover:bg-white/10 rounded text-white">
              <Table className="w-4 h-4" />
            </button>
          </div>

          {/* Fullscreen A4 Paper View */}
          <div className="flex-1 bg-slate-950 overflow-y-auto p-8 flex justify-center">
            <div 
              className="official-a4-paper bg-white text-slate-900 shadow-2xl rounded-sm w-full max-w-[210mm] min-h-[297mm] p-12 md:p-16 font-sans relative border border-slate-200 flex flex-col justify-between"
              style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            >
              
              {/* Header */}
              <div className="border-b-2 border-indigo-600 pb-4 mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-gradient-to-tr from-indigo-700 to-blue-600 text-white p-2.5 rounded-xl">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-extrabold text-indigo-950 text-base uppercase">
                      {companyData.razonSocial || "SUA EMPRESA LTDA"}
                    </h2>
                    <p className="text-indigo-600 font-bold text-xs">CNPJ: {companyData.cnpj || "00.000.000/0001-00"}</p>
                  </div>
                </div>

                <div className="text-right text-[10px] text-slate-500 font-medium">
                  <p>{companyData.address || "Endereço da Empresa"}</p>
                  <p>Tel: {companyData.phone || "(11) 99999-0000"} | E-mail: {companyData.email || "contato@empresa.com.br"}</p>
                </div>
              </div>

              {/* Editable Area / Visual Area */}
              <div className="flex-1">
                {renderFormattedA4Document(documentContent, true)}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-200 pt-4 mt-8 flex items-center justify-between text-[10px] text-slate-400">
                <div>Documento Licitação Oficial • {companyData.razonSocial || "Empresa Licitante"}</div>
                <div>Página 1 de 1</div>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* SAVED DRAFTS MODAL */}
      {showDraftsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-bold text-white text-base">Rascunhos Salvos</h3>
              <button onClick={() => setShowDraftsModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {draftsList.length === 0 ? (
              <p className="text-slate-400 text-xs text-center py-8">Nenhum rascunho salvo ainda.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {draftsList.map(draft => (
                  <div
                    key={draft.id}
                    className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between gap-3 hover:bg-white/10 transition-colors"
                  >
                    <div>
                      <h4 className="font-bold text-white text-xs">{draft.title}</h4>
                      <p className="text-[10px] text-slate-400">{draft.date}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setDocTitle(draft.title);
                          setDocumentContent(draft.content);
                          setShowDraftsModal(false);
                        }}
                        className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-500 transition-colors cursor-pointer"
                      >
                        Carregar
                      </button>

                      <button
                        onClick={() => {
                          const updated = draftsList.filter(d => d.id !== draft.id);
                          setDraftsList(updated);
                          localStorage.setItem("aip_created_docs_drafts", JSON.stringify(updated));
                        }}
                        className="p-1 text-red-400 hover:bg-red-500/20 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
