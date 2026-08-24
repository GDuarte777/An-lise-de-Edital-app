import { Bot, Monitor, ShieldCheck, Zap, AlertTriangle, Download } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

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
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">Robô de Lances</h2>
          <p className="text-xs text-muted-foreground">Aplicativo para Windows, executado na sua máquina.</p>
        </div>
      </div>

      <Card className="bg-muted/40 py-5">
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground leading-relaxed">
            A disputa é operada por um programa instalado no seu computador, e não mais pelo navegador. Isso é o
            que torna o robô viável de verdade:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Cartao
              icone={<ShieldCheck className="w-4 h-4 text-primary" />}
              titulo="Sua senha não passa por aqui"
              texto="O login acontece na página oficial do gov.br, dentro do aplicativo. A plataforma nunca vê sua senha, e certificado digital A1 ou A3 funciona normalmente."
            />
            <Cartao
              icone={<Zap className="w-4 h-4 text-primary" />}
              titulo="Menos atraso na disputa"
              texto="Os lances saem da sua máquina direto para o portal, sem passar por um servidor intermediário — o que conta nos segundos finais do pregão."
            />
            <Cartao
              icone={<Monitor className="w-4 h-4 text-primary" />}
              titulo="Piso de margem local"
              texto="O limite mínimo que você define é verificado antes de cada envio. Se o próximo lance ficaria abaixo dele, o robô para sozinho."
            />
          </div>
        </CardContent>
      </Card>

      <div className="bg-warning/10 border border-warning/40 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-bold text-warning">Integração com o portal ainda em calibração</p>
          <p className="text-xs text-warning/90 leading-relaxed">
            O aplicativo já opera em modo simulação, que serve para validar sua estratégia de margem. O envio de
            lances reais depende de mapear a API da sala de disputa: use o Modo Captura do aplicativo durante um
            pregão e envie o arquivo gerado para a equipe técnica.
          </p>
        </div>
      </div>

      {pregaoSugerido && (
        <p className="text-xs text-muted-foreground">
          Edital aberto nesta tela: <span className="font-bold text-foreground">{pregaoSugerido}</span> — informe
          este número ao configurar a disputa no aplicativo.
        </p>
      )}

      <Card className="py-5">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">Baixar o aplicativo</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Windows, 64 bits. O download começa ao clicar; depois é só executar o arquivo.
          </p>
          <Button asChild size="sm" className="w-fit">
            <a href={URL_INSTALADOR}>
              <Download className="w-3.5 h-3.5" />
              Baixar instalador
            </a>
          </Button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Prefere rodar a partir do código?{" "}
            <code className="bg-muted px-1 py-0.5 rounded">cd desktop &amp;&amp; npm install &amp;&amp; npm run dev</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Cartao({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <Card className="py-3.5">
      <CardContent className="space-y-1.5 px-3.5">
        <div className="flex items-center gap-2">
          {icone}
          <span className="text-[11px] font-bold text-foreground">{titulo}</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{texto}</p>
      </CardContent>
    </Card>
  );
}
