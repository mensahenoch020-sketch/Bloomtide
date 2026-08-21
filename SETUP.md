# Bloomtide database setup

The site is wired for Supabase so the public appraisal form, Careers page, and Admin dashboard all use the same database.

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. In Authentication, create the admin user you want to use for `/admin.html`.
4. Copy that user's UUID from Authentication > Users.
5. Run: `insert into public.admin_users(user_id) values ('YOUR-ADMIN-USER-UUID');`
6. In Project Settings > API, copy the Project URL and anon/public key.
7. Put those two values into `config.js`.
8. Deploy the site.

Do not place the Supabase service-role key in this repository or browser code.

## Connected workflow
- Homepage appraisal form -> `appraisal_requests`
- Admin dashboard -> reviews requests, sets status and appraisal/inspection fee
- Admin job form -> `jobs`
- Careers page -> displays published jobs automatically
- Careers application form -> `job_applications`
- Admin dashboard -> displays applications
