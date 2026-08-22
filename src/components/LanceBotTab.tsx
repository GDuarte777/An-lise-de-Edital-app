import { Bot, Monitor, ShieldCheck, Zap, AlertTriangle, Download } from "lucide-react";

// URL estável servida pelo GitHub: redireciona direto ao .exe da Release mais recente,
// então o clique já inicia o download em vez de abrir uma página intermediária.
const URL_INSTALADOR =
  "https://github.com/GDuarte777/An-lise-de-Edital-app/releases/latest/download/HORASIS-LanceBot-Setup.exe";

/**
 * O robô de lances deixou de rodar no navegador e na nuvem: agora é um aplicativo que
 * o operador instala na própria máquina. Esta aba só explica o porquê e aponta o caminho.
 */
export default function LanceBotTab({ activeEdital }: { activeEdital?: any }) {
  const pregaoSugerido = activeEdital?.numeroPregao || activeEdital?.numero || "";

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#FFF0E5] flex items-center justify-center">
          <Bot className="w-5 h-5 text-[#FF5A00]" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[#111827]">Robô de Lances</h2>
          <p className="text-xs text-[#6B7280]">Aplicativo para Windows, executado na sua máquina.</p>
        </div>
      </div>

      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-5 space-y-4">
        <p className="text-sm text-[#374151] leading-relaxed">
          A disputa é operada por um programa instalado no seu computador, e não mais pelo navegador. Isso é o
          que torna o robô viável de verdade:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Cartao
            icone={<ShieldCheck className="w-4 h-4 text-[#FF5A00]" />}
            titulo="Sua senha não passa por aqui"
            texto="O login acontece na página oficial do gov.br, dentro do aplicativo. A plataforma nunca vê sua senha, e certificado digital A1 ou A3 funciona normalmente."
          />
          <Cartao
            icone={<Zap className="w-4 h-4 text-[#FF5A00]" />}
            titulo="Menos atraso na disputa"
            texto="Os lances saem da sua máquina direto para o portal, sem passar por um servidor intermediário — o que conta nos segundos finais do pregão."
          />
          <Cartao
            icone={<Monitor className="w-4 h-4 text-[#FF5A00]" />}
            titulo="Piso de margem local"
            texto="O limite mínimo que você define é verificado antes de cada envio. Se o próximo lance ficaria abaixo dele, o robô para sozinho."
          />
        </div>
      </div>

      <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-bold text-[#92400E]">Integração com o portal ainda em calibração</p>
          <p className="text-xs text-[#92400E] leading-relaxed">
            O aplicativo já opera em modo simulação, que serve para validar sua estratégia de margem. O envio de
            lances reais depende de mapear a API da sala de disputa: use o Modo Captura do aplicativo durante um
            pregão e envie o arquivo gerado para a equipe técnica.
          </p>
        </div>
      </div>

      {pregaoSugerido && (
        <p className="text-xs text-[#6B7280]">
          Edital aberto nesta tela: <span className="font-bold text-[#374151]">{pregaoSugerido}</span> — informe
          este número ao configurar a disputa no aplicativo.
        </p>
      )}

      <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-[#FF5A00]" />
          <span className="text-xs font-bold text-[#111827] uppercase tracking-wide">Baixar o aplicativo</span>
        </div>
        <p className="text-xs text-[#6B7280] leading-relaxed">
          Windows, 64 bits. O download começa ao clicar; depois é só executar o arquivo.
        </p>
        <a
          href={URL_INSTALADOR}
          className="inline-flex items-center gap-2 bg-[#FF5A00] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#E85100] transition-colors w-fit"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar instalador
        </a>
        <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
          Prefere rodar a partir do código?{" "}
          <code className="bg-[#F3F4F6] px-1 py-0.5 rounded">cd desktop &amp;&amp; npm install &amp;&amp; npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

function Cartao({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-3.5 space-y-1.5">
      <div className="flex items-center gap-2">
        {icone}
        <span className="text-[11px] font-bold text-[#111827]">{titulo}</span>
      </div>
      <p className="text-[11px] text-[#6B7280] leading-relaxed">{texto}</p>
    </div>
  );
}
