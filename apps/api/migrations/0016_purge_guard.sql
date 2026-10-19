-- Limpeza de base autorizada pela gerência (com senha): durante essa transação, e só para o
-- histórico de oportunidades e atividades, a exclusão é liberada pela variável isp.allow_purge.
-- E-mails só saem junto com a oportunidade apagada. Auditoria continua sempre append-only.
CREATE OR REPLACE FUNCTION isp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME IN ('opportunity_events', 'activity_events', 'email_messages')
     AND current_setting('isp.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Tabela % é append-only (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
