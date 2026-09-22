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

```bash
# Docker + the compose plugin
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# the game
git clone <your repo> mercy && cd mercy
cp .env.example .env
nano .env        # MERCY_SESSION_SECRET, ADMIN_PASSWORD, MERCY_LLM_PROVIDER=vertex
docker compose up --build -d
```

`.env` is read by Compose automatically. The three lines that matter:

```
MERCY_SESSION_SECRET=<long random string>   # signs every participant's session cookie
ADMIN_PASSWORD=<something you will type at the desk>
MERCY_LLM_PROVIDER=vertex                    # stub = canned replies, vertex = Gemini
```

`GOOGLE_CLOUD_PROJECT=zinnia-mercy`, `GOOGLE_CLOUD_LOCATION=global` and `VERTEX_MODEL=gemini-2.5-flash` are the defaults in `docker-compose.yml`; override them in `.env` if the project or model changes. Leave `GOOGLE_APPLICATION_CREDENTIALS` unset on the VM.

Check it: `docker compose ps` shows 16 containers up; `curl -s localhost:4010/api/health`; the engine's log (`docker compose logs -f mercy-engine`) prints one line per argument, and prints `vertex ... failed, using the stub: ...` if Vertex is not reachable -- the game keeps running on the stub, so fix the cause (usually the service account's role or scopes) and `docker compose restart mercy-engine`.

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
