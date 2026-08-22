# Bloomtide Railway setup

Bloomtide uses a Node/Express backend with Railway Postgres. The public appraisal form, Careers page and Admin dashboard all use the same API and database.

## Railway services
1. Deploy this GitHub repository as the Bloomtide web service.
2. Add a PostgreSQL service to the same Railway project.
3. In the Bloomtide web service > Variables, add:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=charlierob1225@gmail.com
ADMIN_PASSWORD=replace-with-a-strong-admin-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-sending-address@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=your-sending-address@gmail.com
NOTIFY_EMAIL=charlierob1225@gmail.com
```

If your Railway database service is named something other than `Postgres`, replace `Postgres` in the reference with the actual service name.

Do not copy a database password into the repository. Keep all secrets in Railway Variables.

### Email notifications
Bloomtide emails `NOTIFY_EMAIL` (falls back to `ADMIN_EMAIL` if not set) whenever:
- Someone submits an appraisal request
- Someone applies for a job
- You set a fee on an appraisal request — the client is emailed their fee automatically

To enable this, `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` must all be set. If you use Gmail, `SMTP_USER` is your full Gmail address and `SMTP_PASS` must be a 16-character [Gmail App Password](https://myaccount.google.com/apppasswords) — not your normal Gmail password. If these variables are missing, the app still works normally, it just skips sending emails (and logs a warning in the Railway deploy logs).

## Deployment
Railway will run `npm start`, which starts `server.js`. The application automatically creates the required PostgreSQL tables on startup. It also creates the initial admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if that email is not already in the database.

After deployment, open `/api/health`. A response of `{ "ok": true }` means the app can reach Postgres.

Open `/admin.html` and sign in using the admin email/password configured in Railway.

## Connected workflow
- Homepage appraisal form -> POST `/api/appraisals` -> `appraisal_requests`
- Admin dashboard -> reviews requests and sets status/fee
- Admin job form -> `jobs`
- Careers page -> GET `/api/jobs` and displays published jobs automatically
- Careers application form -> `job_applications`
- Admin dashboard -> displays incoming applications
- License records -> `licenses`

## Domain
After the Railway web service deploys successfully, add `bloomtide.online` under the web service Networking / Custom Domain settings and apply the DNS records Railway provides.