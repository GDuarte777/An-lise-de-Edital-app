-- Permite que o usuário baixe novamente as certidões que já enviou,
-- guardando o conteúdo do arquivo (base64) junto com o registro da certidão.
alter table certidoes_fiscais
  add column if not exists file_base64 text,
  add column if not exists file_mime_type text;
