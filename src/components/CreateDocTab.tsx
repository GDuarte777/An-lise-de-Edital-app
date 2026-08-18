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
  PenTool,
  FileUp,
  Paperclip,
  Database,
  Plus
} from "lucide-react";
import { CompanyData, EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
import { apiFetch, validateApiKeyFormat, formatAiError, getActiveAiConfig } from "../utils/aiClientHelper";
import { 
  syncDocumentToSupabase, 
  fetchDocumentosFromSupabase, 
  subscribeToSupabaseTable 
} from "../utils/supabaseClient";
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
  const [customInstructions, setCustomInstructions] = useState<string>("");
  
  // Edital Selection & Attachment Options
  const [analyzedEditais, setAnalyzedEditais] = useState<EditalAnalysis[]>([]);
  const [selectedEditalIndex, setSelectedEditalIndex] = useState<number>(0);
  const [editalSourceMode, setEditalSourceMode] = useState<"analyzed" | "new">("analyzed");
  const [newEditalText, setNewEditalText] = useState<string>("");
  const [newEditalFileName, setNewEditalFileName] = useState<string>("");

  // Template Switcher Modal State
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);

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

  // Reset to new clean document
  const handleNewDocument = () => {
    setDocTitle(`${selectedTemplate.title} - Novo Documento`);
    const filledText = applyLocalSubstitutions(selectedTemplate.defaultMarkdown);
    setDocumentContent(filledText);
  };

  // Load saved drafts and analyzed editais on mount
  useEffect(() => {
    async function loadDraftsFromSupabase() {
      try {
        const dbDocs = await fetchDocumentosFromSupabase();
        if (dbDocs && dbDocs.length > 0) {
          const formatted = dbDocs.map((d: any) => ({
            id: d.id,
            title: d.title || d.nome_documento || "Documento",
            date: d.created_at ? new Date(d.created_at).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR"),
            content: d.content || d.conteudo_markdown || ""
          }));
          setDraftsList(formatted);
          localStorage.setItem("aip_created_docs_drafts", JSON.stringify(formatted));
          return;
        }
      } catch (e) {
        console.warn("Falha ao buscar documentos do Supabase:", e);
      }

      try {
        const saved = localStorage.getItem("aip_created_docs_drafts");
        if (saved) {
          setDraftsList(JSON.parse(saved));
        }
      } catch {
        // ignore
      }
    }
    loadDraftsFromSupabase();

    const unsubscribe = subscribeToSupabaseTable("documentos_sincronizados", () => {
      loadDraftsFromSupabase();
    });

    try {
      const list: EditalAnalysis[] = [];
      if (activeEdital) {
        list.push(activeEdital);
      }
      const savedHistory = localStorage.getItem("aip_edital_history");
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: any) => {
            const editalObj = item.analysis_data || item;
            if (editalObj && (editalObj.identificacaoCertame || editalObj.descricaoProduto)) {
              const exists = list.some(
                e => (e.identificacaoCertame?.identificacaoNumerica &&
                     e.identificacaoCertame?.identificacaoNumerica === editalObj.identificacaoCertame?.identificacaoNumerica) ||
                     (e.descricaoProduto && e.descricaoProduto === editalObj.descricaoProduto)
              );
              if (!exists) list.push(editalObj);
            }
          });
        }
      }
      setAnalyzedEditais(list);
      if (list.length > 0) {
        setSelectedEditalIndex(0);
        setEditalSourceMode("analyzed");
      } else {
        setEditalSourceMode("new");
      }
    } catch {
      if (activeEdital) {
        setAnalyzedEditais([activeEdital]);
        setEditalSourceMode("analyzed");
      } else {
        setEditalSourceMode("new");
      }
    }

    return () => {
      unsubscribe();
    };
  }, [activeEdital]);

  // Handle uploading file for a new edital
  const handleNewEditalFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setNewEditalFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setNewEditalText(text);
      }
    };
    reader.readAsText(file);
  };

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

    syncDocumentToSupabase(
      docTitle || "Documento Sem Título",
      selectedTemplate.category === "propostas" ? "proposal" : "declaration",
      documentContent
    ).catch(e => console.warn("Erro ao salvar rascunho no Supabase:", e));

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

      let editalContextStr = "";
      if (editalSourceMode === "analyzed") {
        const selectedEdital = analyzedEditais[selectedEditalIndex] || activeEdital;
        if (selectedEdital) {
          editalContextStr = `
[DADOS DO EDITAL SELECIONADO NA PLATAFORMA]
- Órgão Comprador: ${selectedEdital.identificacaoCertame?.orgaoComprador || "Não especificado"}
- Modalidade/Pregão: ${selectedEdital.identificacaoCertame?.identificacaoNumerica || "Não especificado"}
- Objeto do Certame: ${selectedEdital.descricaoProduto || "Não especificado"}
- Prazo de Entrega Exigido: ${selectedEdital.prazoEntrega || selectedEdital.logisticaCronograma?.prazoEntregaReal || "Não especificado"}
- Prazo de Pagamento: ${selectedEdital.prazoPagamento || selectedEdital.viabilidadeFinanceira?.prazoPagamento || "Não especificado"}
- Documentos Exigidos: ${(selectedEdital.documentosExigidos || []).join(", ")}
${selectedEdital.rawText ? `- Resumo/Conteúdo do Edital: ${selectedEdital.rawText.slice(0, 1500)}` : ""}
`;
        }
      } else if (editalSourceMode === "new") {
        if (newEditalText.trim()) {
          editalContextStr = `
[CONTEÚDO / TEXTO DO NOVO EDITAL/ANEXO FORNECIDO]
${newEditalText.trim()}
`;
        }
      }

      const userInstructionsStr = customPromptOverride ? `
[INSTRUÇÃO ESPECÍFICA DO COMANDO]
${customPromptOverride}
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
${userInstructionsStr}

REGRAS RÍGIDAS DE GERAÇÃO:
1. Retorne o documento COMPLETO e devidamente formatado em Markdown profissional.
2. Substitua TODOS os campos genéricos, lacunas e colchetes por dados reais extraídos do contexto da Empresa e do Edital fornecidos.
3. Se houver tabela de preços ou proposta comercial, monte uma tabela Markdown limpa com valores realistas e coerentes.
4. Mantenha tom jurídico formal, impecável e perfeitamente adequado para órgãos públicos.
5. NÃO inclua saudações, nem texto explicativo antes ou depois do Markdown. Retorne APENAS o documento final pronto para uso.
6. NUNCA inclua frases informais, avisos de sistema, marcas d'água ou rodapés citando IA ou plataformas. O documento deve ser 100% formal para uso oficial.`;

      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }]
        }
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
      alert(formatAiError(err));
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
  h1 { font-size: 16pt; font-weight: bold; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-top: 20px; text-transform: uppercase; }
  h2 { font-size: 13pt; font-weight: bold; color: #1e40af; margin-top: 18px; }
  h3 { font-size: 11pt; font-weight: bold; color: #1e293b; margin-top: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; font-size: 10pt; }
  table, th, td { border: 1px solid #94a3b8; padding: 8px; }
  th { background-color: #f1f5f9; font-weight: bold; text-align: left; }
  hr { border: 0; border-top: 1px solid #cbd5e1; margin: 20px 0; }
  p { margin-bottom: 10px; text-align: justify; }
  .letterhead-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 24px; }
  .letterhead-title { font-size: 14pt; font-weight: bold; color: #1e3a8a; text-transform: uppercase; }
  .letterhead-details { font-size: 9pt; color: #475569; }
</style>
</head><body>
<div class="letterhead-header">
  <div class="letterhead-title">${companyData.razonSocial || "SUA EMPRESA LTDA"}</div>
  <div class="letterhead-details">CNPJ: ${companyData.cnpj || "00.000.000/0001-00"} | ${companyData.address || ""}</div>
  <div class="letterhead-details">Tel: ${companyData.phone || "(11) 99999-0000"} | E-mail: ${companyData.email || "contato@empresa.com.br"}</div>
</div>
`;
    const footer = `
<div style="margin-top: 40px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 8.5pt; color: #64748b; text-align: center;">
  ${companyData.razonSocial || "Empresa Licitante"}${companyData.cnpj ? ` • CNPJ: ${companyData.cnpj}` : ''}
</div>
</body></html>`;

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
          @page {
            size: A4;
            margin: 0;
          }
          @media print {
            html, body {
              margin: 0;
              padding: 0;
              background-color: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
          body {
            font-family: 'Inter', sans-serif;
            color: #0f172a;
            line-height: 1.6;
            font-size: 11pt;
            padding: 1.5cm 2cm;
            margin: 0;
            box-sizing: border-box;
          }
          .letterhead-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
          .letterhead-title { font-size: 14pt; font-weight: 800; color: #1e3a8a; text-transform: uppercase; }
          .letterhead-details { font-size: 8.5pt; color: #475569; text-align: right; }
          h1 { font-size: 16pt; font-weight: 700; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; text-transform: uppercase; margin-top: 15px; }
          h2 { font-size: 13pt; font-weight: 700; color: #0f172a; margin-top: 18px; }
          h3 { font-size: 11pt; font-weight: 600; color: #334155; margin-top: 14px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10pt; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background-color: #f8fafc; font-weight: 600; }
          hr { border: 0; height: 1px; background: #e2e8f0; margin: 20px 0; }
          .letterhead-footer { margin-top: 40px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="letterhead-header">
          <div>
            <div class="letterhead-title">${companyData.razonSocial || "SUA EMPRESA LTDA"}</div>
            <div style="font-size: 9pt; color: #1e3a8a; font-weight: 600;">CNPJ: ${companyData.cnpj || "00.000.000/0001-00"}</div>
          </div>
          <div class="letterhead-details">
            ${companyData.address || "Endereço da Empresa"}<br>
            Tel: ${companyData.phone || "(11) 99999-0000"} | E-mail: ${companyData.email || "contato@empresa.com.br"}
          </div>
        </div>
        <div id="content"></div>
        <div class="letterhead-footer">
          ${companyData.razonSocial || "Empresa Licitante"}${companyData.cnpj ? ` • CNPJ: ${companyData.cnpj}` : ''}
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
      
      {/* UNIFIED MINIMALIST CONTROL PANEL */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        {/* Top Row: Title + Main Action Buttons */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Estúdio Criar Documentos</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  IA Assessor
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                Crie e adeque documentos oficiais com preenchimento automático pelo Agente IA.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleNewDocument}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Criar novo documento limpo"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>

            <button
              onClick={() => setShowDraftsModal(true)}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5 text-indigo-400" />
              <span>Rascunhos ({draftsList.length})</span>
            </button>

            <button
              onClick={handleSaveDraft}
              className="px-3 py-1.5 bg-white hover:bg-[#F3F4F6] text-[#374151] border border-[#D1D5DB] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {savedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Save className="w-3.5 h-3.5 text-[#6B7280]" />}
              <span>{savedSuccess ? "Salvo!" : "Salvar Rascunho"}</span>
            </button>

            <button
              onClick={() => handleAiAutoFill()}
              disabled={isGenerating}
              className="px-4 py-2 bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all shrink-0"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              <span>{isGenerating ? "Preenchendo..." : "Preencher com IA"}</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Minimalist Controls Strip (Modelo, Edital, Empresa) */}
        <div className="pt-3 border-t border-[#F3F4F6] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            {/* 1. Modelo Selector Button */}
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-3 py-1.5 bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] hover:border-[#FF5A00]/50 rounded-xl text-xs font-semibold text-[#111827] flex items-center gap-2 transition-all cursor-pointer truncate max-w-xs shadow-2xs"
              title="Trocar Modelo de Documento"
            >
              <span className="text-[#FF5A00] font-bold uppercase text-[10px] shrink-0 font-mono">Modelo:</span>
              <span className="truncate">{selectedTemplate.badgeText} — {selectedTemplate.title}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
            </button>

            {/* 2. Edital Source Dropdown */}
            <div className="relative inline-flex items-center">
              <select
                value={editalSourceMode === "analyzed" ? `analyzed_${selectedEditalIndex}` : "new"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "new") {
                    setEditalSourceMode("new");
                  } else if (val.startsWith("analyzed_")) {
                    setEditalSourceMode("analyzed");
                    const idx = parseInt(val.replace("analyzed_", ""), 10);
                    setSelectedEditalIndex(idx);
                  }
                }}
                className="bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] hover:border-[#FF5A00]/50 rounded-xl px-3 py-1.5 text-xs font-semibold text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#FF5A00] cursor-pointer max-w-xs shadow-2xs"
              >
                {analyzedEditais.length > 0 ? (
                  analyzedEditais.map((ed, idx) => (
                    <option key={idx} value={`analyzed_${idx}`} className="bg-white text-[#111827]">
                      Edital: {ed.identificacaoCertame?.identificacaoNumerica || `Análise #${idx + 1}`} ({ed.identificacaoCertame?.orgaoComprador?.slice(0, 20) || "Histórico"})
                    </option>
                  ))
                ) : (
                  <option value="analyzed_0" disabled className="bg-white text-[#9CA3AF]">
                    Edital: Nenhum no Histórico
                  </option>
                )}
                <option value="new" className="bg-white text-[#FF5A00] font-bold">
                  + Anexar / Upload de Novo Edital
                </option>
              </select>
            </div>

            {/* 3. Empresa Context Toggle Checkbox */}
            <label className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
              useCompanyContext ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold" : "bg-white border-[#D1D5DB] text-[#6B7280]"
            }`}>
              <input
                type="checkbox"
                checked={useCompanyContext}
                onChange={(e) => setUseCompanyContext(e.target.checked)}
                className="rounded border-[#D1D5DB] bg-white text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer"
              />
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs truncate max-w-[180px]">
                {companyData.razonSocial ? companyData.razonSocial : "Dados da Empresa"}
              </span>
            </label>
          </div>

          {/* Quick Upload action when 'new' edital is selected */}
          {editalSourceMode === "new" && (
            <div className="flex items-center gap-2 shrink-0">
              <label className="px-3 py-1 bg-[#FF5A00]/10 hover:bg-[#FF5A00]/20 border border-[#FF5A00]/20 rounded-lg text-[11px] font-semibold text-[#FF5A00] flex items-center gap-1.5 cursor-pointer transition-all">
                <FileUp className="w-3.5 h-3.5" />
                <span>{newEditalFileName || "Anexar Arquivo (.pdf / .txt)"}</span>
                <input type="file" accept=".txt,.pdf,.doc,.docx" onChange={handleNewEditalFileUpload} className="hidden" />
              </label>
              {newEditalText && (
                <span className="text-[10px] text-emerald-700 font-bold">✓ Carregado</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* TEMPLATE SWITCHER MODAL / POPUP */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-3.5 sm:p-4 border-b border-[#F3F4F6] dark:border-[#27272A] flex items-center justify-between bg-white dark:bg-[#18181B] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <div className="bg-[#FFF0E5] dark:bg-[#2A170A] p-2 rounded-xl border border-[#FFD6C2] dark:border-[#4A2410] shrink-0">
                  <Layers className="w-5 h-5 text-[#FF5A00]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-[#111827] dark:text-zinc-100 text-sm sm:text-base truncate">Selecione o Modelo de Documento</h3>
                  <p className="text-[#6B7280] dark:text-zinc-400 text-[11px] sm:text-xs truncate">Escolha o modelo base para carregar no papel timbrado</p>
                </div>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="p-1.5 text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white hover:bg-[#F3F4F6] dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-[#F3F4F6] bg-[#F9FAFB] space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
                  {[
                    { id: "todos", label: "Todos os Modelos" },
                    { id: "propostas", label: "Propostas" },
                    { id: "declaracoes", label: "Declarações" },
                    { id: "recursos", label: "Recursos" },
                    { id: "atestados", label: "Atestados" }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        activeCategory === cat.id
                          ? "bg-[#FF5A00] text-white shadow-xs"
                          : "bg-white text-[#6B7280] hover:text-[#111827] hover:bg-gray-100 border border-[#E5E7EB]"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-56 shrink-0">
                  <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar modelo..."
                    className="w-full bg-white border border-[#D1D5DB] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
                  />
                </div>
              </div>
            </div>

            {/* Templates Scrollable List */}
            <div className="p-4 overflow-y-auto space-y-2.5 max-h-[50vh] bg-white">
              {filteredTemplates.map(tpl => {
                const isSelected = selectedTemplate.id === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => {
                      handleSelectTemplate(tpl);
                      setShowTemplateModal(false);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                      isSelected
                        ? "bg-[#FF5A00]/5 border-[#FF5A00] shadow-2xs"
                        : "bg-white border-[#E5E7EB] hover:border-[#FF5A00]/40 hover:bg-[#F9FAFB]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isSelected ? "bg-[#FF5A00]/15 text-[#FF5A00] border border-[#FF5A00]/30" : "bg-gray-100 text-[#6B7280]"
                        }`}>
                          {tpl.badgeText}
                        </span>
                        <span className="text-[10px] text-[#6B7280] capitalize font-medium">{tpl.category}</span>
                      </div>
                      <h4 className="font-bold text-[#111827] text-sm group-hover:text-[#FF5A00] transition-colors truncate">
                        {tpl.title}
                      </h4>
                      <p className="text-[#6B7280] text-xs line-clamp-1 mt-0.5">
                        {tpl.description}
                      </p>
                    </div>

                    <button className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all ${
                      isSelected ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-[#FF5A00] text-white group-hover:bg-[#E04F00]"
                    }`}>
                      {isSelected ? "Ativo" : "Selecionar"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT STUDIO - DIRECT A4 PAPER EDITOR (GOOGLE DOCS STYLE) */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 space-y-4 shadow-xs">
        
        {/* Title & Top Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#F3F4F6]">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1 font-mono">Título do Documento</label>
            <input
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="w-full bg-white border border-[#D1D5DB] rounded-xl px-3.5 py-2 text-sm font-bold text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Fullscreen Button */}
            <button
              onClick={() => setIsFullscreenDocs(true)}
              className="px-3.5 py-2 bg-[#FF5A00]/10 hover:bg-[#FF5A00]/20 text-[#FF5A00] border border-[#FF5A00]/20 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Maximize2 className="w-4 h-4" />
              <span>Editar em Tela Cheia (Página Inteira)</span>
            </button>

            {/* DOWNLOAD BUTTON DROPDOWN */}
            <div className="relative">
              <button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                className="px-4 py-2 bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Documento</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {/* Download Menu Dropdown Modal */}
              {showDownloadMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl p-2 z-50 animate-fade-in space-y-1">
                  <button
                    onClick={handleDownloadPdf}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-[#374151] hover:bg-rose-50 hover:text-rose-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-rose-600" />
                    <div>
                      <span className="block font-bold">Baixar como PDF (.pdf)</span>
                      <span className="text-[10px] text-[#6B7280]">Formatação A4 Oficial para Impressão</span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadWord}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-[#374151] hover:bg-blue-50 hover:text-blue-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-blue-600" />
                    <div>
                      <span className="block font-bold">Baixar para Word (.docx)</span>
                      <span className="text-[10px] text-[#6B7280]">Editável no Microsoft Word</span>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadMarkdown}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-[#374151] hover:bg-orange-50 hover:text-[#FF5A00] flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <FileCode className="w-4 h-4 text-[#FF5A00]" />
                    <div>
                      <span className="block font-bold">Baixar em Markdown (.md)</span>
                      <span className="text-[10px] text-[#6B7280]">Marcação técnica de texto</span>
                    </div>
                  </button>

                  <div className="h-px bg-[#E5E7EB] my-1"></div>

                  <button
                    onClick={handleCopyText}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-[#374151] hover:bg-[#F3F4F6] flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4 text-[#6B7280]" />
                    <span>Copiar Texto Formatado</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleGoogleDriveSync}
              disabled={isSyncing}
              className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
            >
              <HardDriveDownload className="w-4 h-4" />
              <span>Drive</span>
            </button>
          </div>
        </div>

        {/* GOOGLE DOCS STYLE FORMATTING TOOLBAR */}
        <div className="bg-[#F9FAFB] p-2.5 rounded-xl border border-[#E5E7EB] flex flex-wrap items-center justify-between gap-2 text-[#374151] text-xs">
          <div className="flex flex-wrap items-center gap-1">
            
            <button
              onClick={() => handleInsertVariable("\n# TÍTULO DO DOCUMENTO\n")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Título H1"
            >
              <Heading1 className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n## SUBTÍTULO\n")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Subtítulo H2"
            >
              <Heading2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n### SEÇÃO TÉCNICA\n")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Seção H3"
            >
              <Heading3 className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#E5E7EB] mx-1"></div>

            <button
              onClick={() => handleInsertVariable("**Texto em Negrito**")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer font-bold"
              title="Negrito (**)"
            >
              <Bold className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("*Texto em Itálico*")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer italic"
              title="Itálico (*)"
            >
              <Italic className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#E5E7EB] mx-1"></div>

            <button
              onClick={() => handleInsertVariable("\n- Item 1\n- Item 2\n")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Lista com Marcadores"
            >
              <List className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleInsertVariable("\n1. Primeiro item\n2. Segundo item\n")}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Lista Numerada"
            >
              <ListOrdered className="w-4 h-4" />
            </button>

            <button
              onClick={handleInsertTable}
              className="p-1.5 hover:bg-[#E5E7EB] rounded-lg text-[#374151] hover:text-[#111827] transition-colors cursor-pointer"
              title="Inserir Tabela de Preços"
            >
              <Table className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-[#E5E7EB] mx-1"></div>

            {/* Quick Variables */}
            <div className="relative group">
              <button className="px-2.5 py-1 bg-white hover:bg-[#F3F4F6] rounded-lg text-[11px] font-semibold text-[#FF5A00] border border-[#FF5A00]/30 flex items-center gap-1 cursor-pointer">
                <span>+ Variável Dinâmica</span>
              </button>
              
              <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-[#E5E7EB] rounded-xl shadow-xl p-1.5 hidden group-hover:block z-50 space-y-0.5">
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
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-orange-50 hover:text-[#FF5A00] text-[#374151] transition-colors block"
                  >
                    {v.label} <span className="text-[10px] text-[#6B7280] font-mono">({v.val})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Copiloto Agente IA */}
            <button
              onClick={() => setShowAiAssist(!showAiAssist)}
              className="px-3 py-1 bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Copiloto Agente IA</span>
            </button>
          </div>
        </div>

        {/* INLINE AGENTE IA COPILOT DRAWER */}
        {showAiAssist && (
          <div className="bg-orange-50/60 border border-[#FF5A00]/20 rounded-xl p-4 space-y-3 animate-fade-in shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#FF5A00]" />
                <span className="text-xs font-bold text-[#111827]">Ajude-me a Escrever (Agente IA)</span>
              </div>
              <button onClick={() => setShowAiAssist(false)} className="text-[#6B7280] hover:text-[#111827]">
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
                  className="px-2.5 py-1 bg-white hover:bg-orange-100/80 text-[#374151] border border-[#FF5A00]/30 rounded-lg transition-colors cursor-pointer"
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
                className="flex-1 bg-white border border-[#D1D5DB] rounded-xl px-3.5 py-2 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5A00]"
              />
              <button
                onClick={() => handleAiAutoFill(aiAssistPrompt)}
                disabled={isGenerating || !aiAssistPrompt}
                className="px-4 py-2 bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Executar</span>
              </button>
            </div>
          </div>
        )}

        {/* DIRECT A4 PAPEL TIMBRADO EDITOR (GOOGLE DOCS / WORD STAGE) */}
        <div className="bg-[#F3F4F6] p-4 md:p-8 rounded-2xl border border-[#E5E7EB] min-h-[750px] overflow-y-auto flex flex-col items-center">
          
          <div className="w-full max-w-[210mm] flex items-center justify-between mb-4 px-1 gap-2 flex-wrap">
            <div className="text-[#6B7280] text-xs flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Papel Timbrado Oficial • A4 (210mm x 297mm) • Edição Direta no Documento</span>
            </div>
          </div>

          {/* PHYSICAL A4 PAPER CONTAINER */}
          <div 
            className="official-a4-paper bg-white text-slate-900 shadow-xl rounded-sm w-full max-w-[210mm] min-h-[297mm] p-8 md:p-14 font-sans relative border border-slate-200 flex flex-col justify-between selection:bg-orange-100 selection:text-[#FF5A00]"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          >
            
            {/* PAPEL TIMBRADO: HEADER */}
            <div className="border-b-2 border-[#FF5A00] pb-4 mb-6 flex items-center justify-between gap-4 select-none">
              <div className="flex items-center gap-3">
                <div className="bg-[#FF5A00] text-white p-2.5 rounded-xl shadow-xs">
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
                <strong>{companyData.razonSocial || "Empresa Licitante"}</strong>{companyData.cnpj ? ` • CNPJ: ${companyData.cnpj}` : ''}
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
        <div className="fixed inset-0 z-[9999] bg-[#F3F4F6] dark:bg-[#121212] flex flex-col animate-fade-in overflow-hidden">
          
          {/* Top Bar */}
          <div className="bg-white dark:bg-[#18181B] border-b border-[#E5E7EB] dark:border-[#27272A] px-4 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-[#FF5A00] p-2 rounded-xl text-white shrink-0">
                <FileEdit className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="bg-transparent text-[#111827] dark:text-zinc-100 font-bold text-sm sm:text-base focus:outline-none focus:border-b-2 focus:border-[#FF5A00] truncate max-w-xs sm:max-w-md"
                />
                <p className="text-[#6B7280] dark:text-zinc-400 text-[10px] truncate">Modo Edição Página Inteira (Estúdio Google Docs)</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={handleDownloadPdf}
                className="px-2.5 sm:px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>PDF</span>
              </button>

              <button
                onClick={handleDownloadWord}
                className="px-2.5 sm:px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Word</span>
              </button>

              <button
                onClick={handleSaveDraft}
                className="px-3 sm:px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
              >
                Salvar
              </button>

              <button
                onClick={() => setIsFullscreenDocs(false)}
                className="p-1.5 sm:p-2 text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white bg-[#F3F4F6] dark:bg-zinc-800 hover:bg-[#E5E7EB] dark:hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
                title="Sair da Tela Cheia"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-[#F9FAFB] dark:bg-[#18181B] border-b border-[#E5E7EB] dark:border-[#27272A] px-4 sm:px-6 py-2 flex items-center gap-2 sm:gap-3 text-xs shrink-0 overflow-x-auto text-[#374151] dark:text-zinc-300">
            <button onClick={() => handleInsertVariable("**Texto**")} className="p-1.5 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 rounded font-bold text-[#111827] dark:text-white">
              <Bold className="w-4 h-4" />
            </button>
            <button onClick={() => handleInsertVariable("*Texto*")} className="p-1.5 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 rounded italic text-[#111827] dark:text-white">
              <Italic className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-[#E5E7EB] dark:bg-[#27272A]"></div>
            <button onClick={() => handleInsertVariable("\n# Título\n")} className="p-1.5 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 rounded text-[#111827] dark:text-white">
              <Heading1 className="w-4 h-4" />
            </button>
            <button onClick={() => handleInsertVariable("\n## Subtítulo\n")} className="p-1.5 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 rounded text-[#111827] dark:text-white">
              <Heading2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-[#E5E7EB] dark:bg-[#27272A]"></div>
            <button onClick={handleInsertTable} className="p-1.5 hover:bg-[#E5E7EB] dark:hover:bg-zinc-800 rounded text-[#111827] dark:text-white">
              <Table className="w-4 h-4" />
            </button>
          </div>

          {/* Fullscreen A4 Paper View */}
          <div className="flex-1 bg-[#E5E7EB] dark:bg-[#09090B] overflow-y-auto p-3 sm:p-6 md:p-8 flex justify-center">
            <div 
              className="official-a4-paper bg-white text-slate-900 shadow-2xl rounded-sm w-full max-w-[210mm] min-h-[297mm] p-6 sm:p-12 md:p-16 font-sans relative border border-slate-200 flex flex-col justify-between"
              style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            >
              
              {/* Header */}
              <div className="border-b-2 border-[#FF5A00] pb-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-[#FF5A00] text-white p-2.5 rounded-xl">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-extrabold text-[#111827] text-sm sm:text-base uppercase">
                      {companyData.razonSocial || "SUA EMPRESA LTDA"}
                    </h2>
                    <p className="text-[#FF5A00] font-bold text-xs">CNPJ: {companyData.cnpj || "00.000.000/0001-00"}</p>
                  </div>
                </div>

                <div className="text-left sm:text-right text-[10px] text-slate-500 font-medium">
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
                <div>{companyData.razonSocial || "Empresa Licitante"}{companyData.cnpj ? ` • CNPJ: ${companyData.cnpj}` : ''}</div>
                <div>Página 1 de 1</div>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* SAVED DRAFTS MODAL */}
      {showDraftsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl w-full max-w-xl p-4 sm:p-6 space-y-4 shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-[#F3F4F6] dark:border-[#27272A] pb-3">
              <h3 className="font-bold text-[#111827] dark:text-zinc-100 text-sm sm:text-base">Rascunhos Salvos</h3>
              <button onClick={() => setShowDraftsModal(false)} className="text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white p-1 hover:bg-[#F3F4F6] dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {draftsList.length === 0 ? (
              <p className="text-[#6B7280] dark:text-zinc-400 text-xs text-center py-8">Nenhum rascunho salvo ainda.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {draftsList.map(draft => (
                  <div
                    key={draft.id}
                    className="p-3 bg-[#F9FAFB] dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] rounded-xl flex items-center justify-between gap-3 hover:bg-[#F3F4F6] dark:hover:bg-zinc-800/80 transition-colors"
                  >
                    <div className="min-w-0">
                      <h4 className="font-bold text-[#111827] dark:text-zinc-100 text-xs truncate">{draft.title}</h4>
                      <p className="text-[10px] text-[#6B7280] dark:text-zinc-400">{draft.date}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setDocTitle(draft.title);
                          setDocumentContent(draft.content);
                          setShowDraftsModal(false);
                        }}
                        className="px-3 py-1 bg-[#FF5A00] text-white rounded-lg text-xs font-semibold hover:bg-[#E04F00] transition-colors cursor-pointer"
                      >
                        Carregar
                      </button>

                      <button
                        onClick={() => {
                          const updated = draftsList.filter(d => d.id !== draft.id);
                          setDraftsList(updated);
                          localStorage.setItem("aip_created_docs_drafts", JSON.stringify(updated));
                        }}
                        className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded cursor-pointer"
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
