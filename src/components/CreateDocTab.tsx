import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileEdit,
  Sparkles,
  Download,
  FileText,
  FileCode,
  Building2,
  Save,
  Printer,
  Copy,
  Check,
  Search,
  Send,
  Wand2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Table,
  Eye,
  Edit3,
  Layers,
  HardDriveDownload,
  Bot,
  Loader2,
  Zap,
  X,
  Maximize2,
  Minimize2,
  ChevronDown,
  Trash2,
  FileUp,
  Plus,
  CheckCircle2,
  FileCheck2,
  FolderPlus,
  Landmark,
  AlertCircle
} from "lucide-react";
import { CompanyData, EditalAnalysis } from "../types";
import { addSyncedItem } from "../utils/googleSync";
import {
  apiFetch,
  formatAiError,
  prepareAttachmentsForServer,
  readJsonResponse,
  readJsonResponseSafe
} from "../utils/aiClientHelper";
import {
  syncDocumentToSupabase,
  fetchDocumentosFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { useEditalHistory, addEditalToHistory } from "../utils/editalHistory";

interface CreateDocTabProps {
  companyData: CompanyData;
  activeEdital: EditalAnalysis | null;
  onOpenDocPreview?: (title: string, markdownText: string, type: "proposal" | "declaration") => void;
  initialTemplateId?: string;
}

export interface DocumentTemplate {
  id: string;
  title: string;
  category: "propostas" | "declaracoes" | "procuracoes_atestados" | "recursos" | "personalizados";
  description: string;
  badgeText: string;
  defaultMarkdown: string;
  isCustom?: boolean;
}

const CUSTOM_TEMPLATES_STORAGE_KEY = "aip_custom_doc_templates_v1";

export const TEMPLATES_CATALOG: DocumentTemplate[] = [
  {
    id: "proposta_comercial",
    title: "Proposta Comercial (Modelo Oficial)",
    category: "propostas",
    description: "Proposta comercial enxuta em 1 folha com identificação do proponente, planilha de preços, condições comerciais e assinatura padronizada.",
    badgeText: "Proposta Oficial",
    defaultMarkdown: `# PROPOSTA COMERCIAL

**À {OrgaoComprador}**  
**Ref.:** {NumeroPregao}

A empresa proponente abaixo identificada apresenta sua proposta comercial formal para **{Objeto}**, em atendimento às demandas de **{OrgaoComprador}**, declarando aceitar irrestritamente todas as condições do Edital.

### 1. DADOS DO PROPONENTE E PLANILHA DE PREÇOS

| Razão Social: | {RazaoSocial} | CNPJ: | {CNPJ} |
| :--- | :--- | :--- | :--- |
| **Endereço:** | {Endereco} | **Tel / E-mail:** | {Telefone} \| {Email} |
| **Responsável:** | {RepresentanteLegal} (CPF: {CPF}) | **Dados Bancários:** | {DadosBancarios} |

| Item | Descrição Detalhada do Objeto Conforme Termo de Referência | Qtd | Un. | Marca / Modelo | Vigência | Valor Unit. | Valor Total |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **01** | **{Objeto}** — Especificações completas conforme Termo de Referência do Edital. | 01 | Unid. | [MARCA / MODELO] | 12 Meses | {ValorEstimado} | {ValorEstimado} |

**VALOR TOTAL GLOBAL:** **{ValorEstimado}** *(Por extenso: [VALOR TOTAL POR EXTENSO])*

### 2. CONDIÇÕES COMERCIAIS E DECLARAÇÕES LEGAIS

| Validade da Proposta: | 60 (sessenta) dias corridos | Condições de Pagamento: | {PrazoPagamento} |
| :--- | :--- | :--- | :--- |
| **Prazo de Entrega:** | {PrazoEntrega} | **Local de Entrega:** | Conforme Edital ({OrgaoComprador}) |

- Declaramos que nos preços ofertados estão inclusos todos os custos diretos, indiretos, tributos, fretes, encargos sociais, trabalhistas e fiscais.
- Declaramos que a proposta compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal e legislação vigente (Art. 63, § 1º da Lei nº 14.133/2021) e que inexistem fatos impeditivos para nossa habilitação.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_menor_idade",
    title: "Declaração de Não Emprego de Menor (Art. 7º, XXXIII, CF)",
    category: "declaracoes",
    description: "Declaração de cumprimento do disposto no inciso XXXIII do art. 7º da Constituição Federal (Art. 68, VI, da Lei nº 14.133/2021).",
    badgeText: "Art. 68, VI - Lei 14.133",
    defaultMarkdown: `# DECLARAÇÃO DE CUMPRIMENTO DO DISPOSTO NO INCISO XXXIII DO ART. 7º DA CONSTITUIÇÃO FEDERAL
*(Em atendimento ao art. 68, inciso VI, da Lei Federal nº 14.133/2021 e ao art. 27, inciso V, da Lei Federal nº 8.666/1993)*

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, por intermédio do seu representante legal infra-assinado, **DECLARA**, para fins do disposto no inciso VI do art. 68 da Lei Federal nº 14.133/2021 e no inciso V do art. 27 da Lei Federal nº 8.666/1993, perante **{OrgaoComprador}** ({NumeroPregao}), que cumpre integralmente a norma contida no inciso XXXIII do artigo 7º da Constituição Federal de 1988.

**DECLARA**, outrossim, que não emprega menores de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre e não emprega menores de 16 (dezesseis) anos em qualquer trabalho, salvo na condição de aprendiz, a partir de 14 (quatorze) anos.

Por ser a mais pura expressão da verdade, firma a presente declaração para que produza os seus legítimos e jurídicos efeitos perante os órgãos da Administração Pública.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_fatos_supervenientes_impeditivos",
    title: "Declaração de Inexistência de Fatos Supervenientes Impeditivos",
    category: "declaracoes",
    description: "Declara ausência de fatos impeditivos, suspensão, inidoneidade, registros no CEIS/CNEP/TCU e vínculo societário com agentes do órgão.",
    badgeText: "Idoneidade / CEIS / TCU",
    defaultMarkdown: `# DECLARAÇÃO DE INEXISTÊNCIA DE FATOS SUPERVENIENTES IMPEDITIVOS

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, por intermédio de seu representante legal, **DECLARA**, sob as penas da Lei e para fins do certame **{NumeroPregao}** perante **{OrgaoComprador}**, que:

1. Até a presente data inexistem fatos supervenientes impeditivos para a sua habilitação no certame licitatório, ciente da obrigatoriedade de declarar ocorrências posteriores que venham a obstar a contratação;
2. Não se encontra temporariamente suspensa de licitar nem impedida de contratar com a Administração Pública em nenhuma esfera governamental;
3. Não foi declarada inidônea para licitar ou contratar por qualquer órgão ou entidade pública;
4. Não possui registros impeditivos no CEIS (Cadastro Nacional de Empresas Inidôneas e Suspensas), CNEP (Cadastro Nacional de Empresas Punidas) ou perante o TCU;
5. Não possui em seu quadro societário agentes públicos pertencentes ao órgão licitante contratante (**{OrgaoComprador}**).

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_superveniencia",
    title: "Declaração de Superveniência e Regularidade Cadastral",
    category: "declaracoes",
    description: "Compromisso formal de informar fatos supervenientes impeditivos e manter atualizadas as certidões Municipal, Estadual, Federal, INSS e FGTS.",
    badgeText: "Registro Cadastral",
    defaultMarkdown: `# DECLARAÇÃO DE SUPERVENIÊNCIA

Eu, **{RepresentanteLegal}**, portador(a) do CPF nº **{CPF}**, na qualidade de empresário(a) e representante legal da empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, sediada em **{Endereco}**, declaro, para efeito de Registro Cadastral e habilitação perante **{OrgaoComprador}** ({NumeroPregao}), vir a informar qualquer fato superveniente impeditivo de licitar ou contratar com a Administração Pública que venha a ocorrer no período de validade do Certificado de Registro Cadastral, comprometendo-me ainda a manter atualizada a Certidão Negativa de Débito perante as Fazendas Municipal, Estadual e Federal, inclusive Instituto Nacional de Seguridade Social - INSS e Fundo de Garantia por Tempo de Serviço - FGTS.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_me_epp",
    title: "Declaração Específica de Enquadramento como ME / EPP (LC 123/2006)",
    category: "declaracoes",
    description: "Declaração de enquadramento como Microempresa ou Empresa de Pequeno Porte nos termos do art. 3º da Lei Complementar nº 123/2006.",
    badgeText: "LC nº 123/2006",
    defaultMarkdown: `# DECLARAÇÃO DE ENQUADRAMENTO COMO MICROEMPRESA (ME) OU EMPRESA DE PEQUENO PORTE (EPP)

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, por intermédio de seu representante legal abaixo identificado, **DECLARA**, sob as sanções administrativas cabíveis e sob as penas da lei, perante **{OrgaoComprador}** ({NumeroPregao}), que:

- Enquadra-se na condição de **MICROEMPRESA (ME) / EMPRESA DE PEQUENO PORTE (EPP)**, nos termos estabelecidos no art. 3º, incisos I e II, da Lei Complementar Federal nº 123, de 14 de dezembro de 2006;
- A receita bruta auferida no ano-calendário anterior e no exercício corrente não excede o limite legal de R$ 4.800.000,00 (quatro milhões e oitocentos mil reais);
- Não incorre em nenhuma das hipóteses de impedimento ou vedação previstas no § 4º do art. 3º da Lei Complementar nº 123/2006;
- Está apta a usufruir de todos os benefícios, tratamento diferenciado, direito de preferência e prazo estendido para regularização fiscal concedidos pela legislação vigente.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_dispensa_balanco",
    title: "Declaração de Dispensa de Balanço Patrimonial (MEI / SIMEI)",
    category: "declaracoes",
    description: "Declaração de desobrigação legal de apresentação de Balanço Patrimonial com fundamento no Art. 1.179, § 2º do Código Civil e Art. 68 da LC 123/2006.",
    badgeText: "Art. 1.179 § 2º CC",
    defaultMarkdown: `# DECLARAÇÃO DE DISPENSA DE BALANÇO PATRIMONIAL

Eu, **{RepresentanteLegal}**, titular e representante legal da empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}:

**DECLARO**, sob as penas da lei e para os devidos fins de habilitação e cadastro de fornecedor junto a **{OrgaoComprador}** ({NumeroPregao}), que a empresa está enquadrada como **Microempreendedor Individual (MEI)**, optante pelo Sistema de Recolhimento em Valores Fixos Mensais dos Tributos abrangidos pelo Simples Nacional (SIMEI).

Por tal razão, a empresa está **legalmente desobrigada da elaboração e apresentação do Balanço Patrimonial e demais demonstrações contábeis**, com fundamento no **Art. 1.179, § 2º da Lei nº 10.406/2002 (Código Civil)** e no **Art. 68 da Lei Complementar nº 123/2006**, juntando em anexo a Declaração Anual Simplificada (DASN-SIMEI) do último exercício.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_titularidade_representacao",
    title: "Declaração de Titularidade e Representação Legal",
    category: "declaracoes",
    description: "Declara atuação direta do titular na administração e representação legal da empresa, dispensando procuração a terceiros.",
    badgeText: "Representação Legal",
    defaultMarkdown: `# DECLARAÇÃO DE TITULARIDADE E REPRESENTAÇÃO LEGAL

Eu, **{RepresentanteLegal}**, inscrito(a) no CPF sob o nº **{CPF}** e portador(a) do RG nº **[RG DO REPRESENTANTE]**, na qualidade de titular e único(a) representante legal da empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}:

**DECLARO**, para os devidos fins de cadastro e participação em certames públicos perante **{OrgaoComprador}** ({NumeroPregao}), que atuo em nome próprio na administração da empresa, exercendo pessoalmente todos os atos de gestão e representação legal, dispensando procuração a terceiros por tratar-se de Microempreendedor Individual (MEI) / Titular Administrador.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_dispensa_ato_publico_baixo_risco",
    title: "Declaração de Dispensa de Ato Público – Baixo Risco (Lei 13.874/2019)",
    category: "declaracoes",
    description: "Comprova enquadramento como atividade de baixo risco (Nível de Risco I - Lei da Liberdade Econômica), dispensada de alvará/licença prévia.",
    badgeText: "Lei 13.874/2019",
    defaultMarkdown: `# DECLARAÇÃO DE DISPENSA DE ATO PÚBLICO – BAIXO RISCO

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em **{Endereco}**, neste ato representada na forma de seu ato constitutivo, **DECLARA**, para fins de comprovação perante **{OrgaoComprador}** ({NumeroPregao}):

1. Que se encontra em **situação cadastral ativa** perante a Receita Federal do Brasil, exercendo atividades econômicas registradas no Cadastro Nacional da Pessoa Jurídica compatíveis com **{Objeto}** e demais atividades constantes em seu comprovante de inscrição;
2. Que, nos termos da **Lei nº 13.874/2019** (Lei da Liberdade Econômica) e das diretrizes aplicáveis à classificação de risco de atividades econômicas, a atividade enquadrada como de **baixo risco** (Nível de Risco I), quando exercida em conformidade com as normas urbanísticas, sanitárias, ambientais e de segurança aplicáveis ao local, está **dispensada de atos públicos prévios de liberação** para o seu exercício;
3. Que tem ciência de que a dispensa de exigência prévia de licença ou alvará para atividades de baixo risco **não afasta** o dever de observância às normas legais cabíveis, tampouco impede a fiscalização posterior pelos órgãos competentes, bem como se compromete a apresentar eventuais licenças específicas caso o escopo contratado exija autorização própria.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_nao_sujeicao_conselho",
    title: "Declaração de Não Sujeição a Registro em Conselho Profissional",
    category: "declaracoes",
    description: "Declara inexistência de obrigatoriedade de registro em conselho de classe (CRA, CREA, etc.) nos termos do Art. 1º da Lei nº 6.839/1980 e STJ/TCU.",
    badgeText: "Lei 6.839/1980 • TCU",
    defaultMarkdown: `# DECLARAÇÃO DE NÃO SUJEIÇÃO A REGISTRO EM CONSELHO PROFISSIONAL

Eu, **{RepresentanteLegal}**, titular e representante legal da empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}:

**DECLARO**, sob as penas da lei e para os devidos fins de habilitação e cadastro de fornecedor junto a **{OrgaoComprador}** ({NumeroPregao}):

1. Que a empresa tem como atividade econômica o fornecimento/prestação de **{Objeto}** e serviços correlatos;
2. Que, nos termos do **Art. 1º da Lei Federal nº 6.839/1980**, a obrigatoriedade de registro em conselhos de fiscalização profissional é definida em razão da atividade básica ou dos serviços prestados a terceiros;
3. Que as atividades desempenhadas no objeto deste certame **não são regulamentadas por conselho de classe profissional específico**, inexistindo qualquer obrigatoriedade de registro da empresa ou de responsável técnico perante órgãos como CRA, CREA ou similares, conforme jurisprudência pacífica e consolidada do **Superior Tribunal de Justiça (STJ)** e do **Tribunal de Contas da União (TCU)**.

Por ser a expressão da verdade, firmo a presente declaração.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_inexistencia_patrimonio_imobiliario",
    title: "Declaração de Inexistência de Patrimônio Imobiliário (IPTU)",
    category: "declaracoes",
    description: "Declara que a pessoa jurídica não possui bens imóveis registrados sob seu CNPJ, inexistindo inscrição imobiliária ou débitos de IPTU.",
    badgeText: "Regularidade Imobiliária",
    defaultMarkdown: `# DECLARAÇÃO DE INEXISTÊNCIA DE PATRIMÔNIO IMOBILIÁRIO

Eu, **{RepresentanteLegal}**, titular e representante legal da empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}:

**DECLARO**, sob as penas da lei e para os devidos fins de cadastro de fornecedor e habilitação junto a **{OrgaoComprador}** ({NumeroPregao}), que a pessoa jurídica acima qualificada **não possui bens imóveis registrados em seu patrimônio ou sob a inscrição do seu CNPJ** junto ao Cadastro Imobiliário do Município de sua sede ou de qualquer outro município.

Informo que as atividades comerciais são exercidas em imóvel residencial/de terceiros, razão pela qual inexiste cadastro imobiliário ou fato gerador de débitos de IPTU vinculados ao CNPJ da empresa declarante.

Por ser a expressão da verdade, firmo a presente declaração.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "procuracao_particular_licitacoes",
    title: "Procuração Particular para Gestão e Operação em Licitações",
    category: "procuracoes_atestados",
    description: "Instrumento particular de mandato conferindo poderes amplos para credenciamento, propostas, lances, declarações e recursos em portais públicos.",
    badgeText: "Mandato Licitatório",
    defaultMarkdown: `# INSTRUMENTO PARTICULAR DE PROCURAÇÃO

**OUTORGANTE:** **{RazaoSocial}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, neste ato representada por seu(sua) Sócio(a) Administrador(a) / Titular, **{RepresentanteLegal}**, portador(a) do RG nº **[RG DO OUTORGANTE]** e inscrito(a) no CPF sob o nº **{CPF}**.

**OUTORGADO(A):** **[NOME DO OUTORGADO / PROCURADOR]**, brasileiro(a), portador(a) do RG nº **[RG DO OUTORGADO]** e inscrito(a) no CPF sob o nº **[CPF DO OUTORGADO]**, residente e domiciliado(a) em **[CIDADE - UF DO OUTORGADO]**.

**PODERES:** Pelo presente instrumento particular de mandato, a OUTORGANTE confere ao(à) OUTORGADO(A) amplos poderes para representá-la perante **{OrgaoComprador}** e quaisquer órgãos e entidades da Administração Pública Direta e Indireta (Federal, Estadual e Municipal), bem como em portais eletrônicos de compras públicas (Compras.gov.br, Comprasnet, Licitações-e, BLL Compras, e-Lic, LicitaNet, entre outros), podendo para tanto:
- Cadastrar, credenciar e atualizar a empresa em sistemas e cadastros públicos (SICAF, CAF Digital, etc.);
- Elaborar, assinar e enviar propostas comerciais de preços, planilhas orçamentárias e documentos de habilitação;
- Participar de sessões públicas presenciais e eletrônicas ({NumeroPregao}), ofertando lances, descontos e negociando valores;
- Firmar declarações formais exigidas em editais;
- Manifestar intenção de recurso, interpor recursos administrativos, apresentar contrarrazões e impugnações;
- Receber notificações, intimações, atas de registro de preços, autorizações de fornecimento e ordens de serviço;
- Praticar todos os atos indispensáveis ao bom e fiel cumprimento deste mandato licitatório.

**PRAZO DE VALIDADE:** O presente mandato terá vigência pelo prazo de 12 (doze) meses a contar da data de sua assinatura.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "atested_capacidade",
    title: "Minuta de Atestado de Capacidade Técnica",
    category: "procuracoes_atestados",
    description: "Minuta estruturada de Atestado de Capacidade Técnica comprovando fornecimento/execução regular e satisfatória do objeto contratado.",
    badgeText: "Qualificação Técnica",
    defaultMarkdown: `# ATESTADO DE CAPACIDADE TÉCNICA

Atestamos para os devidos fins de direito, sob as penas da Lei, que a empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, estabelecida em {Endereco}, prestou a **{OrgaoComprador}** serviços/fornecimento na área de **{Objeto}**, cumprindo fielmente com todas as obrigações pactuadas.

Os serviços foram executados e entregues dentro do prazo estabelecido, de forma regular e satisfatória, em conformidade com as especificações exigidas e com o padrão de qualidade técnico demandado, conforme detalhado a seguir:

| CONTRATANTE | {OrgaoComprador} (CNPJ: [CNPJ DO ÓRGÃO CONTRATANTE]) |
| :--- | :--- |
| **CONTRATADO** | **{RazaoSocial}** (CNPJ: {CNPJ}) |
| **OBJETO DO SERVIÇO** | **{Objeto}** |
| **FUNDAMENTO LEGAL** | Lei Federal nº 14.133/2021 — Processo / Ref.: {NumeroPregao} |
| **NOTA DE EMPENHO** | [NÚMERO DA NOTA DE EMPENHO / CONTRATO] |

Por ser a expressão da verdade e em virtude do fiel cumprimento do contrato, expedimos o presente atestado de capacidade técnica para que produza os seus devidos efeitos legais junto a processos licitatórios futuros.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "pedido_esclarecimento_tecnico",
    title: "Pedido de Esclarecimento Técnico (Art. 164 da Lei 14.133/2021)",
    category: "recursos",
    description: "Pedido formal de esclarecimento técnico dividido em Ponto de Dúvida (O Fato), Fundamentação (O Direito) e Questionamento Objetivo em destaque.",
    badgeText: "Art. 164 - Lei 14.133",
    defaultMarkdown: `# PEDIDO DE ESCLARECIMENTO TÉCNICO

**AO(À) {OrgaoComprador} — A/C: AGENTE DE CONTRATAÇÃO / PREGOEIRO(A)**  
**REF.: {NumeroPregao}**

A empresa **{RazaoSocial}**, pessoa jurídica de direito privado inscrita no CNPJ sob o nº **{CNPJ}**, vem, respeitosamente, com fundamento no art. 164 da Lei Federal nº 14.133/2021, apresentar tempestivamente este **PEDIDO DE ESCLARECIMENTO**, visando garantir a segurança jurídica na formulação da proposta e assegurar a ampla concorrência do certame.

### 1. O PONTO DE DÚVIDA (O FATO)
Na descrição técnica do Termo de Referência referente a **{Objeto}**, a Administração especificou exigência que demanda confirmação quanto à aceitabilidade de solução/produto com características técnicas equivalentes ou superiores ([ESPECIFICAR ITEM DO TERMO DE REFERÊNCIA]).

### 2. A FUNDAMENTAÇÃO (O DIREITO)
A Nova Lei de Licitações (Lei nº 14.133/2021, art. 41, I) e a Súmula 270 do Tribunal de Contas da União (TCU) vedam especificações restritivas ou direcionamento de marca que limitem a disputa, assegurando o princípio da isonomia e a seleção da proposta mais vantajosa.

### 3. O QUESTIONAMENTO OBJETIVO
Para que não restem dúvidas no julgamento das propostas e garantindo que não haverá desclassificação indevida:

> **O(A) {OrgaoComprador} ACEITARÁ propostas e habilitará produtos/soluções que possuam características técnicas equivalentes ou superiores às descritas no Termo de Referência para {Objeto}, desde que cumpram 100% da finalidade exigida no Edital?**

Certos do compromisso desta Administração com a legalidade e a competitividade, aguardamos o esclarecimento.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "declaracao_unificada",
    title: "Declaração Unificada de Habilitação (Lei 14.133/2021)",
    category: "declaracoes",
    description: "Declaração unificada abrangendo atendimento aos requisitos de habilitação (Art. 63, I), reserva de cargos (Art. 63, IV), menor de idade e idoneidade.",
    badgeText: "Unificada Completa",
    defaultMarkdown: `# DECLARAÇÃO UNIFICADA DE HABILITAÇÃO E REGULARIDADE

A empresa **{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, sediada em {Endereco}, por intermédio de seu representante legal infra-assinado, **DECLARA**, sob as penas da Lei e para fins do certame **{NumeroPregao}** perante **{OrgaoComprador}**, que:

1. **Requisitos de Habilitação (Art. 63, I, Lei 14.133/2021):** Atende plenamente aos requisitos de habilitação exigidos no Edital, respondendo pela veracidade das informações prestadas;
2. **Reserva de Cargos (Art. 63, IV):** Cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas;
3. **Integralidade dos Custos (Art. 63, § 1º):** Sua proposta econômica compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal e legislação vigente;
4. **Proibição de Trabalho Infantil (Art. 68, VI e Art. 7º, XXXIII, CF):** Não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 anos, salvo na condição de aprendiz a partir de 14 anos;
5. **Ausência de Trabalho Degradante (Art. 1º, III e IV, e Art. 5º, III, CF):** Não possui, em sua cadeia produtiva, empregados executando trabalho degradante ou forçado.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "impugnacao_edital",
    title: "Petição de Impugnação ao Edital (Art. 164 da Lei 14.133/2021)",
    category: "recursos",
    description: "Peça jurídica formal para impugnar cláusulas restritivas, ilegais ou desproporcionais do instrumento convocatório.",
    badgeText: "Impugnação Formal",
    defaultMarkdown: `# PETIÇÃO DE IMPUGNAÇÃO AO EDITAL DE LICITAÇÃO

**AO(À) ILMO(A). PREGOEIRO(A) / AGENTE DE CONTRATAÇÃO — {OrgaoComprador}**  
**REF.: {NumeroPregao}**

**{RazaoSocial}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em **{Endereco}**, vem, tempestivamente, com fulcro no art. 164 da Lei nº 14.133/2021, apresentar **IMPUGNAÇÃO AO EDITAL**, pelos fundamentos a seguir:

### 1. DA TEMPESTIVIDADE E DOS FATOS
O certame **{NumeroPregao}** tem por objeto **{Objeto}**. A presente impugnação é tempestiva (art. 164 da Lei 14.133/2021). Ao analisar o edital, constatou-se exigência restritiva que compromete o caráter competitivo do certame ([DESCREVER A CLÁUSULA IMPUGNADA]).

### 2. DOS FUNDAMENTOS E DO PEDIDO
A exigência afronta os princípios da **competitividade, isonomia e razoabilidade** (arts. 5º e 9º da Lei nº 14.133/2021) e a jurisprudência do TCU. Diante do exposto, requer o acolhimento da presente Impugnação para **retificar o Edital**, com a consequente republicação e reabertura de prazo nos termos do art. 55, § 1º, da Lei nº 14.133/2021.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  },
  {
    id: "recurso_administrativo",
    title: "Recurso Administrativo Licitatório (Art. 165 da Lei 14.133/2021)",
    category: "recursos",
    description: "Minuta jurídica de Recurso Administrativo para reformar decisão de inabilitação ou desclassificação em certame público.",
    badgeText: "Art. 165 - Lei 14.133",
    defaultMarkdown: `# RECURSO ADMINISTRATIVO LICITATÓRIO

**À AUTORIDADE SUPERIOR E AO(À) PREGOEIRO(A) — {OrgaoComprador}**  
**REF.: {NumeroPregao}**

**{RazaoSocial}**, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, inconformada com a decisão proferida no certame **{NumeroPregao}** (Objeto: **{Objeto}**), vem interpor **RECURSO ADMINISTRATIVO**, com fulcro no art. 165, inciso I, da Lei Federal nº 14.133/2021.

### 1. DAS RAZÕES DE FATO E DE DIREITO
A decisão recorrida merece reforma, pois a Recorrente cumpriu integralmente as exigências materiais do edital. Conforme entendimento pacífico do TCU (Acórdão nº 1.211/2021 - Plenário) e do art. 64 da Lei nº 14.133/2021, o formalismo moderado e a busca pela proposta mais vantajosa impõem o aproveitamento de atos que comprovem a plena aptidão da licitante.

### 2. DO PEDIDO
Ante o exposto, requer a reconsideração da decisão (art. 165, § 2º, da Lei nº 14.133/2021) ou o **PROVIMENTO** do recurso pela Autoridade Superior, declarando a Recorrente habilitada e classificada.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`
  }
];

function extractCityFromAddress(address?: string): string {
  if (!address || !address.trim()) return "[CIDADE - UF]";
  const match = address.match(/([A-Za-zÀ-ÖØ-öø-ÿ\s]+)\s*[-–/]\s*([A-Z]{2})\b/);
  if (match && match[1] && match[2]) {
    const cityParts = match[1].split(",");
    const cleanCity = cityParts[cityParts.length - 1].trim();
    if (cleanCity.length >= 2) {
      return `${cleanCity} - ${match[2]}`;
    }
  }
  return "[CIDADE - UF]";
}

/**
 * Separa o corpo do documento do bloco de assinatura final ("_____..."),
 * garantindo que TODAS as documentações exibam exatamente o bloco de assinatura
 * centralizado padrão no fim da folha, sem duplicação e sem desalinhamento.
 */
function parseBodyAndSignature(
  markdown: string,
  fallbackName: string,
  fallbackCpf: string,
  fallbackCnpj: string
): {
  bodyMarkdown: string;
  sigName: string;
  sigRole: string;
  sigDocs: string;
} {
  const defaultSigName = fallbackName;
  const defaultSigRole = "Representante Legal / Titular";
  const defaultSigDocs = `CPF: ${fallbackCpf} | CNPJ: ${fallbackCnpj}`;

  const lines = markdown.split(/\r?\n/);
  const underscoreIdx = lines.findIndex(l => /^_{5,}/.test(l.trim()));

  if (underscoreIdx === -1) {
    return {
      bodyMarkdown: markdown.trim(),
      sigName: defaultSigName,
      sigRole: defaultSigRole,
      sigDocs: defaultSigDocs
    };
  }

  const bodyMarkdown = lines.slice(0, underscoreIdx).join("\n").trim();
  const afterLines = lines
    .slice(underscoreIdx + 1)
    .map(l => l.replace(/\*\*/g, "").trim())
    .filter(Boolean);

  const sigName = afterLines[0] || defaultSigName;
  const sigRole = afterLines[1] || defaultSigRole;
  const sigDocs = afterLines[2] || defaultSigDocs;

  return {
    bodyMarkdown,
    sigName,
    sigRole,
    sigDocs
  };
}

export default function CreateDocTab({
  companyData,
  activeEdital,
  initialTemplateId
}: CreateDocTabProps) {
  const editalHistory = useEditalHistory();

  // Custom user-created templates stored in localStorage
  const [customTemplates, setCustomTemplates] = useState<DocumentTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const allTemplates = [...TEMPLATES_CATALOG, ...customTemplates];

  // Category filter & search
  const [activeCategory, setActiveCategory] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showCatalogGrid, setShowCatalogGrid] = useState<boolean>(true);

  // Selected template
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate>(
    () => allTemplates.find(t => t.id === initialTemplateId) || TEMPLATES_CATALOG[0]
  );

  // Edital Selection & Attachment Options
  const [analyzedEditais, setAnalyzedEditais] = useState<EditalAnalysis[]>([]);
  const [selectedEditalIndex, setSelectedEditalIndex] = useState<number>(0);
  const [editalSourceMode, setEditalSourceMode] = useState<"analyzed" | "new">("analyzed");
  const [newEditalText, setNewEditalText] = useState<string>("");
  const [newEditalFileName, setNewEditalFileName] = useState<string>("");

  // AI Fill Options
  const [useCompanyContext, setUseCompanyContext] = useState<boolean>(true);

  // Helper to get active selected edital
  const getCurrentEdital = (): EditalAnalysis | null => {
    if (editalSourceMode === "analyzed") {
      return analyzedEditais[selectedEditalIndex] || activeEdital || null;
    }
    return activeEdital || null;
  };

  // Helper to substitute placeholders with real data or anonymized bracketed placeholders
  const applyLocalSubstitutions = (
    templateText: string,
    editalOverride?: EditalAnalysis | null,
    useCompanyOverride?: boolean
  ): string => {
    const useCompany = useCompanyOverride !== undefined ? useCompanyOverride : useCompanyContext;
    const today = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
    const localStr = useCompany ? extractCityFromAddress(companyData.address) : "[CIDADE - UF]";

    let result = templateText;

    // Company Data (with safe anonymized placeholders when empty or disabled)
    const razao = useCompany && companyData.razonSocial?.trim()
      ? companyData.razonSocial.trim()
      : "[RAZÃO SOCIAL DA EMPRESA]";
    const cnpj = useCompany && companyData.cnpj?.trim()
      ? companyData.cnpj.trim()
      : "[CNPJ DA EMPRESA]";
    const endereco = useCompany && companyData.address?.trim()
      ? companyData.address.trim()
      : "[ENDEREÇO COMPLETO DA EMPRESA]";
    const telefone = useCompany && companyData.phone?.trim()
      ? companyData.phone.trim()
      : "[TELEFONE / WHATSAPP DA EMPRESA]";
    const email = useCompany && companyData.email?.trim()
      ? companyData.email.trim()
      : "[E-MAIL DA EMPRESA]";
    const representante = useCompany && companyData.representativeName?.trim()
      ? companyData.representativeName.trim()
      : "[NOME DO REPRESENTANTE LEGAL]";
    const cpf = useCompany && companyData.representativeCpf?.trim()
      ? companyData.representativeCpf.trim()
      : "[CPF DO REPRESENTANTE]";
    const dadosBancarios = useCompany && companyData.bankDetails?.trim()
      ? companyData.bankDetails.trim()
      : "[BANCO | AGÊNCIA | CONTA BANCÁRIA]";

    result = result.replace(/{RazaoSocial}/g, razao);
    result = result.replace(/{CNPJ}/g, cnpj);
    result = result.replace(/{Endereco}/g, endereco);
    result = result.replace(/{Telefone}/g, telefone);
    result = result.replace(/{Email}/g, email);
    result = result.replace(/{RepresentanteLegal}/g, representante);
    result = result.replace(/{CPF}/g, cpf);
    result = result.replace(/{DadosBancarios}/g, dadosBancarios);
    result = result.replace(/{Banco}/g, dadosBancarios.split("|")[0]?.trim() || "[BANCO]");
    result = result.replace(/{Agencia}/g, "[AGÊNCIA]");
    result = result.replace(/{Conta}/g, "[CONTA]");

    // Edital Analysis Data (with anonymized placeholders when no edital is selected)
    const targetEdital = editalOverride !== undefined ? editalOverride : getCurrentEdital();
    if (targetEdital) {
      const orgao = targetEdital.identificacaoCertame?.orgaoComprador?.trim() || "[NOME DO ÓRGÃO]";
      const mod = targetEdital.identificacaoCertame?.modalidade?.trim() || "";
      const rawNum = targetEdital.identificacaoCertame?.identificacaoNumerica?.trim() || "";
      const pregao = rawNum
        ? mod && !rawNum.toLowerCase().includes(mod.split(" ")[0].toLowerCase())
          ? `${mod} — ${rawNum}`
          : rawNum
        : mod || "[NÚMERO DO EDITAL / PROCESSO]";
      const objeto = targetEdital.descricaoProduto?.trim() || "[OBJETO DA LICITAÇÃO]";
      const prazo =
        targetEdital.prazoEntrega?.trim() ||
        targetEdital.logisticaCronograma?.prazoEntregaReal?.trim() ||
        "Conforme estipulado no Termo de Referência do Edital";
      const pagamento =
        targetEdital.prazoPagamento?.trim() ||
        targetEdital.viabilidadeFinanceira?.prazoPagamento?.trim() ||
        "Em até 30 (trinta) dias corridos após entrega e atesto da Nota Fiscal";
      const valor = targetEdital.viabilidadeFinanceira?.valorEstimado?.trim() || "R$ [INSERIR VALOR]";

      // Se for Proposta Comercial e o edital possuir itens extraídos, preenche automaticamente a tabela de itens
      if (Array.isArray(targetEdital.itensEdital) && targetEdital.itensEdital.length > 0) {
        const defaultProposalRow =
          "| **01** | **{Objeto}** — Especificações completas conforme Termo de Referência do Edital. | 01 | Unid. | [MARCA / MODELO] | 12 Meses | {ValorEstimado} | {ValorEstimado} |";
        if (result.includes(defaultProposalRow)) {
          const itemRows = targetEdital.itensEdital.slice(0, 8).map((it, idx) => {
            const numStr = String(it.numero ?? idx + 1).padStart(2, "0");
            const descStr = (it.descricao || objeto).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
            const qtdNum = Number(it.quantidade) || 1;
            const unidStr = (it.unidade || "Unid.").replace(/\|/g, "/").trim();
            const unitStr = (it.valorEstimado || valor).replace(/\|/g, "/").trim();

            let totalStr = unitStr;
            const numericMatch = unitStr.match(/([0-9.]+,[0-9]{2})/);
            if (numericMatch) {
              const unitFloat = parseFloat(numericMatch[1].replace(/\./g, "").replace(",", "."));
              if (!isNaN(unitFloat)) {
                totalStr = `R$ ${(unitFloat * qtdNum).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}`;
              }
            }

            return `| **${numStr}** | ${descStr} | ${qtdNum} | ${unidStr} | [MARCA / MODELO] | 12 Meses | ${unitStr} | ${totalStr} |`;
          });
          result = result.replace(defaultProposalRow, itemRows.join("\n"));
        }
      }

      result = result.replace(/{OrgaoComprador}/g, orgao);
      result = result.replace(/{NumeroPregao}/g, pregao);
      result = result.replace(/{Objeto}/g, objeto);
      result = result.replace(/{PrazoEntrega}/g, prazo);
      result = result.replace(/{PrazoPagamento}/g, pagamento);
      result = result.replace(/{ValorEstimado}/g, valor);
    } else {
      result = result.replace(/{OrgaoComprador}/g, "[NOME DO ÓRGÃO]");
      result = result.replace(/{NumeroPregao}/g, "[NÚMERO DO EDITAL / PROCESSO]");
      result = result.replace(/{Objeto}/g, "[OBJETO DA LICITAÇÃO]");
      result = result.replace(/{PrazoEntrega}/g, "[PRAZO DE ENTREGA CONFORME EDITAL]");
      result = result.replace(/{PrazoPagamento}/g, "Em até 30 (trinta) dias corridos após atesto da Nota Fiscal");
      result = result.replace(/{ValorEstimado}/g, "R$ [INSERIR VALOR]");
    }

    result = result.replace(/{Local}/g, localStr);
    result = result.replace(/{DataAtual}/g, today);

    return result;
  };

  // Document title and markdown content
  const [docTitle, setDocTitle] = useState<string>(() => selectedTemplate.title);
  const [documentContent, setDocumentContent] = useState<string>(() =>
    applyLocalSubstitutions(selectedTemplate.defaultMarkdown, activeEdital)
  );

  // Edit mode on the A4 sheet
  const [editorMode, setEditorMode] = useState<"visual" | "markdown">("visual");
  const [singlePageCompact, setSinglePageCompact] = useState<boolean>(true);

  // Modal state when user clicks on a Document Template Card to pick an analyzed edital or upload a doc
  const [pendingTemplateForModal, setPendingTemplateForModal] = useState<DocumentTemplate | null>(null);
  const [modalEditalTab, setModalEditalTab] = useState<"analyzed" | "upload">("analyzed");
  const [modalEditalSearch, setModalEditalSearch] = useState<string>("");
  const [modalUploadFiles, setModalUploadFiles] = useState<
    Array<{ id: string; name: string; size: string; type: string; base64?: string; textContent?: string }>
  >([]);
  const [modalUploadText, setModalUploadText] = useState<string>("");
  const [isAnalyzingModalUpload, setIsAnalyzingModalUpload] = useState<boolean>(false);
  const [modalUploadError, setModalUploadError] = useState<string | null>(null);

  // Custom New Document Creator Modal State
  const [showCreateCustomModal, setShowCreateCustomModal] = useState<boolean>(false);
  const [customDocTitle, setCustomDocTitle] = useState<string>("");
  const [customDocCategory, setCustomDocCategory] = useState<DocumentTemplate["category"]>("declaracoes");
  const [customDocInstructions, setCustomDocInstructions] = useState<string>("");
  const [saveCustomToCatalog, setSaveCustomToCatalog] = useState<boolean>(true);
  const [isCreatingCustomDoc, setIsCreatingCustomDoc] = useState<boolean>(false);

  // AI Assist / Inline Copilot
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [aiAssistPrompt, setAiAssistPrompt] = useState<string>("");
  const [showAiAssist, setShowAiAssist] = useState<boolean>(false);

  // Fullscreen Editing Mode
  const [isFullscreenDocs, setIsFullscreenDocs] = useState<boolean>(false);

  // Download Dropdown Menu open state
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);

  // Drafts history
  const [draftsList, setDraftsList] = useState<Array<{ id: string; title: string; date: string; content: string }>>([]);
  const [showDraftsModal, setShowDraftsModal] = useState<boolean>(false);

  // Notification States
  const [copied, setCopied] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [emittedBanner, setEmittedBanner] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Ref for the editable A4 paper sheet div
  const paperEditableRef = useRef<HTMLDivElement>(null);
  const a4SectionRef = useRef<HTMLDivElement>(null);

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
      editalHistory.forEach(item => {
        const editalObj = item.analysis;
        if (editalObj && (editalObj.identificacaoCertame || editalObj.descricaoProduto)) {
          const exists = list.some(
            e =>
              (e.identificacaoCertame?.identificacaoNumerica &&
                e.identificacaoCertame?.identificacaoNumerica === editalObj.identificacaoCertame?.identificacaoNumerica &&
                e.identificacaoCertame?.orgaoComprador === editalObj.identificacaoCertame?.orgaoComprador) ||
              (e.descricaoProduto &&
                e.descricaoProduto === editalObj.descricaoProduto &&
                e.identificacaoCertame?.orgaoComprador === editalObj.identificacaoCertame?.orgaoComprador)
          );
          if (!exists) list.push(editalObj);
        }
      });
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
  }, [activeEdital, editalHistory]);

  // Select template & emit in 1 click
  const handleSelectTemplate = (template: DocumentTemplate, editalOverride?: EditalAnalysis | null, scrollToPaper?: boolean) => {
    const targetEdital = editalOverride !== undefined ? editalOverride : getCurrentEdital();
    setSelectedTemplate(template);
    const orgaoShort = targetEdital?.identificacaoCertame?.orgaoComprador
      ? ` — ${targetEdital.identificacaoCertame.orgaoComprador.slice(0, 38)}`
      : "";
    const suffix = targetEdital?.identificacaoCertame?.identificacaoNumerica
      ? ` — ${targetEdital.identificacaoCertame.identificacaoNumerica}${orgaoShort}`
      : orgaoShort;
    setDocTitle(`${template.title}${suffix}`);
    const filledText = applyLocalSubstitutions(template.defaultMarkdown, targetEdital);
    setDocumentContent(filledText);

    const orgaoLabel = targetEdital?.identificacaoCertame?.orgaoComprador || "órgão licitante";
    setEmittedBanner(
      targetEdital
        ? `Documento "${template.title}" gerado com os dados de ${orgaoLabel}, informações do edital e dados da sua empresa!`
        : `Documento "${template.title}" preenchido com os dados da sua empresa!`
    );
    setTimeout(() => setEmittedBanner(null), 6000);

    if (scrollToPaper && a4SectionRef.current) {
      setTimeout(() => {
        a4SectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 90);
    }
  };

  // Open the modal to choose which analyzed Edital or upload a new Edital when clicking a template card
  const handleOpenTemplateEditalModal = (template: DocumentTemplate) => {
    setPendingTemplateForModal(template);
    setModalEditalTab(analyzedEditais.length > 0 ? "analyzed" : "upload");
    setModalEditalSearch("");
    setModalUploadError(null);
  };

  // Confirm an existing analyzed Edital from the modal and emit immediately
  const handleConfirmAnalyzedEditalForTemplate = (edital: EditalAnalysis, indexInList: number) => {
    if (!pendingTemplateForModal) return;
    setEditalSourceMode("analyzed");
    setSelectedEditalIndex(indexInList);
    handleSelectTemplate(pendingTemplateForModal, edital, true);
    setPendingTemplateForModal(null);
    confetti({ particleCount: 40, spread: 55, origin: { y: 0.72 } });
  };

  // Process files uploaded inside the template modal
  const handleModalFilesProcess = (files: File[]) => {
    setModalUploadError(null);
    files.forEach((file) => {
      const lower = file.name.toLowerCase();
      let resolvedType = file.type;
      if (!resolvedType) {
        if (lower.endsWith(".pdf")) resolvedType = "application/pdf";
        else if (lower.endsWith(".docx"))
          resolvedType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (lower.endsWith(".doc")) resolvedType = "application/msword";
        else resolvedType = "text/plain";
      }

      if (resolvedType === "text/plain" || lower.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const textStr = (ev.target?.result as string) || "";
          setModalUploadFiles((prev) => [
            ...prev.filter((f) => f.name !== file.name),
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              size: `${(file.size / 1024).toFixed(1)} KB`,
              type: "text/plain",
              textContent: textStr
            }
          ]);
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const resultStr = (ev.target?.result as string) || "";
          const base64String = resultStr.includes(",") ? resultStr.split(",")[1] : resultStr;
          setModalUploadFiles((prev) => [
            ...prev.filter((f) => f.name !== file.name),
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              size: `${(file.size / 1024).toFixed(1)} KB`,
              type: resolvedType,
              base64: base64String
            }
          ]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // Analyze the uploaded Edital document and emit the selected template with agency + edital + company data
  const handleAnalyzeModalUploadAndEmit = async () => {
    if (!pendingTemplateForModal) return;
    if (modalUploadFiles.length === 0 && !modalUploadText.trim()) {
      setModalUploadError("Selecione um arquivo de edital (.PDF, .DOCX ou .TXT) ou cole os dados do certame.");
      return;
    }

    setIsAnalyzingModalUpload(true);
    setModalUploadError(null);

    try {
      const textFromTxtFiles = modalUploadFiles
        .filter((f) => f.textContent)
        .map((f) => `--- Arquivo: ${f.name} ---\n${f.textContent}`)
        .join("\n\n");
      const combinedTextInput = [modalUploadText.trim(), textFromTxtFiles].filter(Boolean).join("\n\n");

      const binaryFiles = modalUploadFiles
        .filter((f) => f.base64)
        .map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          type: f.type,
          base64: f.base64
        }));

      const preparedAttachments = await prepareAttachmentsForServer(binaryFiles);

      const response = await apiFetch("/api/analyze-edital", {
        method: "POST",
        body: {
          textInput: combinedTextInput,
          attachments: preparedAttachments
        }
      });

      if (!response.ok) {
        const errData = await readJsonResponseSafe(response);
        throw new Error(errData.error || errData.message || `Falha ao analisar documento (${response.status}).`);
      }

      const data = await readJsonResponse(response);
      if (!data?.analysis) {
        throw new Error("Não foi possível extrair os dados estruturados do edital enviado.");
      }

      const fileSummary =
        modalUploadFiles.length > 0
          ? modalUploadFiles.map((f) => f.name).join(", ")
          : "Edital enviado na emissão de documento";

      const analysisResult: EditalAnalysis = {
        ...data.analysis,
        pontosPositivos: Array.isArray(data.analysis.pontosPositivos) ? data.analysis.pontosPositivos : [],
        pontosAlerta: Array.isArray(data.analysis.pontosAlerta) ? data.analysis.pontosAlerta : [],
        documentosExigidos: Array.isArray(data.analysis.documentosExigidos) ? data.analysis.documentosExigidos : [],
        itensEdital: Array.isArray(data.analysis.itensEdital) ? data.analysis.itensEdital : [],
        camposNaoIdentificados: Array.isArray(data.analysis.camposNaoIdentificados)
          ? data.analysis.camposNaoIdentificados
          : [],
        rawText: combinedTextInput || fileSummary
      };

      const historyTitle =
        analysisResult.identificacaoCertame?.identificacaoNumerica &&
        analysisResult.identificacaoCertame?.orgaoComprador
          ? `${analysisResult.identificacaoCertame.identificacaoNumerica} - ${analysisResult.identificacaoCertame.orgaoComprador}`
          : analysisResult.identificacaoCertame?.orgaoComprador ||
            (analysisResult.descricaoProduto
              ? `Edital - ${analysisResult.descricaoProduto.slice(0, 48)}`
              : fileSummary);

      await addEditalToHistory(analysisResult, historyTitle);

      setAnalyzedEditais((prev) => [analysisResult, ...prev]);
      setSelectedEditalIndex(0);
      setEditalSourceMode("analyzed");

      const tplToEmit = pendingTemplateForModal;
      setPendingTemplateForModal(null);
      setModalUploadFiles([]);
      setModalUploadText("");

      handleSelectTemplate(tplToEmit, analysisResult, true);
      confetti({ particleCount: 55, spread: 65, origin: { y: 0.7 } });
    } catch (err: any) {
      console.error("Erro ao analisar edital no modal de documento:", err);
      setModalUploadError(formatAiError(err));
    } finally {
      setIsAnalyzingModalUpload(false);
    }
  };

  // Emit current selected template in 1 click
  const handleOneClickEmit = () => {
    const targetEdital = getCurrentEdital();
    const filledText = applyLocalSubstitutions(selectedTemplate.defaultMarkdown, targetEdital);
    const suffix = targetEdital?.identificacaoCertame?.identificacaoNumerica
      ? ` — ${targetEdital.identificacaoCertame.identificacaoNumerica}`
      : "";
    setDocTitle(`${selectedTemplate.title}${suffix}`);
    setDocumentContent(filledText);
    confetti({ particleCount: 35, spread: 55, origin: { y: 0.75 } });
    setEmittedBanner(`Documento "${selectedTemplate.title}" emitido em 1 clique!`);
    setTimeout(() => setEmittedBanner(null), 5000);
    a4SectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Delete custom template
  const handleDeleteCustomTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customTemplates.filter(t => t.id !== id);
    setCustomTemplates(updated);
    localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    if (selectedTemplate.id === id) {
      handleSelectTemplate(TEMPLATES_CATALOG[0]);
    }
  };

  // Create a brand new document not in the sent templates
  const handleCreateCustomDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDocTitle.trim()) return;

    setIsCreatingCustomDoc(true);
    const cleanTitle = customDocTitle.trim();
    const targetEdital = getCurrentEdital();

    const fallbackTemplateMarkdown = `# ${cleanTitle.toUpperCase()}

A empresa **{RazaoSocial}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº **{CNPJ}**, com sede em {Endereco}, por intermédio de seu representante legal infra-assinado, **{RepresentanteLegal}**, portador(a) do CPF nº **{CPF}**, perante **{OrgaoComprador}** ({NumeroPregao} — Objeto: **{Objeto}**), declara nos termos da Lei Federal nº 14.133/2021:

${
  customDocInstructions.trim()
    ? customDocInstructions.trim()
    : `1. Declaramos para os devidos fins de direito e de habilitação no certame {NumeroPregao} o pleno atendimento às exigências técnicas, jurídicas e operacionais relativas ao objeto ({Objeto}).\n2. Comprometemo-nos a cumprir integralmente todas as condições e prazos estabelecidos no Edital e seus anexos.`
}

Por ser a expressão da verdade, firma o presente documento para que produza os seus legítimos e jurídicos efeitos.

{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}`;

    let generatedTemplateMarkdown = fallbackTemplateMarkdown;

    try {
      const prompt = `Você é um Especialista Jurídico em Licitações Públicas (Lei Federal nº 14.133/2021).
Crie um modelo oficial, enxuto, objetivo e formal de documento licitatório que CAIBA INTEGRALMENTE EM 1 ÚNICA FOLHA A4.

TÍTULO DO NOVO DOCUMENTO SOLICITADO PELO USUÁRIO:
"${cleanTitle}"

INSTRUÇÕES / CLÁUSULAS ESPECÍFICAS DO USUÁRIO:
"${customDocInstructions.trim() || "Redigir documento completo, formal e juridicamente seguro de acordo com a Lei 14.133/2021."}"

REGRAS OBRIGATÓRIAS:
1. Use estas variáveis entre chaves para os dados variáveis (ou mantenha placeholders entre colchetes como [CNPJ DA EMPRESA], [NOME DO ÓRGÃO] quando necessário):
   - {RazaoSocial}, {CNPJ}, {Endereco}, {Telefone}, {Email}, {RepresentanteLegal}, {CPF}
   - {OrgaoComprador}, {NumeroPregao}, {Objeto}, {Local}, {DataAtual}
2. O documento deve ser conciso e direto sem campos supérfluos para caber perfeitamente em 1 única página A4.
3. Finalize OBRIGATORIAMENTE com local/data e o bloco de assinatura padrão de 3 linhas:
{Local}, {DataAtual}.

___________________________________________________
**{RepresentanteLegal}**
Representante Legal / Titular
CPF: {CPF} | CNPJ: {CNPJ}
4. Retorne APENAS o Markdown puro do documento, sem blocos de código (\`\`\`) e sem explicações.`;

      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }]
        }
      });

      if (response.ok) {
        const data = await readJsonResponse(response);
        if (data?.reply && !data?.degraded && !data.reply.trim().startsWith("⚠️") && data.reply.trim().length > 40) {
          generatedTemplateMarkdown = data.reply
            .replace(/^```markdown\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```$/i, "")
            .trim();
        }
      }
    } catch (err) {
      console.warn("Usando estrutura padrão formal para novo documento personalizado:", err);
    }

    const newTemplate: DocumentTemplate = {
      id: `custom_${Date.now()}`,
      title: cleanTitle,
      category: customDocCategory,
      description: customDocInstructions.trim() || "Modelo personalizado criado pelo usuário para emissão rápida em 1 clique.",
      badgeText: "Modelo Personalizado",
      defaultMarkdown: generatedTemplateMarkdown,
      isCustom: true
    };

    if (saveCustomToCatalog) {
      const updatedCustom = [newTemplate, ...customTemplates];
      setCustomTemplates(updatedCustom);
      localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updatedCustom));
    }

    setIsCreatingCustomDoc(false);
    setShowCreateCustomModal(false);
    setCustomDocTitle("");
    setCustomDocInstructions("");

    handleSelectTemplate(newTemplate, targetEdital, true);
    confetti({ particleCount: 45, spread: 60 });
  };

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
      const repName = getHeaderRepresentative();
      const repCpf = getHeaderCpf();
      const compCnpj = getHeaderCnpj();

      const companyContextStr = useCompanyContext
        ? `
[DADOS DA EMPRESA LICITANTE]
- Razão Social: ${companyData.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"}
- CNPJ: ${compCnpj}
- Endereço: ${companyData.address || "[ENDEREÇO COMPLETO DA EMPRESA]"}
- Telefone: ${companyData.phone || "[TELEFONE DA EMPRESA]"}
- E-mail: ${companyData.email || "[E-MAIL DA EMPRESA]"}
- Representante Legal: ${repName} (CPF: ${repCpf})
- Dados Bancários: ${companyData.bankDetails || "[BANCO | AGÊNCIA | CONTA BANCÁRIA]"}
`
        : `
[SIGILO / PLACEHOLDERS PADRONIZADOS]
Mantenha marcadores claros como [RAZÃO SOCIAL DA EMPRESA], [CNPJ DA EMPRESA], [ENDEREÇO DA EMPRESA], [NOME DO REPRESENTANTE LEGAL], [CPF DO REPRESENTANTE].
`;

      let editalContextStr = "";
      const selectedEdital = getCurrentEdital();
      if (editalSourceMode === "analyzed" && selectedEdital) {
        editalContextStr = `
[DADOS DO EDITAL ANALISADO SELECIONADO]
- Órgão Comprador: ${selectedEdital.identificacaoCertame?.orgaoComprador || "[NOME DO ÓRGÃO]"}
- Modalidade / Número do Edital: ${selectedEdital.identificacaoCertame?.identificacaoNumerica || "[NÚMERO DO EDITAL / PROCESSO]"}
- Objeto do Certame: ${selectedEdital.descricaoProduto || "[OBJETO DA LICITAÇÃO]"}
- Valor Estimado: ${selectedEdital.viabilidadeFinanceira?.valorEstimado || "R$ [INSERIR VALOR]"}
- Prazo de Entrega Exigido: ${selectedEdital.prazoEntrega || selectedEdital.logisticaCronograma?.prazoEntregaReal || "Conforme Edital"}
- Prazo de Pagamento: ${selectedEdital.prazoPagamento || selectedEdital.viabilidadeFinanceira?.prazoPagamento || "Conforme Edital"}
${selectedEdital.rawText ? `- Resumo do Edital: ${selectedEdital.rawText.slice(0, 1400)}` : ""}
`;
      } else if (editalSourceMode === "new" && newEditalText.trim()) {
        editalContextStr = `
[CONTEÚDO DO EDITAL FORNECIDO]
${newEditalText.trim().slice(0, 2200)}
`;
      }

      const userInstructionsStr = customPromptOverride
        ? `
[INSTRUÇÃO ESPECÍFICA DO USUÁRIO]
${customPromptOverride}
`
        : "";

      const prompt = `Você é o Especialista Jurídico e Comercial de Licitações Públicas (Lei Federal nº 14.133/2021).
Sua tarefa é preencher, adaptar ou aprimorar o documento abaixo de acordo com os dados da empresa do usuário e o edital analisado, otimizando o espaço para caber com folga em 1 ÚNICA FOLHA A4.

[MODELO BASE SELECIONADO]
Título: ${selectedTemplate.title}
Conteúdo Atual:
\`\`\`markdown
${documentContent}
\`\`\`

${companyContextStr}
${editalContextStr}
${userInstructionsStr}

REGRAS RÍGIDAS DE GERAÇÃO:
1. Retorne o documento COMPLETO em Markdown limpo e formal, sem blocos de código (\`\`\`) envolvendo a resposta.
2. Remova campos supérfluos ou repetitivos para economizar espaço vertical na folha A4.
3. Utilize apenas os dados da empresa do usuário e do edital selecionado. Onde faltar informação, use marcadores entre colchetes como [CNPJ DA EMPRESA], [NOME DO ÓRGÃO], [INSERIR VALOR].
4. O encerramento no fim da folha DEVE terminar exatamente com este bloco de assinatura de 3 linhas:
___________________________________________________
**${repName}**
Representante Legal / Titular
CPF: ${repCpf} | CNPJ: ${compCnpj}`;

      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: prompt }]
        }
      });

      if (!response.ok) {
        throw new Error(`Erro no servidor: ${response.status}`);
      }

      const data = await readJsonResponse(response);
      if (data?.degraded || (typeof data?.reply === "string" && data.reply.trim().startsWith("⚠️ **Resposta gerada localmente"))) {
        throw new Error(data?.reason || "A IA não respondeu no momento. Verifique sua chave de API em 'IA & Modelos'.");
      }
      if (data.reply) {
        const cleaned = data.reply
          .replace(/^```markdown\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();
        setDocumentContent(cleaned);
        confetti({ particleCount: 40, spread: 60 });
        setEmittedBanner("Documento otimizado pela IA para 1 folha A4 com assinatura padronizada!");
        setTimeout(() => setEmittedBanner(null), 5000);
      }
    } catch (err: any) {
      console.error("Erro na geração com o Agente IA:", err);
      setEmittedBanner(`Aviso: ${formatAiError(err)}`);
    } finally {
      setIsGenerating(false);
      setAiAssistPrompt("");
      setShowAiAssist(false);
    }
  };

  // Insert Table in paper
  const handleInsertTable = () => {
    const tableMd = `\n| Item | Descrição / Especificação | Qtd. | Unid. | Valor Unit. (R$) | Valor Total (R$) |\n| :---: | :--- | :---: | :---: | :---: | :---: |\n| **01** | [DESCRIÇÃO DO ITEM CONFORME EDITAL] | 01 | Unid | R$ [VALOR] | R$ [VALOR TOTAL] |\n\n`;
    setDocumentContent(prev => prev + tableMd);
  };

  // Insert Variable in paper
  const handleInsertVariable = (varName: string) => {
    setDocumentContent(prev => prev + ` ${varName} `);
  };

  // Header & Signature info helpers
  const getHeaderCompanyName = () =>
    useCompanyContext && companyData.razonSocial?.trim()
      ? companyData.razonSocial.trim()
      : "[RAZÃO SOCIAL DA EMPRESA]";
  const getHeaderCnpj = () =>
    useCompanyContext && companyData.cnpj?.trim() ? companyData.cnpj.trim() : "[CNPJ DA EMPRESA]";
  const getHeaderAddress = () =>
    useCompanyContext && companyData.address?.trim() ? companyData.address.trim() : "[ENDEREÇO DA EMPRESA]";
  const getHeaderPhone = () =>
    useCompanyContext && companyData.phone?.trim() ? companyData.phone.trim() : "[TELEFONE / WHATSAPP]";
  const getHeaderEmail = () =>
    useCompanyContext && companyData.email?.trim() ? companyData.email.trim() : "[E-MAIL DA EMPRESA]";
  const getHeaderRepresentative = () =>
    useCompanyContext && companyData.representativeName?.trim()
      ? companyData.representativeName.trim()
      : companyData.razonSocial?.trim() || "[NOME DO REPRESENTANTE LEGAL]";
  const getHeaderCpf = () =>
    useCompanyContext && companyData.representativeCpf?.trim()
      ? companyData.representativeCpf.trim()
      : "[CPF DO REPRESENTANTE]";

  // Render Formatted Single-Page A4 Document View with Standardized Bottom Signature
  const renderFormattedA4Document = (content: string, isEditable: boolean = true) => {
    const { bodyMarkdown, sigName, sigRole, sigDocs } = parseBodyAndSignature(
      content,
      getHeaderRepresentative(),
      getHeaderCpf(),
      getHeaderCnpj()
    );

    return (
      <div
        ref={paperEditableRef}
        contentEditable={isEditable && editorMode === "visual"}
        suppressContentEditableWarning={true}
        className={`official-a4-paper prose prose-slate max-w-none text-slate-900 font-sans selection:bg-sky-100 selection:text-sky-950 outline-none flex flex-col justify-between ${
          singlePageCompact ? "text-[11px] leading-[1.38] space-y-1.5" : "text-xs leading-relaxed space-y-2.5"
        } ${isEditable ? "focus:ring-2 focus:ring-sky-500/30 rounded p-0.5 transition-all" : ""}`}
        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
      >
        <div className="space-y-1.5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <div className="my-2 text-center">
                  <h1 className="text-xs sm:text-[13px] font-extrabold text-slate-950 tracking-wide uppercase m-0 leading-snug">
                    {children}
                  </h1>
                </div>
              ),
              h2: ({ children }) => (
                <h2 className="text-[11.5px] font-bold text-slate-900 text-center uppercase tracking-wide my-1.5 pb-0.5 border-b border-slate-200">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <div className="bg-sky-50 text-sky-950 border-l-3 border-sky-700 px-2 py-0.5 my-1.5 font-bold text-[10.5px] uppercase tracking-wide rounded-r">
                  <span>{children}</span>
                </div>
              ),
              blockquote: ({ children }) => (
                <div className="border-[1.5px] border-slate-800 bg-slate-50/70 rounded px-3 py-2 my-2 font-semibold text-slate-900 text-[10.8px] leading-snug">
                  {children}
                </div>
              ),
              p: ({ children }) => (
                <p
                  className={`text-slate-900 text-justify font-sans ${
                    singlePageCompact ? "text-[11px] leading-[1.38] my-1.5" : "text-xs leading-relaxed my-2"
                  }`}
                >
                  {children}
                </p>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-1.5 rounded border border-slate-300 break-inside-avoid">
                  <table className="w-full border-collapse text-[10px] text-slate-900 bg-white">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-slate-800 text-white font-bold border-b border-slate-700 text-[9.5px] uppercase tracking-wider">
                  {children}
                </thead>
              ),
              th: ({ children }) => (
                <th className="px-2 py-1 border border-slate-300 text-left font-bold bg-slate-100 text-slate-900">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-2 py-1 border border-slate-200 text-slate-800 text-[10px] align-top leading-tight bg-white">
                  {children}
                </td>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 space-y-0.5 my-1.5 text-[11px] text-slate-900 leading-snug">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 space-y-0.5 my-1.5 text-[11px] text-slate-900 leading-snug">
                  {children}
                </ol>
              ),
              hr: () => <hr className="border-0 border-t border-slate-300 my-2" />,
              strong: ({ children }) => (
                <strong className="font-bold text-slate-950">{children}</strong>
              )
            }}
          >
            {bodyMarkdown}
          </ReactMarkdown>
        </div>

        {/* BLOCO DE ASSINATURA PADRONIZADO NO FIM DA FOLHA (IDÊNTICO À IMAGEM ENVIADA) */}
        <div className="signature-block-standard mt-6 pt-3 pb-1 text-center font-sans break-inside-avoid select-none">
          <div
            className="mx-auto mb-1.5"
            style={{ width: "290px", maxWidth: "85%", borderTop: "1.5px solid #1e293b" }}
          />
          <div
            className="font-bold uppercase tracking-wide text-[11.5px] leading-tight"
            style={{ color: "#0f172a" }}
          >
            {sigName}
          </div>
          <div
            className="font-medium text-[10px] leading-tight mt-0.5"
            style={{ color: "#64748b" }}
          >
            {sigRole}
          </div>
          <div
            className="text-[10px] leading-tight mt-0.5"
            style={{ color: "#64748b" }}
          >
            {sigDocs}
          </div>
        </div>
      </div>
    );
  };

  // Download Word (.docx) engineered for 1-page A4 fit with standardized signature
  const handleDownloadWord = () => {
    const { bodyMarkdown, sigName, sigRole, sigDocs } = parseBodyAndSignature(
      documentContent,
      getHeaderRepresentative(),
      getHeaderCpf(),
      getHeaderCnpj()
    );

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${docTitle}</title>
<style>
  @page { size: 21cm 29.7cm; margin: 1.1cm 1.4cm; }
  body { font-family: 'Arial', sans-serif; font-size: 9.8pt; line-height: 1.35; color: #0f172a; margin: 0; padding: 0; }
  .letterhead-header { text-align: center; border-bottom: 1px solid #475569; padding-bottom: 6px; margin-bottom: 10px; }
  .letterhead-title { font-size: 12pt; font-weight: bold; color: #0f172a; text-transform: uppercase; margin-bottom: 2px; }
  .letterhead-details { font-size: 8.2pt; color: #475569; line-height: 1.25; }
  h1 { font-size: 11pt; font-weight: bold; color: #0f172a; text-align: center; text-transform: uppercase; margin: 8px 0; }
  h2 { font-size: 10pt; font-weight: bold; color: #0f172a; text-align: center; text-transform: uppercase; margin: 6px 0; }
  h3 { font-size: 9.2pt; font-weight: bold; color: #0c4a6e; background-color: #e0f2fe; border-left: 3px solid #0284c7; padding: 3px 6px; margin: 6px 0 3px 0; text-transform: uppercase; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 8.8pt; }
  table, th, td { border: 1px solid #cbd5e1; padding: 3px 5px; }
  th { background-color: #f1f5f9; font-weight: bold; text-align: left; }
  p { margin: 4px 0; text-align: justify; }
  ul, ol { margin: 4px 0 4px 18px; padding: 0; }
  li { margin-bottom: 2px; text-align: justify; }
  blockquote { border: 1.5px solid #1e293b; background-color: #f8fafc; padding: 6px 8px; margin: 6px 0; font-weight: bold; }
  .sig-box { margin-top: 22px; text-align: center; page-break-inside: avoid; }
  .sig-line { width: 280px; border-top: 1.5px solid #1e293b; margin: 0 auto 5px auto; }
  .sig-name { font-size: 10pt; font-weight: bold; color: #0f172a; text-transform: uppercase; }
  .sig-meta { font-size: 8.5pt; color: #64748b; margin-top: 1px; }
</style>
</head><body>
<div class="letterhead-header">
  <div class="letterhead-title">${getHeaderCompanyName()}</div>
  <div class="letterhead-details">CNPJ: ${getHeaderCnpj()} — ${getHeaderAddress()}</div>
  <div class="letterhead-details">Telefone / WhatsApp: ${getHeaderPhone()} | E-mail: ${getHeaderEmail()}</div>
</div>
`;
    const signatureHtml = `
<div class="sig-box">
  <div class="sig-line"></div>
  <div class="sig-name">${sigName}</div>
  <div class="sig-meta">${sigRole}</div>
  <div class="sig-meta">${sigDocs}</div>
</div>
</body></html>`;

    const htmlBody = bodyMarkdown
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/---/g, "<hr>")
      .replace(/\n/g, "<br>");

    const sourceHTML = header + htmlBody + signatureHtml;
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

  // Download / Print PDF engineered to stay strictly on 1 single A4 sheet
  const handleDownloadPdf = () => {
    const paperHtml = paperEditableRef.current?.innerHTML || "";
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${docTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
          @page {
            size: A4 portrait;
            margin: 9mm 13mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            color: #0f172a;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 9.5pt;
            line-height: 1.35;
          }
          .a4-single-sheet {
            width: 100%;
            max-width: 184mm;
            margin: 0 auto;
            page-break-after: avoid;
            page-break-inside: avoid;
          }
          .letterhead-header {
            text-align: center;
            border-bottom: 1px solid #64748b;
            padding-bottom: 6px;
            margin-bottom: 8px;
          }
          .letterhead-title {
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            margin: 0 0 2px 0;
          }
          .letterhead-sub {
            font-size: 8.2pt;
            color: #475569;
            margin: 1px 0;
          }
          h1 {
            font-size: 10.5pt;
            font-weight: 800;
            color: #0f172a;
            text-align: center;
            text-transform: uppercase;
            margin: 7px 0;
          }
          h2 {
            font-size: 9.5pt;
            font-weight: 700;
            color: #0f172a;
            text-align: center;
            text-transform: uppercase;
            margin: 5px 0;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 2px;
          }
          h3, .bg-sky-50 {
            font-size: 8.8pt;
            font-weight: 700;
            color: #0c4a6e;
            background-color: #e0f2fe;
            border-left: 3px solid #0284c7;
            padding: 3px 7px;
            margin: 6px 0 3px 0;
            text-transform: uppercase;
          }
          p {
            margin: 4px 0;
            text-align: justify;
          }
          ul, ol {
            margin: 3px 0 5px 18px;
            padding: 0;
          }
          li {
            margin-bottom: 2px;
            text-align: justify;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 5px 0;
            font-size: 8.3pt;
            page-break-inside: avoid;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 3px 5px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background-color: #f1f5f9;
            font-weight: 700;
            color: #0f172a;
          }
          .signature-block-standard {
            margin-top: 20px;
            padding-top: 8px;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        </style>
      </head>
      <body>
        <div class="a4-single-sheet">
          <div class="letterhead-header">
            <div class="letterhead-title">${getHeaderCompanyName()}</div>
            <div class="letterhead-sub">CNPJ: ${getHeaderCnpj()} &nbsp;|&nbsp; ${getHeaderAddress()}</div>
            <div class="letterhead-sub">Telefone / WhatsApp: ${getHeaderPhone()} &nbsp;|&nbsp; E-mail: ${getHeaderEmail()}</div>
          </div>
          <div id="content">${paperHtml}</div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 250);
          };
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
      setEmittedBanner("Documento sincronizado com o Google Drive / Workspace!");
      setTimeout(() => setEmittedBanner(null), 4000);
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
  const filteredTemplates = allTemplates.filter(t => {
    const matchCat =
      activeCategory === "todos" ||
      (activeCategory === "personalizados" ? !!t.isCustom : t.category === activeCategory);
    const matchSearch =
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.badgeText.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-4 animate-fade-in pb-12">
      {/* 1. PAINEL SUPERIOR COMPACTO DE CONTEXTO (EDITAL ANALISADO + EMPRESA + EMISSÃO EM 1 CLIQUE) */}
      <Card className="p-3.5 sm:p-4 gap-3 border-primary/20">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 border border-primary/20 rounded-xl text-primary shrink-0">
              <FileEdit className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-foreground tracking-tight">
                  Emissão de Documentos em 1 Clique
                </h2>
                <Badge variant="secondary" className="text-[10px] font-bold rounded-full">
                  {allTemplates.length} Modelos • 1 Folha A4
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Button
              onClick={() => setShowCreateCustomModal(true)}
              variant="outline"
              size="sm"
              className="cursor-pointer border-primary/40 text-primary hover:bg-primary/10 font-semibold h-8 text-xs"
              title="Criar um documento que não está na lista de modelos"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>+ Criar Novo Documento</span>
            </Button>

            <Button
              onClick={() => setShowDraftsModal(true)}
              variant="outline"
              size="sm"
              className="cursor-pointer h-8 text-xs"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Rascunhos ({draftsList.length})</span>
            </Button>

            <Button
              onClick={handleOneClickEmit}
              size="sm"
              className="cursor-pointer font-bold shadow-xs h-8 text-xs"
              title="Preencher instantaneamente com os dados da empresa e do edital selecionado"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Emitir Documento (1 Clique)</span>
            </Button>

            <Button
              onClick={() => handleAiAutoFill()}
              disabled={isGenerating}
              variant="secondary"
              size="sm"
              className="cursor-pointer font-semibold border border-primary/20 h-8 text-xs"
              title="Refinar e adaptar cláusulas ao edital com Inteligência Artificial"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />}
              <span>{isGenerating ? "Adaptando..." : "Adaptar com IA"}</span>
            </Button>
          </div>
        </div>

        {/* Barra de Vínculo com Edital Analisado + Dados da Empresa */}
        <div className="pt-2.5 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            {/* Seletor do Edital Analisado */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-muted-foreground uppercase font-mono">Edital:</span>
              <Select
                value={editalSourceMode === "analyzed" ? `analyzed_${selectedEditalIndex}` : "new"}
                onValueChange={(val) => {
                  if (val === "new") {
                    setPendingTemplateForModal(selectedTemplate);
                    setModalEditalTab("upload");
                    setModalUploadError(null);
                  } else if (val.startsWith("analyzed_")) {
                    setEditalSourceMode("analyzed");
                    const idx = parseInt(val.replace("analyzed_", ""), 10);
                    setSelectedEditalIndex(idx);
                    const chosenEdital = analyzedEditais[idx] || activeEdital;
                    handleSelectTemplate(selectedTemplate, chosenEdital, false);
                  }
                }}
              >
                <SelectTrigger size="sm" className="text-xs font-semibold max-w-xs sm:max-w-sm cursor-pointer h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {analyzedEditais.length > 0 ? (
                    analyzedEditais.map((ed, idx) => (
                      <SelectItem key={idx} value={`analyzed_${idx}`}>
                        {ed.identificacaoCertame?.identificacaoNumerica || `Edital Analisado #${idx + 1}`} —{" "}
                        {ed.identificacaoCertame?.orgaoComprador?.slice(0, 32) || "Órgão Licitante"}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="analyzed_0">
                      Placeholders Sigilosos ([NOME DO ÓRGÃO])
                    </SelectItem>
                  )}
                  <SelectItem value="new" className="text-primary font-bold">
                    + Fazer Upload de Novo Edital (.PDF / .DOCX / .TXT)
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingTemplateForModal(selectedTemplate);
                  setModalEditalTab("upload");
                  setModalUploadError(null);
                }}
                className="h-7 px-2 text-[11px] font-semibold border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
                title="Fazer upload de um edital para preencher o documento"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Upload Edital</span>
              </Button>
            </div>

            {/* Checkbox Dados da Empresa vs Placeholders Sigilosos */}
            <Label
              className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 cursor-pointer transition-all font-normal ${
                useCompanyContext
                  ? "bg-success/10 border-success/30 text-success font-semibold"
                  : "bg-muted/40 border-input text-muted-foreground"
              }`}
              title="Quando desmarcado ou quando algum campo estiver vazio, usa marcadores de sigilo como [CNPJ DA EMPRESA]"
            >
              <Checkbox
                checked={useCompanyContext}
                onCheckedChange={(checked) => {
                  const nextVal = checked === true;
                  setUseCompanyContext(nextVal);
                  setDocumentContent(
                    applyLocalSubstitutions(selectedTemplate.defaultMarkdown, getCurrentEdital(), nextVal)
                  );
                }}
              />
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs truncate max-w-[220px]">
                {useCompanyContext && companyData.razonSocial
                  ? companyData.razonSocial
                  : "Sigilo: [CNPJ DA EMPRESA]"}
              </span>
            </Label>

            {/* Botão para recolher/expandir galeria de modelos */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCatalogGrid(prev => !prev)}
              className="text-xs cursor-pointer ml-auto h-7"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showCatalogGrid ? "Ocultar Modelos" : "Trocar Modelo"}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCatalogGrid ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>
      </Card>

      {/* 2. GALERIA VISUAL COMPACTA DE MODELOS */}
      {showCatalogGrid && (
        <Card className="p-3.5 sm:p-4 gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: "todos", label: `Todos (${allTemplates.length})` },
                { id: "propostas", label: "Proposta Comercial" },
                { id: "declaracoes", label: "Declarações" },
                { id: "procuracoes_atestados", label: "Procuração & Atestado" },
                { id: "recursos", label: "Esclarecimento & Recursos" },
                ...(customTemplates.length > 0
                  ? [{ id: "personalizados", label: `Meus Modelos (${customTemplates.length})` }]
                  : [])
              ].map(cat => (
                <Button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  variant={activeCategory === cat.id ? "default" : "outline"}
                  size="sm"
                  className="cursor-pointer text-xs h-7 px-2.5"
                >
                  {cat.label}
                </Button>
              ))}
            </div>

            <div className="relative w-full sm:w-56 shrink-0">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar modelo..."
                className="pl-8 text-xs h-7"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[270px] overflow-y-auto pr-1">
            {/* Card para Criar Novo Documento fora da lista */}
            <div
              onClick={() => setShowCreateCustomModal(true)}
              className="p-2.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all cursor-pointer flex flex-col justify-between gap-1.5 group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <Badge variant="default" className="text-[9px] px-1.5 py-0">
                    + Personalizado
                  </Badge>
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <h4 className="font-bold text-primary text-xs">
                  Criar Novo Documento Fora da Lista
                </h4>
                <p className="text-muted-foreground text-[10.5px] line-clamp-1 mt-0.5">
                  Gere qualquer declaração ou documento específico exigido no edital em 1 folha.
                </p>
              </div>
              <div className="flex items-center justify-end">
                <span className="text-[10.5px] font-bold text-primary group-hover:underline flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> Criar documento
                </span>
              </div>
            </div>

            {filteredTemplates.map(tpl => {
              const isSelected = selectedTemplate.id === tpl.id;
              return (
                <div
                  key={tpl.id}
                  onClick={() => handleOpenTemplateEditalModal(tpl)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 group ${
                    isSelected
                      ? "bg-primary/10 border-primary ring-1 ring-primary/30"
                      : "bg-card border-border hover:border-primary/40 hover:bg-muted/30"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <Badge variant={isSelected ? "default" : "secondary"} className="text-[9px] px-1.5 py-0 truncate max-w-[170px]">
                        {tpl.badgeText}
                      </Badge>
                      <div className="flex items-center gap-1">
                        {tpl.isCustom && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteCustomTemplate(tpl.id, e)}
                            className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                            title="Excluir modelo personalizado"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                      </div>
                    </div>
                    <h4 className="font-bold text-foreground text-xs group-hover:text-primary transition-colors line-clamp-1">
                      {tpl.title}
                    </h4>
                    <p className="text-muted-foreground text-[10.5px] line-clamp-1 mt-0.5">
                      {tpl.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                    <span className="text-[9.5px] text-muted-foreground">Escolher Edital / Upload</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "secondary"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenTemplateEditalModal(tpl);
                      }}
                      className="h-6 px-2 text-[10.5px] font-bold cursor-pointer"
                    >
                      <Zap className="w-3 h-3" />
                      <span>Escolher Edital e Emitir</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Aviso de documento recém-emitido */}
      {emittedBanner && (
        <div className="bg-success/10 border border-success/30 text-success px-3.5 py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{emittedBanner}</span>
          </div>
          <button onClick={() => setEmittedBanner(null)} className="text-xs font-bold hover:underline">
            Fechar
          </button>
        </div>
      )}

      {/* 3. ESTÚDIO DE EDIÇÃO E EMISSÃO EM 1 FOLHA A4 */}
      <div ref={a4SectionRef}>
        <Card className="p-3.5 sm:p-4 gap-3">
          {/* Barra Unificada: Título + Ferramentas + Exportação */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-2.5 border-b border-border">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                className="w-full text-xs sm:text-sm font-bold h-8"
                placeholder="Título do Documento"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {/* Toggle Visual vs Texto */}
              <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
                <Button
                  type="button"
                  size="sm"
                  variant={editorMode === "visual" ? "default" : "ghost"}
                  onClick={() => setEditorMode("visual")}
                  className="h-7 px-2.5 text-xs cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Folha A4</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editorMode === "markdown" ? "default" : "ghost"}
                  onClick={() => setEditorMode("markdown")}
                  className="h-7 px-2.5 text-xs cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Editar Texto</span>
                </Button>
              </div>

              <Button
                onClick={() => setShowAiAssist(!showAiAssist)}
                size="sm"
                variant="outline"
                className="cursor-pointer h-8 text-xs border-primary/30 text-primary"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>IA</span>
              </Button>

              <Button
                onClick={handleSaveDraft}
                variant="outline"
                size="sm"
                className="cursor-pointer h-8 text-xs"
              >
                {savedSuccess ? <Check className="w-3.5 h-3.5 text-success" /> : <Save className="w-3.5 h-3.5" />}
                <span>{savedSuccess ? "Salvo!" : "Salvar"}</span>
              </Button>

              <Button
                onClick={handleDownloadPdf}
                size="sm"
                className="cursor-pointer font-bold h-8 text-xs"
                title="Abrir impressão/PDF já calibrado em 1 única folha A4"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Emitir PDF (1 Folha)</span>
              </Button>

              <DropdownMenu open={showDownloadMenu} onOpenChange={setShowDownloadMenu}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="cursor-pointer h-8 text-xs px-2.5">
                    <Download className="w-3.5 h-3.5" />
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onClick={handleDownloadPdf} className="cursor-pointer">
                    <Printer className="w-4 h-4 text-destructive" />
                    <div>
                      <span className="block font-bold">Imprimir / Salvar PDF (.pdf)</span>
                      <span className="text-[10px] text-muted-foreground">Formatado em 1 Folha A4</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={handleDownloadWord} className="cursor-pointer">
                    <FileText className="w-4 h-4 text-primary" />
                    <div>
                      <span className="block font-bold">Baixar para Word (.docx)</span>
                      <span className="text-[10px] text-muted-foreground">Editável no Microsoft Word</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={handleDownloadMarkdown} className="cursor-pointer">
                    <FileCode className="w-4 h-4 text-primary" />
                    <div>
                      <span className="block font-bold">Baixar em Markdown (.md)</span>
                      <span className="text-[10px] text-muted-foreground">Texto estruturado</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={handleCopyText} className="cursor-pointer">
                    <Copy className="w-4 h-4 text-muted-foreground" />
                    <span>{copied ? "Copiado!" : "Copiar Conteúdo"}</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => setIsFullscreenDocs(true)} className="cursor-pointer">
                    <Maximize2 className="w-4 h-4 text-primary" />
                    <span>Abrir em Tela Cheia</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={handleGoogleDriveSync} className="cursor-pointer">
                    <HardDriveDownload className="w-4 h-4 text-success" />
                    <span>Sincronizar com Google Drive</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Barra de Formatação Enxuta (exibida de forma compacta) */}
          <div className="bg-muted/30 px-2.5 py-1.5 rounded-lg border border-border flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-0.5">
              <Button
                onClick={() => handleInsertVariable("\n# TÍTULO DO DOCUMENTO\n")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Título Principal"
              >
                <Heading1 className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("\n## SUBTÍTULO\n")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Subtítulo"
              >
                <Heading2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("\n### SEÇÃO\n")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Seção"
              >
                <Heading3 className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("**Negrito**")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7 font-bold"
                title="Negrito"
              >
                <Bold className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("*Itálico*")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7 italic"
                title="Itálico"
              >
                <Italic className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("\n- Item\n")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Lista"
              >
                <List className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={() => handleInsertVariable("\n1. Item\n")}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Lista Numerada"
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </Button>
              <Button
                onClick={handleInsertTable}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-7"
                title="Inserir Tabela"
              >
                <Table className="w-3.5 h-3.5" />
              </Button>

              <div className="relative group ml-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer text-primary border-primary/30 bg-transparent hover:bg-primary/10 h-6 px-2 text-[11px]"
                >
                  <span>+ Campo</span>
                </Button>

                <div className="absolute top-full left-0 mt-1 w-60 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-1.5 hidden group-hover:block z-50 space-y-0.5">
                  {[
                    { label: "Razão Social", val: companyData.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]" },
                    { label: "CNPJ", val: companyData.cnpj || "[CNPJ DA EMPRESA]" },
                    { label: "Endereço", val: companyData.address || "[ENDEREÇO DA EMPRESA]" },
                    { label: "Representante", val: companyData.representativeName || "[NOME DO REPRESENTANTE LEGAL]" },
                    { label: "CPF", val: companyData.representativeCpf || "[CPF DO REPRESENTANTE]" },
                    { label: "Órgão Licitante", val: getCurrentEdital()?.identificacaoCertame?.orgaoComprador || "[NOME DO ÓRGÃO]" },
                    { label: "Nº do Edital", val: getCurrentEdital()?.identificacaoCertame?.identificacaoNumerica || "[NÚMERO DO EDITAL / PROCESSO]" },
                    { label: "Objeto", val: getCurrentEdital()?.descricaoProduto || "[OBJETO DA LICITAÇÃO]" }
                  ].map(v => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => handleInsertVariable(v.val)}
                      className="w-full text-left px-2 py-1 rounded-lg text-xs hover:bg-accent hover:text-accent-foreground transition-colors block cursor-pointer truncate"
                    >
                      <span className="font-semibold">{v.label}:</span>{" "}
                      <span className="text-[10px] text-muted-foreground font-mono">{v.val}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <Checkbox
                checked={singlePageCompact}
                onCheckedChange={(c) => setSinglePageCompact(c === true)}
              />
              <span>Layout Compacto 1 Folha</span>
            </Label>
          </div>

          {/* Copiloto IA Inline */}
          {showAiAssist && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold text-foreground">
                    Ajuste Rápido com IA (1 Folha A4)
                  </span>
                </div>
                <Button
                  onClick={() => setShowAiAssist(false)}
                  variant="ghost"
                  size="icon"
                  className="cursor-pointer size-6 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {[
                  "Compactar o texto para caber com folga em 1 única página A4",
                  "Adaptar cláusulas e objeto exatamente ao Edital selecionado",
                  "Anonimizar dados ausentes com [CNPJ DA EMPRESA] e [NOME DO ÓRGÃO]"
                ].map(chip => (
                  <Button
                    key={chip}
                    onClick={() => handleAiAutoFill(chip)}
                    variant="outline"
                    size="sm"
                    className="cursor-pointer text-[11px] h-auto py-1 px-2 border-primary/30 font-normal"
                  >
                    {chip}
                  </Button>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  type="text"
                  value={aiAssistPrompt}
                  onChange={(e) => setAiAssistPrompt(e.target.value)}
                  placeholder="Instrua a IA sobre o que alterar neste documento..."
                  className="flex-1 text-xs h-8"
                />
                <Button
                  onClick={() => handleAiAutoFill(aiAssistPrompt)}
                  disabled={isGenerating || !aiAssistPrompt}
                  size="sm"
                  className="cursor-pointer h-8"
                >
                  {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Aplicar</span>
                </Button>
              </div>
            </div>
          )}

          {/* PALCO DA FOLHA A4 OFICIAL (OTIMIZADA PARA 1 PÁGINA) */}
          <div className="bg-muted/40 p-2.5 sm:p-5 rounded-xl border border-border overflow-y-auto flex flex-col items-center">
            {/* FOLHA A4 FÍSICA COMPACTA (1 PÁGINA) */}
            <div
              className="official-a4-paper bg-white text-slate-900 shadow-lg rounded-sm w-full max-w-[210mm] px-6 py-5 sm:px-10 sm:py-7 font-sans relative border border-slate-200 flex flex-col justify-between"
              style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            >
              {/* CABEÇALHO INSTITUCIONAL ENXUTO (OTIMIZADO PARA ECONOMIZAR ESPAÇO VERTICAL) */}
              <div className="border-b border-slate-400 pb-2.5 mb-3 text-center select-none">
                <h2 className="font-extrabold text-slate-950 text-sm sm:text-[15px] tracking-wide uppercase leading-tight">
                  {getHeaderCompanyName()}
                </h2>
                <p className="text-slate-700 font-medium text-[10.5px] mt-0.5 leading-snug">
                  CNPJ: {getHeaderCnpj()} &nbsp;•&nbsp; {getHeaderAddress()}
                </p>
                <p className="text-slate-500 text-[10px] mt-0.5 leading-snug">
                  Telefone / WhatsApp: {getHeaderPhone()} &nbsp;|&nbsp; E-mail: {getHeaderEmail()}
                </p>
              </div>

              {/* CORPO DO DOCUMENTO + ASSINATURA PADRONIZADA */}
              <div className="flex-1">
                {editorMode === "markdown" ? (
                  <Textarea
                    value={documentContent}
                    onChange={(e) => setDocumentContent(e.target.value)}
                    className="w-full min-h-[460px] bg-slate-50 text-slate-900 border-slate-300 font-mono text-xs leading-relaxed p-3.5 rounded-lg"
                    style={{ backgroundColor: "#f8fafc", color: "#0f172a" }}
                    placeholder="Edite o conteúdo do documento aqui..."
                  />
                ) : (
                  renderFormattedA4Document(documentContent, true)
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* MODAL: ESCOLHER EDITAL JÁ ANALISADO OU FAZER UPLOAD DO EDITAL AO CLICAR NO CARD DO MODELO */}
      {pendingTemplateForModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <Card className="max-w-2xl w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto gap-0">
            {/* Cabeçalho do Modal com o Modelo Selecionado */}
            <div className="flex items-start justify-between border-b border-border pb-3 gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="bg-primary/10 p-2 rounded-xl border border-primary/20 text-primary shrink-0 mt-0.5">
                  <FileCheck2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="default" className="text-[10px]">
                      {pendingTemplateForModal.badgeText}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">1 Folha A4</span>
                  </div>
                  <h3 className="font-bold text-foreground text-sm sm:text-base mt-0.5 truncate">
                    {pendingTemplateForModal.title}
                  </h3>
                  <p className="text-muted-foreground text-[11px] leading-snug mt-0.5">
                    Escolha qual edital já analisado deseja vincular ou faça o upload do documento para gerar com os dados do órgão + edital + sua empresa.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => !isAnalyzingModalUpload && setPendingTemplateForModal(null)}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-8 shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Resumo dos Dados da Empresa do Usuário que serão inseridos */}
            <div className="bg-success/10 border border-success/30 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-success shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold text-foreground block truncate">
                    Empresa Emitente: {companyData.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground block truncate">
                    CNPJ: {companyData.cnpj || "[CNPJ DA EMPRESA]"} • Rep.: {companyData.representativeName || "[REPRESENTANTE LEGAL]"}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] border-success/40 text-success shrink-0">
                ✓ Dados da Empresa Ativos
              </Badge>
            </div>

            {/* Seletor de Abas: Editais Já Analisados vs Fazer Upload do Documento */}
            <div className="grid grid-cols-2 gap-2 bg-muted/50 p-1 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setModalEditalTab("analyzed")}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  modalEditalTab === "analyzed"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Landmark className="w-3.5 h-3.5" />
                <span>Editais Já Analisados ({analyzedEditais.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setModalEditalTab("upload")}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  modalEditalTab === "upload"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Fazer Upload do Edital (.PDF / .DOC)</span>
              </button>
            </div>

            {/* ABA 1: ESCOLHER EDITAL JÁ ANALISADO */}
            {modalEditalTab === "analyzed" && (
              <div className="space-y-2.5">
                {analyzedEditais.length > 0 ? (
                  <>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        type="text"
                        value={modalEditalSearch}
                        onChange={(e) => setModalEditalSearch(e.target.value)}
                        placeholder="Buscar edital analisado por órgão, número ou objeto..."
                        className="pl-8 text-xs h-8"
                      />
                    </div>

                    <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1">
                      {analyzedEditais
                        .map((ed, originalIdx) => ({ ed, originalIdx }))
                        .filter(({ ed }) => {
                          if (!modalEditalSearch.trim()) return true;
                          const q = modalEditalSearch.toLowerCase();
                          const orgao = (ed.identificacaoCertame?.orgaoComprador || "").toLowerCase();
                          const num = (ed.identificacaoCertame?.identificacaoNumerica || "").toLowerCase();
                          const mod = (ed.identificacaoCertame?.modalidade || "").toLowerCase();
                          const obj = (ed.descricaoProduto || "").toLowerCase();
                          return orgao.includes(q) || num.includes(q) || mod.includes(q) || obj.includes(q);
                        })
                        .map(({ ed, originalIdx }) => {
                          const orgao = ed.identificacaoCertame?.orgaoComprador || "Órgão Licitante";
                          const num = ed.identificacaoCertame?.identificacaoNumerica || `Edital #${originalIdx + 1}`;
                          const mod = ed.identificacaoCertame?.modalidade || "Licitação";
                          const objeto = ed.descricaoProduto || "Objeto conforme Termo de Referência do Edital";
                          const valor = ed.viabilidadeFinanceira?.valorEstimado;
                          const qtdItens = ed.itensEdital?.length || 0;
                          const isCurrent = editalSourceMode === "analyzed" && selectedEditalIndex === originalIdx;

                          return (
                            <div
                              key={originalIdx}
                              onClick={() => handleConfirmAnalyzedEditalForTemplate(ed, originalIdx)}
                              className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group ${
                                isCurrent
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/30"
                                  : "bg-card border-border hover:border-primary/40 hover:bg-muted/40"
                              }`}
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                    {num}
                                  </Badge>
                                  {mod && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                      {mod}
                                    </Badge>
                                  )}
                                  {valor && (
                                    <span className="text-[10px] font-semibold text-success">
                                      {valor}
                                    </span>
                                  )}
                                  {qtdItens > 0 && (
                                    <span className="text-[10px] text-muted-foreground">
                                      • {qtdItens} {qtdItens === 1 ? "item" : "itens"}
                                    </span>
                                  )}
                                </div>

                                <h4 className="font-bold text-foreground text-xs group-hover:text-primary transition-colors truncate">
                                  {orgao}
                                </h4>

                                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                                  {objeto}
                                </p>
                              </div>

                              <Button
                                type="button"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConfirmAnalyzedEditalForTemplate(ed, originalIdx);
                                }}
                                className="shrink-0 text-xs font-bold cursor-pointer h-8"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <span>Emitir com este Edital</span>
                              </Button>
                            </div>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-7 px-4 border border-dashed border-border rounded-xl bg-muted/20 space-y-2.5">
                    <Landmark className="w-8 h-8 text-muted-foreground mx-auto" />
                    <div>
                      <p className="font-bold text-foreground text-xs">
                        Nenhum edital analisado encontrado no histórico
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Faça o upload do documento do edital agora para extrair automaticamente os dados do órgão e emitir o documento.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setModalEditalTab("upload")}
                      className="cursor-pointer text-xs font-bold"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Fazer Upload do Edital Agora</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ABA 2: FAZER UPLOAD DO DOCUMENTO DO EDITAL */}
            {modalEditalTab === "upload" && (
              <div className="space-y-3 text-xs">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleModalFilesProcess(Array.from(e.dataTransfer.files));
                    }
                  }}
                  className="border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer gap-2"
                >
                  <div className="p-2.5 rounded-full bg-primary/15 text-primary">
                    <FileUp className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-foreground text-xs block">
                      Clique para selecionar ou arraste o arquivo do Edital / Termo de Referência
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Suporta arquivos PDF, Word (.DOC / .DOCX) ou Texto (.TXT)
                    </span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    multiple
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleModalFilesProcess(Array.from(e.target.files));
                        e.target.value = "";
                      }
                    }}
                    className="hidden"
                  />
                </label>

                {modalUploadFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10.5px] font-bold text-muted-foreground uppercase">
                      Arquivos Anexados ({modalUploadFiles.length}):
                    </span>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {modalUploadFiles.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="font-semibold text-foreground truncate">{f.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">({f.size})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setModalUploadFiles((prev) => prev.filter((item) => item.id !== f.id))
                            }
                            className="text-muted-foreground hover:text-destructive p-1 cursor-pointer"
                            title="Remover arquivo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    Ou cole informações / resumo do edital (Opcional):
                  </Label>
                  <Textarea
                    rows={2}
                    value={modalUploadText}
                    onChange={(e) => setModalUploadText(e.target.value)}
                    placeholder="Ex: Pregão Eletrônico nº 90012/2026 - Prefeitura Municipal de... Objeto: Contratação de..."
                    className="text-xs"
                  />
                </div>

                {modalUploadError && (
                  <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-lg text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{modalUploadError}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={isAnalyzingModalUpload || (modalUploadFiles.length === 0 && !modalUploadText.trim())}
                    onClick={handleAnalyzeModalUploadAndEmit}
                    className="w-full sm:w-auto font-bold text-xs cursor-pointer"
                  >
                    {isAnalyzingModalUpload ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Extraindo Dados do Órgão e Gerando Documento...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Analisar Edital e Emitir Documento</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Rodapé do Modal: Opção de emitir apenas com dados da empresa ou cancelar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isAnalyzingModalUpload}
                onClick={() => {
                  const tpl = pendingTemplateForModal;
                  setPendingTemplateForModal(null);
                  handleSelectTemplate(tpl, null, true);
                }}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Emitir só com Dados da Empresa (Sem Edital)
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isAnalyzingModalUpload}
                onClick={() => setPendingTemplateForModal(null)}
                className="text-xs cursor-pointer"
              >
                Fechar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CRIAR NOVO DOCUMENTO PERSONALIZADO (FORA DOS MODELOS ENVIADOS) */}
      {showCreateCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <Card className="max-w-xl w-full p-5 space-y-4 shadow-2xl my-auto gap-0">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="bg-primary/10 p-2 rounded-xl border border-primary/20 text-primary">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-sm sm:text-base">
                    Criar Novo Documento Personalizado
                  </h3>
                  <p className="text-muted-foreground text-[11px]">
                    Crie qualquer declaração, carta ou documento exigido no edital que não esteja entre os modelos padrão.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => setShowCreateCustomModal(false)}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateCustomDocument} className="space-y-3.5 pt-3 text-xs">
              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Nome / Título do Documento <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  required
                  autoFocus
                  value={customDocTitle}
                  onChange={(e) => setCustomDocTitle(e.target.value)}
                  placeholder="Ex: Declaração de Garantia e Suporte Técnico / Carta de Credenciamento"
                  className="text-xs"
                />
              </div>

              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  Categoria do Documento
                </Label>
                <Select
                  value={customDocCategory}
                  onValueChange={(v) => setCustomDocCategory(v as DocumentTemplate["category"])}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="declaracoes">Declarações de Habilitação</SelectItem>
                    <SelectItem value="propostas">Propostas / Planilhas Comerciais</SelectItem>
                    <SelectItem value="procuracoes_atestados">Procurações / Atestados / Credenciamento</SelectItem>
                    <SelectItem value="recursos">Esclarecimentos / Impugnações / Recursos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="block text-xs font-semibold text-foreground mb-1">
                  O que este documento deve declarar ou conter? (Opcional — a IA redige em 1 folha A4)
                </Label>
                <Textarea
                  rows={3}
                  value={customDocInstructions}
                  onChange={(e) => setCustomDocInstructions(e.target.value)}
                  placeholder="Ex: Declarar que a empresa oferece garantia integral de 12 meses e suporte remoto em até 4 horas úteis conforme item 8.4 do Termo de Referência..."
                  className="text-xs"
                />
              </div>

              <Label className="flex items-center gap-2 text-xs text-foreground cursor-pointer pt-1">
                <Checkbox
                  checked={saveCustomToCatalog}
                  onCheckedChange={(c) => setSaveCustomToCatalog(c === true)}
                />
                <span>Salvar na galeria "Meus Modelos" para emitir com 1 clique nas próximas licitações</span>
              </Label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateCustomModal(false)}
                  className="text-xs cursor-pointer"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isCreatingCustomDoc || !customDocTitle.trim()}
                  className="text-xs font-bold cursor-pointer"
                >
                  {isCreatingCustomDoc ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Criando Documento em 1 Folha...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Criar e Emitir Documento</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* TELA CHEIA (MODO ESTÚDIO PÁGINA INTEIRA) */}
      {isFullscreenDocs && (
        <div className="fixed inset-0 z-[9999] bg-muted flex flex-col animate-fade-in overflow-hidden">
          <div className="bg-card border-b border-border px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-primary p-2 rounded-xl text-primary-foreground shrink-0">
                <FileEdit className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="bg-transparent text-foreground font-bold text-sm sm:text-base focus:outline-none focus:border-b-2 focus:border-primary truncate max-w-xs sm:max-w-md"
                />
                <p className="text-muted-foreground text-[10px] truncate">
                  Visualização e Edição em Tela Cheia • Formato 1 Folha A4
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => setEditorMode(editorMode === "visual" ? "markdown" : "visual")}
                variant="outline"
                size="sm"
                className="cursor-pointer text-xs"
              >
                {editorMode === "visual" ? "Editar Texto" : "Ver Folha A4"}
              </Button>
              <Button
                onClick={handleDownloadPdf}
                variant="outline"
                size="sm"
                className="cursor-pointer text-destructive border-destructive/20 bg-destructive/10"
              >
                <Printer className="w-4 h-4" />
                <span>PDF (1 Folha)</span>
              </Button>
              <Button
                onClick={handleDownloadWord}
                variant="outline"
                size="sm"
                className="cursor-pointer text-primary border-primary/20 bg-primary/10"
              >
                <FileText className="w-4 h-4" />
                <span>Word</span>
              </Button>
              <Button
                onClick={() => setIsFullscreenDocs(false)}
                variant="secondary"
                size="icon"
                className="cursor-pointer"
                title="Sair da Tela Cheia"
              >
                <Minimize2 className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 bg-muted overflow-y-auto p-4 sm:p-6 flex justify-center">
            <div
              className="official-a4-paper bg-white text-slate-900 shadow-2xl rounded-sm w-full max-w-[210mm] px-8 py-6 sm:px-12 sm:py-8 font-sans relative border border-slate-200 flex flex-col justify-between"
              style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            >
              <div className="border-b border-slate-400 pb-2.5 mb-3 text-center">
                <h2 className="font-extrabold text-slate-950 text-base uppercase leading-tight">
                  {getHeaderCompanyName()}
                </h2>
                <p className="text-slate-700 font-medium text-[11px] mt-0.5">
                  CNPJ: {getHeaderCnpj()} &nbsp;•&nbsp; {getHeaderAddress()}
                </p>
                <p className="text-slate-500 text-[10px] mt-0.5">
                  Telefone / WhatsApp: {getHeaderPhone()} | E-mail: {getHeaderEmail()}
                </p>
              </div>

              <div className="flex-1">
                {editorMode === "markdown" ? (
                  <Textarea
                    value={documentContent}
                    onChange={(e) => setDocumentContent(e.target.value)}
                    className="w-full min-h-[520px] bg-slate-50 text-slate-900 border-slate-300 font-mono text-xs leading-relaxed p-4 rounded-lg"
                  />
                ) : (
                  renderFormattedA4Document(documentContent, true)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE RASCUNHOS SALVOS */}
      {showDraftsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <Card className="w-full max-w-xl p-4 sm:p-6 space-y-4 shadow-2xl my-auto gap-0">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-foreground text-sm sm:text-base">Rascunhos Salvos</h3>
              <Button
                onClick={() => setShowDraftsModal(false)}
                variant="ghost"
                size="icon"
                className="cursor-pointer size-8"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {draftsList.length === 0 ? (
              <p className="text-muted-foreground text-xs text-center py-8">Nenhum rascunho salvo ainda.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1 pt-3">
                {draftsList.map(draft => (
                  <div
                    key={draft.id}
                    className="p-3 bg-muted/40 border border-border rounded-xl flex items-center justify-between gap-3 hover:bg-muted transition-colors"
                  >
                    <div className="min-w-0">
                      <h4 className="font-bold text-foreground text-xs truncate">{draft.title}</h4>
                      <p className="text-[10px] text-muted-foreground">{draft.date}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => {
                          setDocTitle(draft.title);
                          setDocumentContent(draft.content);
                          setShowDraftsModal(false);
                        }}
                        size="sm"
                        className="cursor-pointer"
                      >
                        Carregar
                      </Button>

                      <Button
                        onClick={() => {
                          const updated = draftsList.filter(d => d.id !== draft.id);
                          setDraftsList(updated);
                          localStorage.setItem("aip_created_docs_drafts", JSON.stringify(updated));
                        }}
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
