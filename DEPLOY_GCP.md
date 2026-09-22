# Deploying the event on Google Cloud

_One Compute Engine VM runs the whole stack with Docker Compose; MERCY's replies come from Gemini on Vertex AI in the same project. Participants reach the lobby on the VM's address; the admin runs the desk from the same address._

## 1. The project

Project **zinnia-mercy**. Once, in the console or with `gcloud`:

```bash
gcloud config set project zinnia-mercy
gcloud services enable aiplatform.googleapis.com compute.googleapis.com
```

Vertex AI serves `gemini-2.5-flash` on the **global** endpoint, which is what the engine asks for (`GOOGLE_CLOUD_LOCATION=global`). Nothing else in the project is needed -- no buckets, no databases; every service keeps its Postgres in a Docker volume on the VM.

## 2. The VM

- **e2-standard-4** (4 vCPU, 16 GB) is comfortable for fifty participants; e2-standard-2 works for a rehearsal. 40 GB standard disk. Ubuntu 24.04 LTS.
- A **service account** on the VM with the role **Vertex AI User** (`roles/aiplatform.user`) and the default access scopes set to *Allow full access to all Cloud APIs* (or at least `cloud-platform`). The engine's container authenticates as this account through the metadata server -- no key file, nothing to copy.
- A **static external IP** (so the address you print on tickets stays put).
- Firewall: a rule on the VM's network tag that allows TCP **3000, 3020, 3030, 4001, 4002, 4003, 4008, 4010, 4011** from the participants' network (the venue's IP range if you know it, `0.0.0.0/0` if you do not). Nothing else needs to be open; SSH stays on 22 through IAP or your own IP.

```bash
gcloud compute instances create mercy-event \
  --zone=asia-south1-a --machine-type=e2-standard-4 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=40GB --tags=mercy-event \
  --service-account=mercy-vm@zinnia-mercy.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --address=<your reserved static IP>

gcloud compute firewall-rules create mercy-event-ports \
  --target-tags=mercy-event --allow=tcp:3000,tcp:3020,tcp:3030,tcp:4001,tcp:4002,tcp:4003,tcp:4008,tcp:4010,tcp:4011 \
  --source-ranges=0.0.0.0/0
```

## 3. On the VM

`setup.sh` at the repo root does the whole of this section. Get the code onto
the VM **into a directory named `mercy-aijudgement`** and run it:

```bash
git clone https://github.com/srid2005/Mercy-An-AI-Judgement.git mercy-aijudgement
cd mercy-aijudgement
./setup.sh --admin-password-file ~/.mercy-admin
```

The directory name matters, and the script also pins it: `mercy-lobby` lists
the stack through the Docker socket by the label
`com.docker.compose.project=mercy-aijudgement`, which Compose derives from the
directory name. Get it wrong and the admin panel's **Resources** page is empty
and **Restart services** is a silent no-op that still answers 200.

The script installs Docker CE and the Compose plugin from Docker's own apt
repository, writes `.env` (generating `MERCY_SESSION_SECRET`,
`INTERNAL_API_KEY`, `MERCY_API_KEY` and `JWT_SECRET`, and taking the admin
password from the file, the `MERCY_ADMIN_PASSWORD` environment variable or a
prompt -- never from the command line, where `/proc` would expose it), builds
the nine images, brings all sixteen containers up, waits for every service to
actually answer HTTP, and prints a PASS/FAIL table with the three URLs the
event runs on. The whole run is also written to `setup-<date>.log`.

It runs in stages, and each can be run on its own:

```bash
./setup.sh --stage=preflight     # the day before: read-only, changes nothing
./setup.sh --stage=verify        # event morning: is it healthy right now?
./setup.sh --stage=start --no-build --recreate   # restart without rebuilding
./setup.sh --help                # every flag
```

**Before the media is on the VM, the game is incomplete.** A large part of the
story -- the rescue film, the band memo audio, the laptop's photographs and
documents, the Haven recordings -- is untracked in git, so a plain clone does
not have it. Preflight says so explicitly. Either commit it first, or copy it
across:

```bash
rsync -av --progress services/ <user>@<vm>:mercy-aijudgement/services/
```

What preflight checks, and why each one matters on the day: the architecture
and the disk where Docker really stores images; that the seed SQL is present;
that the nine ports are free, and which other compose project holds them if
not; the metadata server, the attached service account and whether its scopes
include `cloud-platform`; and **Vertex itself** -- it mints a token from the
metadata server and makes one real `generateContent` call, so a wrong project,
a disabled API and a missing IAM role are three different messages with three
different remedies rather than one silent fallback to canned replies.

Verify additionally proves the things a green `docker compose ps` does not: that
the ports are bound on all interfaces and not just loopback, that the admin
password in `.env` really signs in, that the admin panel can see the stack
through the Docker socket, that the engine booted with the provider `.env`
asks for, that `mercy-engine` can mint a token *from inside the container*, and
when PREPARE TEMPLATES was last run -- a template seeded yesterday leaves every
timestamp in the story a day out.

Doing it by hand instead: `cp .env.example .env`, edit it, then
`COMPOSE_PROJECT_NAME=mercy-aijudgement docker compose up --build -d`.

## 4. Running the event

1. Open **http://\<external-ip\>:3030/admin**, sign in with `ADMIN_PASSWORD`.
2. **Participants** → paste the Zinnia IDs and names (`ZIN26-0158, Name`, one per line).
3. **Event** → **PREPARE TEMPLATES** (seeds every service once, ~5 s; do it on the day so the story's "last night" is last night).
4. Print / show **http://\<external-ip\>:3030/** -- that is what a participant types. Everything after the login is on the same address: the console on :3020, the laptop on :3000, the apps on their ports, all through the one session cookie.
5. **http://\<external-ip\>:3030/leaderboard** on the projector.

A participant who has to be restarted: **RESTART** on their row. A dry run the day before: play, then **RESET EVERY GAME** and **PREPARE TEMPLATES** again.

## 5. Notes

- Plain HTTP is fine for the event (fullscreen, the film with sound and the cookie all work over http on a plain IP). If you want HTTPS and a domain, put a reverse proxy in front of the nine ports -- the front-ends derive every other service's address from `location.hostname`, so a domain works as well as an IP, but each service still needs its own port (or its own subdomain) exposed.
- Cost: Gemini 2.5 Flash at fifty participants × a hundred turns is well under a dollar; the VM is the whole bill.
- Off Google Cloud (a laptop, another host): keep `MERCY_LLM_PROVIDER=vertex`, create a service-account key in the project, put it at `secrets/gcp-key.json`, uncomment the volume on `mercy-engine` in `docker-compose.yml` and set `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp-key.json` in `.env`.
- The model never sees the case's hidden truth (`services/mercy-engine/llm/vertex.js` sends only the turn, the attached evidence, the last turns and the accepted beats), so it cannot spoil the ending; the story beats -- the checkpoints and their lines -- stay scripted in `db/init.sql`.
