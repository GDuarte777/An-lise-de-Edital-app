import { Bot, Monitor, ShieldCheck, Zap, AlertTriangle } from "lucide-react";

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

      <div className="text-xs text-[#6B7280] leading-relaxed">
        Código-fonte e instruções de build em <code className="bg-[#F3F4F6] px-1.5 py-0.5 rounded">desktop/</code>{" "}
        no repositório. Para gerar o instalador do Windows:{" "}
        <code className="bg-[#F3F4F6] px-1.5 py-0.5 rounded">npm run dist:win</code>.
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
