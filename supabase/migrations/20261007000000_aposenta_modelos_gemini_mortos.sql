-- Aposenta os nomes de modelo do Gemini que a API não serve mais.
--
-- O painel de limites do projeto expõe apenas "3.8 Flash" e "3.1 Flash Lite".
-- Para um modelo que a chave não serve, o Google responde 503 "high demand" em
-- vez de 404 — então a indisponibilidade permanente parecia pico de demanda
-- passageiro, e o chat insistia nela até estourar o tempo, por dias.
--
-- O servidor já corrige o nome em tempo de execução (modelosGemini.ts), então
-- esta migração não muda comportamento: ela alinha o que está gravado com o que
-- de fato roda, para que a tela "IA & Modelos" pare de mostrar um modelo morto.
--
-- O DEFAULT da coluna era 'gemini-3.5-flash', também aposentado: todo usuário
-- novo nascia apontando para um modelo inexistente. É a parte que mais importa
-- aqui, porque afeta quem ainda nem se cadastrou.

alter table public.configuracoes_usuario
  alter column gemini_model set default 'gemini-3.8-flash';

update public.configuracoes_usuario
   set gemini_model = case gemini_model
         when 'gemini-3.5-flash-lite' then 'gemini-3.1-flash-lite'
         when 'gemini-2.5-flash-lite' then 'gemini-3.1-flash-lite'
         else 'gemini-3.8-flash'
       end
 where gemini_model in (
         'gemini-3.7-flash',
         'gemini-3.6-flash',
         'gemini-3.5-flash',
         'gemini-3.5-flash-lite',
         'gemini-2.5-flash',
         'gemini-2.5-flash-lite'
       );
