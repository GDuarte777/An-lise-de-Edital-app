#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MÓDULO: Robô de Lances Automáticos (Compras.gov.br) - LanceBot + Python-Comprasnet
ARQUITETURA: Assíncrona de Alta Performance (asyncio / httpx / Playwright)
AUTOR: Engenheiro de Software Sênior especializado em RPAs e Licitações Públicas

Este arquivo contém o núcleo de inteligência e o motor de lances assíncronos. Ele foi projetado
para rodar como um serviço (background worker) alimentando atualizações em tempo real via WebSockets
ou Polling para a interface administrativa (React/TypeScript).
"""

import asyncio
import logging
import random
from datetime import datetime
from typing import Dict, Any, Optional

# Configuração de Logging para auditoria regulatória e fiscal de lances
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LanceBot")

class EstrategiaMargem:
    """
    Cérebro de Estratégia de Margem (Inspirado no LanceBot).
    Faz a validação matemática imediata e impede o envio de lances abaixo da margem de segurança.
    """
    def __init__(
        self, 
        valor_limite_minimo: float, 
        tipo_decremento: str,  # "fixo" ou "percentual"
        valor_decremento: float
    ):
        self.valor_limite_minimo = float(valor_limite_minimo)
        self.tipo_decremento = tipo_decremento.lower()
        self.valor_decremento = float(valor_decremento)

    def calcular_contraproposta(self, menor_lance_atual: float) -> float:
        """
        Calcula o próximo lance de acordo com a regra de decremento.
        
        Sua lógica impede o envio de valores abaixo do limite mínimo.
        Retorna o valor calculado se seguro, ou levanta uma exceção se a margem for estourada.
        """
        menor_lance_atual = float(menor_lance_atual)
        
        if self.tipo_decremento == "percentual":
            fator = 1.0 - (self.valor_decremento / 100.0)
            proximo_lance = menor_lance_atual * fator
        else:  # Fixo
            proximo_lance = menor_lance_atual - self.valor_decremento

        # Arredondar para duas casas decimais (padrão de moedas comprasnet)
        proximo_lance = round(proximo_lance, 2)

        # Validação crucial de segurança antimargem (Impede lances abaixo do limite do usuário)
        if proximo_lance < self.valor_limite_minimo:
            raise ValueError(
                f"MARGEM ESTOURADA: O próximo lance calculado de R$ {proximo_lance:.2f} "
                f"é inferior ao Valor Limite Mínimo configurado de R$ {self.valor_limite_minimo:.2f}!"
            )
            
        return proximo_lance


class MotorLancesComprasnet:
    """
    Motor de Lances Assíncrono para o portal Compras.gov.br.
    Simula e integra sessões, lendo menor lance concorrente e chat do pregoeiro.
    """
    def __init__(self, config: Dict[str, Any]):
        self.pregao_id = config.get("pregao_id", "")
        self.item_num = config.get("item_num", "")
        self.ativo = False
        
        # Estratégia de Margem instanciada para segurança do item
        self.estrategia = EstrategiaMargem(
            valor_limite_minimo=config.get("valor_limite_minimo", 0.0),
            tipo_decremento=config.get("tipo_decremento", "fixo"),
            valor_decremento=config.get("valor_decremento", 1.0)
        )
        
        self.intervalo_ms = config.get("intervalo_ms", 1000)
        self.callback_log = config.get("callback_log", print)

        # Dados da disputa de lances
        self.ultimo_menor_lance = 0.0
        self.nossos_lances_enviados = []

    async def obter_menor_lance_concorrente(self) -> float:
        """
        [CONECTAR À API DO COMPRASNET / PLAYWRIGHT / HTTPX]
        Este é o ponto onde você realiza a requisição HTTP GET na sala de disputa do item do pregão.
        Exemplo de rota comprasnet: /api/sala-disputa/v1/pregao/{self.pregao_id}/item/{self.item_num}
        """
        # Para simular sem quebrar o MVP, geramos flutuações de mercado realistas:
        if self.ultimo_menor_lance == 0.0:
            # Ponto de partida simulado do lote
            self.ultimo_menor_lance = round(random.uniform(500.0, 1500.0), 2)
            
        # Simula um concorrente abaixando levemente o preço
        if random.random() < 0.4:
            decremento_concorrente = round(random.uniform(1.0, 10.0), 2)
            novo_menor = max(1.0, self.ultimo_menor_lance - decremento_concorrente)
            self.ultimo_menor_lance = round(novo_menor, 2)
            self.callback_log(
                f"⚡ CONCORRENTE: Postou novo lance concorrente no valor de R$ {self.ultimo_menor_lance:.2f}"
            )
            
        return self.ultimo_menor_lance

    async def verificar_chat_pregoeiro(self) -> Optional[str]:
        """
        Monitora em tempo real as mensagens do pregoeiro (Chat Oficial).
        Conectar aos WebSockets do Compras.gov.br ou fazer scraping da sala.
        """
        mensagens_simuladas = [
            "Pregoeiro do Órgão: Atenção concorrentes do item {}, disputa iniciada!",
            "Pregoeiro do Órgão: Prorrogado tempo de lances do lote por mais 2 minutos.",
            "Pregoeiro do Órgão: Lembrem-se das certidões e prazos regulamentares na ata.",
            "Pregoeiro do Órgão: Negociações abertas para o lote atual.",
        ]
        if random.random() < 0.08:  # 8% de chance de haver uma nova mensagem do pregoeiro
            msg = random.choice(mensagens_simuladas).format(self.item_num)
            self.callback_log(f"💬 CHAT PREGOEIRO: {msg}")
            return msg
        return None

    async def enviar_lance_comprasnet(self, valor_lance: float):
        """
        [ENVIAR REQUISIÇÃO POST COM COOKIES DE SESSÃO]
        Envia a proposta final matemática para a API de Lances do Compras.gov.br.
        Requer token CSRF e cookies obtidos no login (idg.comprasgovernamentais.gov.br)
        """
        self.nossos_lances_enviados.append(valor_lance)
        self.ultimo_menor_lance = valor_lance  # Agora nosso lance passa a ser o menor
        self.callback_log(
            f"🚀 SUCESSO: Enviado lance automático no valor comercial de R$ {valor_lance:.2f}"
        )

    async def iniciar_loop(self):
        """
        Loop principal de alta frequência, monitorando lances a cada X milissegundos sem travar.
        """
        self.ativo = True
        self.callback_log(
            f"🔄 ROBÔ INICIADO: Monitorando Pregão {self.pregao_id}, Item {self.item_num} (Intervalo: {self.intervalo_ms}ms)"
        )
        self.callback_log(
            f"🎯 ESTRATÉGIA: Mínimo R$ {self.estrategia.valor_limite_minimo:.2f} | Decr: {self.estrategia.valor_decremento} ({self.estrategia.tipo_decremento})"
        )

        try:
            while self.ativo:
                # 1. Lê o menor lance da sala de disputa
                menor_atual = await self.obter_menor_lance_concorrente()
                
                # 2. Monitora mensagens importantes no Chat
                await self.verificar_chat_pregoeiro()

                # Se nós já lideramos a disputa por termos o menor valor, não há necessidade de bater o nosso próprio lance!
                if len(self.nossos_lances_enviados) > 0 and menor_atual == self.nossos_lances_enviados[-1]:
                    # Nós estamos no topo da fila, aguardamos nova concorrência bater nosso menor valor
                    await asyncio.sleep(self.intervalo_ms / 1000.0)
                    continue

                # 3. Processa a lógica de contraproposta imediata
                try:
                    novo_lance = self.estrategia.calcular_contraproposta(menor_atual)
                    
                    # Se seguro, despacha para a secretaria do pregão
                    await self.enviar_lance_comprasnet(novo_lance)
                    
                except ValueError as err_margem:
                    # Margem Estourada - Pausa automática imediata por razões de risco financeiro empresarial
                    self.callback_log(f"⚠️ AVISO FINANCEIRO: {str(err_margem)}")
                    self.callback_log("🛑 BOT PAUSADO AUTOMATICAMENTE: Risco de venda abaixo do custo operacional mínimo.")
                    self.ativo = False
                    break

                # Dorme o intervalo configurado antes de re-escanear
                await asyncio.sleep(self.intervalo_ms / 1000.0)

        except asyncio.CancelledError:
            self.callback_log("⚠️ loop de lances cancelado externamente.")
        finally:
            self.ativo = False
            self.callback_log("🔌 ROBÔ DESLIGADO: Conexão com o portal Compras.gov.br encerrada com segurança.")


# EXEMPLO DE USO / HARNESS DE TESTE DO COCKPIT
async def main():
    print("=== TESTANDO CONEXÃO LOCAL DO LANCE_BOT EM MODO DE SIMULAÇÃO ===")
    config_teste = {
        "pregao_id": "2026042100002",
        "item_num": "4",
        "valor_limite_minimo": 820.00,
        "tipo_decremento": "fixo", # fixo ou percentual
        "valor_decremento": 15.00,
        "intervalo_ms": 1500,
        "callback_log": lambda msg: print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
    }

    bot = MotorLancesComprasnet(config_teste)
    # Roda o bot por 12 segundos ou até estourar a margem mínima configurada
    try:
        await asyncio.wait_for(bot.iniciar_loop(), timeout=12.0)
    except asyncio.TimeoutError:
        print("--- Parando simulação após atingir tempo limite do teste ---")
        bot.ativo = False

if __name__ == "__main__":
    asyncio.run(main())
