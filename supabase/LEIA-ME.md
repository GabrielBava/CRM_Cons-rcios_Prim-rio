# Versão de teste do CRM no Supabase

`crm_teste.sql` cria o schema `crm_teste` (82 tabelas do CRM) com os **dados de demonstração** — sem sessões, senhas,
tokens nem segredos. Gerado por `npm run supabase -- --arquivo supabase/crm_teste.sql` a partir do banco de
demonstração (`npm run demo`).

- Projeto de teste: **vero-crm-teste** (organização Vero Consórcios, região São Paulo).
- Para recarregar: cole o arquivo no SQL Editor do Supabase, ou rode `npm run supabase -- --enviar` com
  `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`.
- **Nunca** coloque neste repositório (público) um arquivo gerado a partir do banco de produção: ele teria os dados dos
  clientes. Para dados reais, use `--enviar` direto para o projeto.
