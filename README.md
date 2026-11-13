# PyHub — versão completa (pronta para publicar)

O protótipo original rodava 100% no navegador com `localStorage`. Esta versão
adiciona um **servidor Flask + banco de dados SQLite** e deixa o site pronto
para colocar no ar de verdade.

## O que foi adicionado

| Área | O que tem agora |
|---|---|
| Banco de dados | SQLite (`pyhub.db`, criado sozinho na 1ª execução) com tabelas de usuários, perguntas, respostas, votos e desafios. O conteúdo de exemplo do protótipo é semeado automaticamente. |
| Contas de verdade | Cadastro/login no servidor. Senhas guardadas **como hash** (scrypt via Werkzeug) — ninguém consegue ler a senha, nem você. |
| Login salvo | Sessão por cookie assinado, `HttpOnly` (JS não lê), `SameSite=Lax` (protege contra CSRF), dura **30 dias**. |
| Segurança | Senhas hasheadas, SQL 100% parametrizado (nada de injection), limitação de tentativas de login/cadastro e de posts por minuto (anti-spam/força-bruta), validação de todos os dados no servidor, cabeçalhos de segurança (CSP, X-Frame-Options, nosniff) e erros de login genéricos (não revelam se o e-mail existe). |
| API | `/api/auth/*`, `/api/me`, `/api/questions`, `/api/questions/<id>/vote`, `/api/questions/<id>/answers`, `/api/challenges`, `/api/health`. Votos, respostas e pontos valem para **todos os visitantes**, não só no seu navegador. |
| Frontend | Mesmo visual e recursos do protótipo (editor Python com Skulpt, busca, filtros, desafio do dia, perfil), agora falando com a API. O desafio do dia é conferido **no servidor**, então não dá para fingir pontos. |

## Rodar no seu computador

```bash
cd pyhub
python -m venv .venv
.venv\Scripts\activate        # Windows (no Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python app.py
```

Abra `http://127.0.0.1:5000`. Pronto — crie uma conta e teste.

> Detalhes locais: a chave de sessão é gerada e salva em `secret.key`
> (coloque no `.env`/ambiente em produção via `SECRET_KEY`). O banco fica em
> `pyhub.db` — para recomeçar do zero, basta apagar esse arquivo.

## Publicar grátis no Render (passo a passo)

1. Coloque a pasta `pyhub` em um repositório no GitHub.
2. Em [render.com](https://render.com) → **New → Web Service** → conecte o repositório.
   Se o repositório tiver o `render.yaml` incluído, ele já sugere tudo; senão use:
   - **Runtime:** Python 3
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn app:app --workers 1 --threads 8`
   - **Variáveis de ambiente:** `SECRET_KEY` (o Render pode gerar uma), `PYHUB_HTTPS=1`
3. Deploy. O Render já serve em HTTPS — o site detecta e marca o cookie como seguro.

Observação importante: no plano gratuito do Render, o disco é **efêmero** — a cada
redeploy o `pyhub.db` volta ao estado inicial. Para os dados persistirem de verdade:

- **Fácil:** ative um *Persistent Disk* no Render (pago, ~US$ 1/mês) apontando para a pasta do app, ou
- **Melhor a longo prazo:** migrar para PostgreSQL (o código já usa SQL padrão; muda só a conexão).

Alternativas parecidas: Railway, Fly.io (com volume), PythonAnywhere.

## Próximos passos sugeridos (quando quiser evoluir)

- Recuperação de senha por e-mail (precisa de um serviço de e-mail tipo Resend).
- Painel simples de moderação (apagar perguntas/respostas ofensivas).
- Marcar pergunta como resolvida pelo autor.
- Postgres + migração com Alembic se a comunidade crescer.
