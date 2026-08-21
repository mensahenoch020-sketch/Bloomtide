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
```

If your Railway database service is named something other than `Postgres`, replace `Postgres` in the reference with the actual service name.

Do not copy a database password into the repository. Keep all secrets in Railway Variables.

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