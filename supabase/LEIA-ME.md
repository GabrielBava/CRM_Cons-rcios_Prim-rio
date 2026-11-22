# Versão de teste do CRM no Supabase

`crm_teste.sql` cria o schema `crm_teste` (82 tabelas do CRM) com os **dados de demonstração** — sem sessões, senhas,
tokens nem segredos. Gerado por `npm run supabase -- --arquivo supabase/crm_teste.sql` a partir do banco de
demonstração (`npm run demo`).

- Projeto de teste: **vero-crm-teste** (organização Vero Consórcios, região São Paulo).
- Para recarregar: cole o arquivo no SQL Editor do Supabase, ou rode `npm run supabase -- --enviar` com
  `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`. Sem token, o próprio Supabase pode baixar o arquivo deste
  repositório (público) e executar, no SQL Editor:

```sql
create extension if not exists http with schema extensions;
do $carga$
declare r extensions.http_response; s text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
  r := extensions.http_get('https://raw.githubusercontent.com/GabrielBava/CRM_Cons-rcios_Prim-rio/<commit>/supabase/crm_teste.sql');
  if r.status <> 200 then raise exception 'HTTP %', r.status; end if;
  s := regexp_replace(regexp_replace(r.content, '^BEGIN;\n', ''), 'COMMIT;\n?$', '');
  execute s;
end $carga$;
drop extension if exists http;
```

- A checagem de segurança do Supabase avisa "RLS Enabled No Policy" nas 82 tabelas: é proposital (nenhum acesso pela
  API pública; só o SQL Editor e a chave service_role leem).
- **Nunca** coloque neste repositório (público) um arquivo gerado a partir do banco de produção: ele teria os dados dos
  clientes. Para dados reais, use `--enviar` direto para o projeto.
