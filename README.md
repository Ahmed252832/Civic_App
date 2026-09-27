# CivicPulse Dhaka

CivicPulse is an independent complaint management app for a Dhaka pilot area. Citizens can register, submit reports, follow cases, and review completed work. Administrators verify and assign reports. Assigned department staff record progress. The super administrator creates and disables administrator and staff accounts. The app does **not** automatically send complaints to Dhaka city authorities.

## Public site

The permanent site is [civicpulse-dhaka.civicpulse-desktop.workers.dev](https://civicpulse-dhaka.civicpulse-desktop.workers.dev/). It is hosted on Cloudflare Workers with a shared SQLite backed Durable Object. The owner's live account and existing live data are preserved when the site is redeployed.

Share that link with citizens. They create their own citizen accounts and submit reports. After signing in as the owner, open **Administration** to create administrator and department staff accounts or disable their access. Disabled accounts lose their active sessions and cannot sign in until the owner reactivates them. Only the original owner account has the super administrator role.

Every signed-in user can open **Account security** to change their password. Changing it signs out that account's other sessions. Staff should change the temporary password given by the owner after their first login.

The top-right avatar opens **Account security**. The sidebar sign-out button asks for confirmation for every role. Open browser and desktop sessions show updated shared reports and administration data within about 15 seconds while the app is visible, or when the window regains focus.

Citizens can see and open only reports they personally submitted, including after those reports are verified or completed. The public issue board is disabled. Administrators and the super administrator can review all reports; assigned department staff can work on their assigned reports. Every signed-in role has a dashboard area search that shows only the **number** of complaints matching an area across all citizens and statuses. It does not return other citizens' report titles, locations, images, or details. Administrators can export a case summary as CSV.

Report lists load 25 cases at a time. **Load more** requests the next page by case ID; search and status filters run on the server within each role's access. The case drawer loads one report's full detail only when opened. Dashboard counts and analytics are calculated in SQL across all cases visible to the signed-in role. The map adds older points as more pages are loaded, and tells users how many points are currently shown. Indexes cover common report and history lookups.

## Connected desktop app (version 0.2.0 and later)

Install the current Windows release on each computer. The desktop app opens the **same hosted CivicPulse service** as the public website. Citizen reports, department changes, and staff actions are stored in the shared Cloudflare database and appear in website and desktop sessions. Internet access is required. Sign in with an account created on the hosted site; previous desktop-only accounts are separate and will not work automatically.

Previous desktop releases stored data in a private SQLite file on each computer. Installing the new version does **not** upload or erase those files. Reports previously entered in the old desktop app remain local and must be reviewed and submitted again to the shared service by their owner. Do not uninstall or delete local data until those reports have been checked. A department created only in an old desktop release must be created once more by the super administrator in the connected app. Departments are shown in **Administration → Departments**; citizens choose **report categories**, so add or assign a category to a new department before expecting it in the report flow.

For recovery of old desktop records, the code retains a legacy local mode (`CIVICPULSE_LEGACY_LOCAL=1`) that reads the existing local SQLite file without sending it to the hosted site. This is for manual review, not shared operation. The new installer normally launches connected mode.

## Local development web app

Double-click **Start CivicPulse Web.cmd** to open the shared hosted website in your browser. For a separate local development server, run `npm run web:open` from this folder. The local development server opens at [127.0.0.1:4173](http://127.0.0.1:4173/) and saves data in `E:\CivicPulse\data\civicpulse.sqlite`. It is separate from the hosted site and is reachable only from this laptop.

On the first local run, the owner setup form needs the private setup key from `E:\CivicPulse\.dev.vars` (`BOOTSTRAP_KEY=`), plus a name, email, and password. Keep that file private. Existing local demo accounts and sample reports are no longer seeded or used. The former demo database at `E:\CivicPulse\data\civicpulse-web.sqlite` is not loaded by the current app; see the security handoff for its cleanup status.

The normal Electron desktop app is connected to the public service. Local or test mode uses a separate `civicpulse.sqlite` in the Electron user data directory and is enabled only with `CIVICPULSE_LEGACY_LOCAL=1`, the development flag, or the isolated smoke-test flag. If using local mode for first time setup, `CIVICPULSE_SETUP_KEY` can require a setup key.

## Deploy updates

Double-click **Publish CivicPulse.cmd**, or run:

```powershell
npm test
npm run build
npm run smoke:cloud
npx wrangler deploy
```

Wrangler must be signed in to the correct Cloudflare account. Keep `.dev.vars`, Cloudflare credentials, and user data outside public repositories. Deployment does not reset the live database.

## Owner backup and recovery

In **Administration → Encrypted owner backup**, enter the owner account password and a separate passphrase of at least 16 characters. The browser downloads a `.cpbk` file containing accounts, password hashes, reports and images, feedback, and audit records. It uses PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM. Keep both the file and passphrase safe, in separate places. Losing the passphrase makes the file unrecoverable. This export is limited to 150 MB of unencrypted data and is assembled in browser memory. It is an on-demand archive; edits made while it is downloading may mean it is not an exact point-in-time snapshot.

To check an archive without writing private records to disk, run `node scripts/restore-backup.cjs E:\path\to\backup.cpbk` from this project folder. The script prompts for the passphrase without echoing it and displays record counts. To restore to a **new local** SQLite file, add a new output path: `node scripts/restore-backup.cjs E:\path\to\backup.cpbk E:\recovery\civicpulse.sqlite`. It refuses to overwrite an existing file and checks SQLite integrity and foreign keys. This does not replace the live Cloudflare database automatically. Test restoration periodically. Never share the decrypted SQLite file or commit it to Git.

Cloudflare also provides [30 days of Point-in-Time Recovery for SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). That is the preferred route for an exact live rollback after accidental changes. It must be initiated with a recovery procedure using the Durable Object storage API; this app does not yet offer a live restore button. R2 offsite backups are not active because R2 has not been enabled on this Cloudflare account. Enable R2 and configure a private bucket before implementing automated offsite copies.

`node scripts/load-check.cjs` creates 3,000 synthetic reports in an in-memory database and measures 60 local list reads. This is a repeatable pagination regression check, not a production concurrency guarantee; it does not touch the hosted site or real citizen records.

## Security and operating limits

Passwords are salted and hashed; sessions use HTTP only cookies on the hosted site and expire server side. Requests use server enforced role and record access checks, same origin checks, size limits, login and submission rate limits, and security headers. Administrative changes and case actions are recorded in the audit trail. Uploaded images are held in the shared database and are not published to other citizens.

The app does not yet verify email ownership, provide password recovery or multi factor authentication, or guarantee that citizens' free text and images contain no personal details. No email provider or domain is configured, so a citizen's email must not be treated as verified. The owner should review titles before verification and keep Cloudflare account access protected with multi factor authentication. Arrange a privacy policy, retention and deletion process, incident response plan, and an independent security review before inviting the general public to submit sensitive personal information. No deployed app can guarantee zero risk of intrusion or disclosure.

The hosted database currently uses one SQLite backed Durable Object named `dhaka`. Citizen images are stored in that same database, so image growth will consume its capacity sooner than text reports. Cloudflare documents a [1 GB limit per object on the Free plan and 10 GB on a Paid plan](https://developers.cloudflare.com/durable-objects/platform/limits/). If usage grows substantially, move images to R2 and evaluate a migration from the single object to a database layout suited to higher concurrency. Full CSV export still builds one file per request, and substring search can scan many records; both should be redesigned for very large datasets.

The Dhaka service area is a pilot rectangle (23.68–23.92° N, 90.30–90.53° E), not official municipal boundaries. The area label entered by a citizen is not independent address verification. The map uses OpenStreetMap tiles.
